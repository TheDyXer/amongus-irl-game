"""Tokens, request-origin checks, the GM PIN and sessions, and the in-memory pairing book
(docs/CONTRACT.md §2)."""
import asyncio
import hashlib
import ipaddress
import logging
import os
import re
import secrets
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from starlette.concurrency import run_in_threadpool

from app.clock import Clock, epoch_ms
from app.config import Config
from app.errors import ActionError
from app.models import PAIR_ALPHABET, LoginFailures
from app.storage import DeviceRow, GmSessionRow, Storage

log = logging.getLogger(__name__)

COOKIE_DEVICE = "aui_dev"
COOKIE_GM = "aui_gm"
PIN_RE = re.compile(r"[0-9]{6,8}")
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}")
_SETUP_TOKEN_RE = re.compile(rf"[{PAIR_ALPHABET}]{{8}}")
_HOST_RE = re.compile(r"([A-Za-z0-9.-]+)(?::[0-9]{1,5})?")
_TV_RE = re.compile(r"\bTV\b|GoogleTV|BRAVIA|AFT[A-Z]|Chromecast")
_PRIVATE_NETS = tuple(ipaddress.IPv4Network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
_VIEW_LABELS = {
    "en": {"security": "Security", "spectator": "Spectator", "comms": "Comms", "emergency": "Emergency"},
    "hu": {"security": "Biztonság", "spectator": "Néző", "comms": "Kommunikáció", "emergency": "Vészhelyzet"},
}
_hasher = PasswordHasher()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_pin(pin: str) -> str:
    return _hasher.hash(pin)


def _pin_matches(pin_hash: str, pin: str) -> bool:
    try:
        return _hasher.verify(pin_hash, pin)
    except (VerificationError, InvalidHashError):
        return False


def hint_for(user_agent: str) -> str:
    """A short, GM-facing guess at the kind of device behind a user agent."""
    if "Android" in user_agent:
        return "Android TV" if _TV_RE.search(user_agent) else "Android phone"
    if "iPhone" in user_agent:
        return "iPhone"
    if "Macintosh" in user_agent:
        return "Mac"
    if "Windows" in user_agent:
        return "Windows PC"
    if "Linux" in user_agent or "X11" in user_agent or "CrOS" in user_agent:
        return "Linux PC"
    return "Browser"


def host_allowed(config: Config, host: str) -> bool:
    match = _HOST_RE.fullmatch(host)
    if match is None:
        return False
    name = match.group(1).lower()
    if name in ("localhost", "127.0.0.1") or name in {h.lower() for h in config.allowed_hosts}:
        return True
    try:
        ip = ipaddress.IPv4Address(name)
    except ValueError:
        return False
    return any(ip in net for net in _PRIVATE_NETS)


def origin_ok(config: Config, headers: Mapping[str, str]) -> bool:
    """CSRF / cross-site WebSocket check: Origin must be http://<Host> (or a configured dev origin) and
    the Host a LAN name, which also defeats DNS rebinding."""
    origin, host = headers.get("origin"), headers.get("host")
    if not origin or not host or not host_allowed(config, host):
        return False
    return origin == f"http://{host}" or origin in config.allowed_origins


class RateLimiter:
    """Sliding-window event counter per key (monotonic seconds)."""

    def __init__(self, limit: int, window: float) -> None:
        self.limit = limit
        self.window = window
        self._events: dict[str, deque[float]] = {}

    def allowed(self, key: str, now: float) -> bool:
        events = self._events.get(key)
        if events is None:
            return True
        while events and now - events[0] >= self.window:
            events.popleft()
        if not events:
            del self._events[key]
        return len(events) < self.limit

    def add(self, key: str, now: float) -> None:
        self._events.setdefault(key, deque()).append(now)

    def hit(self, key: str, now: float) -> bool:
        if not self.allowed(key, now):
            return False
        self.add(key, now)
        return True

    def clear(self, key: str) -> None:
        self._events.pop(key, None)


@dataclass
class Pending:
    code: str
    token_hash: str
    address: str
    user_agent: str
    created: float  # monotonic
    expires: float  # monotonic

    @property
    def hint(self) -> str:
        return hint_for(self.user_agent)


class PairingBook:
    """Pending pairing requests; they only exist while the GM's pairing window is open."""

    def __init__(self, config: Config) -> None:
        self._config = config
        self._until: float | None = None
        self._pending: dict[str, Pending] = {}
        self._blocked: set[str] = set()  # rejected cookies and addresses, until the window closes

    @property
    def is_open(self) -> bool:
        """Open as far as the GM is concerned; expire() closes it once its time is up."""
        return self._until is not None

    def open_window(self, seconds: float, now_mono: float) -> None:
        self._until = now_mono + min(seconds, self._config.pairing_window_max_s)

    def close_window(self) -> None:
        self._until = None
        self._pending.clear()
        self._blocked.clear()

    def window_until(self, now_mono: float) -> float | None:
        return self._until if self._until is not None and now_mono < self._until else None

    def start(self, token_hash: str, address: str, user_agent: str, now_mono: float) -> Pending | None:
        """The pending request for this cookie (created or renewed), or None while pairing is closed to it."""
        if self.window_until(now_mono) is None or token_hash in self._blocked or address in self._blocked:
            return None
        ttl = self._config.pairing_ttl_s
        mine = self.for_token(token_hash)
        if mine is not None:
            mine.expires = now_mono + ttl
            return mine
        for other in [p for p in self._pending.values() if p.address == address]:
            del self._pending[other.code]
        if len(self._pending) >= self._config.max_pending_pairings:
            raise ActionError("err.pairing_full")
        pending = Pending(self._new_code(), token_hash, address, user_agent[:120], now_mono, now_mono + ttl)
        self._pending[pending.code] = pending
        return pending

    def keep_alive(self, token_hash: str, now_mono: float) -> bool:
        """Renews the cookie's code once half its lifetime is gone; True when expires changed."""
        pending = self.for_token(token_hash)
        ttl = self._config.pairing_ttl_s
        if pending is None or pending.expires - now_mono >= ttl / 2:
            return False
        pending.expires = now_mono + ttl
        return True

    def by_code(self, code: str) -> Pending | None:
        return self._pending.get(code)

    def for_token(self, token_hash: str) -> Pending | None:
        return next((p for p in self._pending.values() if p.token_hash == token_hash), None)

    def take(self, code: str) -> Pending:
        pending = self._pending.pop(code, None)
        if pending is None:
            raise ActionError("err.unknown_code")
        return pending

    def reject(self, code: str) -> None:
        pending = self.take(code)
        self._blocked |= {pending.token_hash, pending.address}

    def expire(self, now_mono: float) -> bool:
        """Closes the window when its time is up and drops expired codes; True when anything changed."""
        if self._until is not None and now_mono >= self._until:
            self.close_window()
            return True
        expired = [code for code, p in self._pending.items() if p.expires <= now_mono]
        for code in expired:
            del self._pending[code]
        return bool(expired)

    def pending(self) -> list[Pending]:
        return sorted(self._pending.values(), key=lambda p: p.created)

    def _new_code(self) -> str:
        for _ in range(50):
            code = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(4))
            if code not in self._pending:
                return code
        raise ActionError("err.pairing_full")


