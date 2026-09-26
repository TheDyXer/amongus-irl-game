"""Runtime configuration (docs/CONTRACT.md §10). Environment variables use the AUI_ prefix; tests build
Config(...) directly."""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AUI_", extra="ignore")

    data_dir: Path = BACKEND_DIR / "data"
    static_dir: Path = REPO_DIR / "frontend" / "dist"
    public_address: str = ""  # "" = auto-detect the LAN IP (UDP route trick) + port
    port: int = 8740
    relay_mode: Literal["real", "fake", "off"] = "fake"
    lan_cidr: str = "192.168.11.0/24"
    allowed_hosts: list[str] = []
    allowed_origins: list[str] = []
    video_size: str = "640x480"
    version: str = __version__

    # camera timings (seconds)
    cam_connect_timeout: float = 3.0
    cam_read_timeout: float = 5.0
    cam_pool_timeout: float = 1.0
    frame_watchdog_s: float = 5.0
    live_s: float = 2.0
    lost_grace_s: float = 10.0
    busy_retry_s: float = 2.0
    self_busy_window_s: float = 30.0
    self_busy_retry_s: float = 1.5
    backoff: tuple[float, ...] = (1.0, 2.0, 4.0, 8.0, 10.0)
    backoff_reset_s: float = 10.0
    battery_poll_s: float = 60.0
    torch_period_s: float = 0.5
    control_timeout_s: float = 2.0
    mdns_requery_s: float = 30.0
    mdns_online_s: float = 120.0

    # hub and socket timings (seconds)
    coalesce_s: float = 0.05
    gm_tick_s: float = 1.0
    status_tick_s: float = 0.25
    cams_hb_s: float = 5.0
    use_timeout_s: float = 75.0
    watching_off_delay_s: float = 1.0
    ws_ping_timeout_s: float = 45.0
    anon_idle_s: float = 30.0
    send_block_timeout_s: float = 10.0

    # pairing and GM auth
    pairing_ttl_s: float = 600.0
    pairing_window_max_s: int = 300
    gm_session_ttl_s: float = 86400.0
    login_fail_per_ip_per_min: int = 5
    login_fail_global: int = 10
    login_fail_global_window_s: float = 600.0
    login_lock_s: float = 300.0

    # limits
    max_sockets_per_ip: int = 8
    max_sockets_total: int = 64
    max_msgs_per_s: int = 20
    max_pending_pairings: int = 8
    pair_start_per_min: int = 10
    mjpeg_max_part: int = 1 << 20
    mjpeg_max_buffer: int = 2 << 20
    control_max_bytes: int = 16 << 10

    @property
    def db_path(self) -> Path:
        return self.data_dir / "amongus.sqlite3"

    @property
    def setup_token_path(self) -> Path:
        return self.data_dir / "setup-token"


@lru_cache
def get_config() -> Config:
    return Config()