class Auth:
    def __init__(self, storage: Storage, config: Config, clock: Clock) -> None:
        self._storage = storage
        self._config = config
        self._clock = clock
        self.pairing = PairingBook(config)
        self.pair_limit = RateLimiter(config.pair_start_per_min, 60.0)
        self._pin_lock = asyncio.Lock()
        self._ip_failures = RateLimiter(config.login_fail_per_ip_per_min, 60.0)
        self._all_failures: deque[float] = deque()
        self._locked_until: float | None = None  # monotonic
        self._locked_until_ms: int | None = None
        self._failure_count = 0
        self._failure_last_ms: int | None = None
        self._failure_addresses: deque[str] = deque(maxlen=5)
        self._setup_token = self._init_setup_token()

    # ------------------------------------------------------------------ principals

    def device_for_token(self, token: str | None) -> DeviceRow | None:
        return self._storage.device_by_token_hash(hash_token(token)) if token else None

    def gm_session_for_token(self, token: str | None) -> GmSessionRow | None:
        return self._storage.gm_session(hash_token(token), self._clock.time()) if token else None

    def approve(self, code: str, view: str, name: str | None) -> DeviceRow:
        pending = self.pairing.by_code(code)
        if pending is None:
            raise ActionError("err.unknown_code")
        row = DeviceRow(
            id=secrets.token_hex(8),
            token_hash=pending.token_hash,
            name=name or self._default_name(view),
            view=view,
            max_fps=15,
            low_motion=False,
            created_at=self._clock.time(),
            last_seen_at=None,
            address=pending.address,
            approved_address=pending.address,
        )
        self._storage.add_device(row)
        self.pairing.take(code)
        return row

    def _default_name(self, view: str) -> str:
        label = _VIEW_LABELS[self._storage.get_settings().lang][view]
        taken = {d.name for d in self._storage.list_devices()}
        n = 1
        while f"{label} {n}" in taken:
            n += 1
        return f"{label} {n}"

    # ------------------------------------------------------------------ GM PIN and sessions

    def pin_set(self) -> bool:
        return self._storage.get_pin_hash() is not None

    def setup_token(self) -> str | None:
        return self._setup_token

    async def setup_pin(self, pin: str, setup_token: str, address: str, user_agent: str) -> tuple[str, GmSessionRow]:
        async with self._pin_lock:
            if self.pin_set():
                raise ActionError("err.pin_exists")
            self._check_limits(address)
            if not PIN_RE.fullmatch(pin):
                raise ActionError("err.bad_request")
            if self._setup_token is None or not secrets.compare_digest(setup_token.encode(), self._setup_token.encode()):
                self._record_failure(address)
                raise ActionError("err.bad_setup_token")
            pin_hash = await run_in_threadpool(hash_pin, pin)
            if not self._storage.set_pin_hash_if_absent(pin_hash):
                raise ActionError("err.pin_exists")
            self._setup_token = None
            self._config.setup_token_path.unlink(missing_ok=True)
            return self._new_session(address, user_agent)

    async def login(self, pin: str, address: str, user_agent: str) -> tuple[str, GmSessionRow]:
        async with self._pin_lock:
            self._check_limits(address)
            if not await self._pin_ok(pin):
                self._record_failure(address)
                raise ActionError("err.pin_wrong")
            self._ip_failures.clear(address)
            return self._new_session(address, user_agent)

    def logout(self, session_id: str) -> None:
        self._storage.delete_gm_session(session_id)

    def logout_others(self, session_id: str) -> list[str]:
        return self._storage.delete_gm_sessions_except(session_id)

    async def change_pin(self, session_id: str, old: str, new: str) -> list[str]:
        """Sets a new PIN and ends every other GM session; returns their ids."""
        async with self._pin_lock:
            if not PIN_RE.fullmatch(new):
                raise ActionError("err.bad_request")
            session = next((s for s in self._storage.list_gm_sessions(self._clock.time()) if s.id == session_id), None)
            address = session.address if session and session.address else "?"
            self._check_limits(address)
            if not await self._pin_ok(old):
                self._record_failure(address)
                raise ActionError("err.pin_wrong")
            self._storage.set_pin_hash(await run_in_threadpool(hash_pin, new))
            return self._storage.delete_gm_sessions_except(session_id)

    def locked_until(self) -> int | None:
        """Epoch ms until which every login is refused, or None."""
        locked = self._locked_until is not None and self._clock.monotonic() < self._locked_until
        return self._locked_until_ms if locked else None

    def login_failures(self) -> LoginFailures:
        return LoginFailures(
            count=self._failure_count,
            last_at=self._failure_last_ms,
            addresses=list(self._failure_addresses),
            locked_until=self.locked_until(),
        )

    async def _pin_ok(self, pin: str) -> bool:
        pin_hash = self._storage.get_pin_hash()
        return pin_hash is not None and bool(PIN_RE.fullmatch(pin)) and await run_in_threadpool(_pin_matches, pin_hash, pin)

    def _check_limits(self, address: str) -> None:
        """Runs before argon2, so refused attempts cost nothing."""
        if self.locked_until() is not None:
            raise ActionError("err.login_locked")
        if not self._ip_failures.allowed(address, self._clock.monotonic()):
            raise ActionError("err.rate_limited")

    def _record_failure(self, address: str) -> None:
        now = self._clock.monotonic()
        self._ip_failures.add(address, now)
        self._all_failures.append(now)
        while now - self._all_failures[0] >= self._config.login_fail_global_window_s:
            self._all_failures.popleft()
        if len(self._all_failures) >= self._config.login_fail_global:
            self._all_failures.clear()
            self._locked_until = now + self._config.login_lock_s
            self._locked_until_ms = epoch_ms(self._clock) + int(self._config.login_lock_s * 1000)
            log.warning("GM login locked for %.0f s after repeated failures", self._config.login_lock_s)
        self._failure_count += 1
        self._failure_last_ms = epoch_ms(self._clock)
        if address in self._failure_addresses:
            self._failure_addresses.remove(address)
        self._failure_addresses.append(address)

    def _new_session(self, address: str, user_agent: str) -> tuple[str, GmSessionRow]:
        token = new_token()
        now = self._clock.time()
        row = GmSessionRow(
            id=secrets.token_hex(8),
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + self._config.gm_session_ttl_s,
            last_seen_at=now,
            address=address,
            user_agent=user_agent[:120],
        )
        self._storage.add_gm_session(row.id, row.token_hash, row.created_at, row.expires_at, row.address, row.user_agent)
        return token, row

    def _init_setup_token(self) -> str | None:
        """While no PIN exists: a one-time token (kept across restarts) that authorises POST /api/gm/setup."""
        path = self._config.setup_token_path
        if self.pin_set():
            path.unlink(missing_ok=True)
            return None
        try:
            token = path.read_text(encoding="utf-8").strip()
        except OSError:
            token = ""
        if not _SETUP_TOKEN_RE.fullmatch(token):
            token = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(8))
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(token + "\n")
        log.warning("No GM PIN yet. Setup token: %s (also in %s)", token, path)
        return token
