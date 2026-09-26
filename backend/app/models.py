"""Wire contract shared by the server and the React app (docs/CONTRACT.md v2, sections 3-5).

Server-to-client models give their discriminator (`t`, `kind`, `type`, `view`) a default so server
code can build them without repeating it; the JSON schema is exported in serialization mode with
`json_schema_serialization_defaults_required`, which still marks those fields required.
Client-to-server models declare their discriminator without a default.
Timestamps on the wire are epoch milliseconds (`*_at`, `now`).
TypeScript mirrors are generated into frontend/src/api/types.gen.ts by scripts/gen_types.py.
"""
import struct
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.json_schema import models_json_schema

ViewName = Literal["security", "spectator", "comms", "emergency"]
Lang = Literal["en", "hu"]
LinkState = Literal["idle", "disabled", "connecting", "streaming", "busy", "backoff"]
Signal = Literal["live", "lost", "offline"]
TileStatus = Literal["live", "lost"]
MonitorMode = Literal["cams", "cams_off", "comms_down", "meeting"]
TorchCapability = Literal["unknown", "ready", "pro_required", "unsupported"]
TorchState = Literal["off", "on", "unknown"]
RelayMode = Literal["real", "fake", "off"]
MaxFps = Literal[5, 10, 15, 20, 30]
NoticeLevel = Literal["info", "warn"]

PAIR_ALPHABET = "ACDEFHJKLMNPQRTUVWXY"

Slot = Annotated[int, Field(ge=1, le=4)]
EpochMs = Annotated[int, Field(ge=0)]
RoomName = Annotated[str, Field(max_length=16)]
DeviceName = Annotated[str, Field(min_length=1, max_length=24)]
PhoneName = Annotated[str, Field(max_length=32)]
Pin = Annotated[str, Field(pattern=r"^[0-9]{6,8}$")]
PairCode = Annotated[str, Field(pattern=rf"^[{PAIR_ALPHABET}]{{4}}$")]
SetupToken = Annotated[str, Field(pattern=rf"^[{PAIR_ALPHABET}]{{8}}$")]
Code = Annotated[str, Field(max_length=64)]
Params = dict[str, Annotated[str, Field(max_length=64)]]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


# ---------------------------------------------------------------- settings and HTTP bodies


class Settings(Model):
    lang: Lang = "en"
    volume: int = Field(default=70, ge=0, le=100)
    cams_enabled: bool = True
    torch_blink: bool = True


class Health(Model):
    ok: bool
    version: str


class PublicInfo(Model):
    lang: Lang
    volume: int


class PairStatus(Model):
    status: Literal["closed", "pending", "paired"]
    code: str | None = None
    expires_at: EpochMs | None = None
    view: ViewName | None = None
    name: str | None = None


class GmStatus(Model):
    pin_set: bool
    logged_in: bool
    locked_until: EpochMs | None = None
    lang: Lang = "en"


class PinBody(Model):
    pin: Pin


class SetupBody(Model):
    pin: Pin
    setup_token: SetupToken


# ---------------------------------------------------------------- screen views (server -> client)


class HelloView(Model):
    """Anonymous connection: no cookie the server recognises for the requested role."""

    kind: Literal["hello"] = "hello"
    lang: Lang


class PairingView(Model):
    kind: Literal["pairing"] = "pairing"
    status: Literal["closed", "pending"]
    code: str | None
    expires_at: EpochMs | None
    lang: Lang


class CamTile(Model):
    """One monitor window. Only assigned cameras whose signal is live or lost get a tile."""

    slot: Slot
    gen: int = Field(ge=0, le=0xFFFF)
    room: RoomName
    status: TileStatus


class Monitor(Model):
    mode: MonitorMode
    tiles: list[CamTile]
    ends_at: EpochMs | None = None


class DeviceSelf(Model):
    id: str
    name: str
    max_fps: MaxFps
    low_motion: bool


class SecurityBody(Model):
    view: Literal["security"] = "security"
    monitor: Monitor
    watching: bool
    using: bool


class SpectatorBody(Model):
    view: Literal["spectator"] = "spectator"
    monitor: Monitor
    watching: bool


class CommsBody(Model):
    view: Literal["comms"] = "comms"


class EmergencyBody(Model):
    view: Literal["emergency"] = "emergency"


ScreenBody = Annotated[Union[SecurityBody, SpectatorBody, CommsBody, EmergencyBody], Field(discriminator="view")]


class ScreenView(Model):
    kind: Literal["screen"] = "screen"
    device: DeviceSelf
    lang: Lang
    volume: int
    body: ScreenBody


# ---------------------------------------------------------------- GM view (server -> client)


class Battery(Model):
    level: int = Field(ge=0, le=100)
    charging: bool
    at: EpochMs


class PhoneRef(Model):
    id: str
    name: PhoneName
    host: str
    port: int
    manual: bool


class CamSlot(Model):
    slot: Slot
    gen: int
    room: RoomName
    phone: PhoneRef | None
    link: LinkState
    signal: Signal
    fps: float
    last_frame_at: EpochMs | None
    battery: Battery | None
    torch: TorchCapability
    torch_state: TorchState
    error_code: Code | None = None


class KnownPhone(Model):
    id: str
    name: PhoneName
    host: str
    port: int
    manual: bool
    online: bool
    slot: Slot | None
    last_seen_at: EpochMs | None


class DeviceInfo(Model):
    id: str
    name: str
    view: ViewName
    max_fps: MaxFps
    low_motion: bool
    online: bool
    last_seen_at: EpochMs | None
    address: str | None
    address_changed: bool


class PendingPairing(Model):
    code: str
    created_at: EpochMs
    expires_at: EpochMs
    address: str | None
    hint: str


class GmSession(Model):
    id: str
    address: str | None
    hint: str
    last_seen_at: EpochMs | None
    current: bool


class LoginFailures(Model):
    count: int
    last_at: EpochMs | None
    addresses: list[str]
    locked_until: EpochMs | None


class Notice(Model):
    id: str
    level: NoticeLevel
    code: Code
    params: Params
    at: EpochMs


class ServerInfo(Model):
    address: str
    version: str
    relay_mode: RelayMode


class GmView(Model):
    kind: Literal["gm"] = "gm"
    settings: Settings
    cams: list[CamSlot]
    phones: list[KnownPhone]
    devices: list[DeviceInfo]
    pending: list[PendingPairing]
    pairing_open_until: EpochMs | None
    watching: bool
    sessions: list[GmSession]
    login_failures: LoginFailures
    notices: list[Notice]
    server: ServerInfo


View = Annotated[Union[HelloView, PairingView, ScreenView, GmView], Field(discriminator="kind")]


# ---------------------------------------------------------------- events (server -> client)


class PairedEvent(Model):
    type: Literal["paired"] = "paired"
    view: ViewName


class ToastEvent(Model):
    type: Literal["toast"] = "toast"
    code: Code
    params: Params = Field(default_factory=dict)


Event = Annotated[Union[PairedEvent, ToastEvent], Field(discriminator="type")]


# ---------------------------------------------------------------- actions (client -> server)


class UseOpen(Model):
    """The Security station's monitor is open (also sent every 30 s as a keepalive)."""

    type: Literal["use_open"]


class UseClose(Model):
    type: Literal["use_close"]


class AssignCam(Model):
    type: Literal["assign_cam"]
    slot: Slot
    phone_id: str = Field(max_length=128)


class UnassignCam(Model):
    type: Literal["unassign_cam"]
    slot: Slot


class SetRoom(Model):
    type: Literal["set_room"]
    slot: Slot
    room: RoomName


class AddManualPhone(Model):
    type: Literal["add_manual_phone"]
    host: str = Field(min_length=7, max_length=15)
    port: int = Field(default=4747, ge=1, le=65535)
    slot: Slot | None = None


class ForgetPhone(Model):
    type: Literal["forget_phone"]
    phone_id: str = Field(max_length=128)


class SetPairingOpen(Model):
    type: Literal["set_pairing_open"]
    open: bool
    seconds: int = Field(default=300, ge=10, le=300)


class ApprovePairing(Model):
    type: Literal["approve_pairing"]
    code: PairCode
    view: ViewName
    name: DeviceName | None = None


class RejectPairing(Model):
    type: Literal["reject_pairing"]
    code: PairCode


class RevokeDevice(Model):
    type: Literal["revoke_device"]
    device_id: str = Field(max_length=32)


class UpdateDevice(Model):
    type: Literal["update_device"]
    device_id: str = Field(max_length=32)
    name: DeviceName | None = None
    view: ViewName | None = None
    max_fps: MaxFps | None = None
    low_motion: bool | None = None


class SetSettings(Model):
    type: Literal["set_settings"]
    lang: Lang | None = None
    volume: int | None = Field(default=None, ge=0, le=100)
    cams_enabled: bool | None = None
    torch_blink: bool | None = None


class TestTorch(Model):
    type: Literal["test_torch"]
    slot: Slot


class TorchFix(Model):
    type: Literal["torch_fix"]
    slot: Slot


class ChangePin(Model):
    type: Literal["change_pin"]
    old: Pin
    new: Pin


class LogoutSessions(Model):
    """Log out every other GM session."""

    type: Literal["logout_sessions"]


class DismissNotice(Model):
    type: Literal["dismiss_notice"]
    id: str = Field(max_length=32)


_ACTIONS = (
    UseOpen,
    UseClose,
    AssignCam,
    UnassignCam,
    SetRoom,
    AddManualPhone,
    ForgetPhone,
    SetPairingOpen,
    ApprovePairing,
    RejectPairing,
    RevokeDevice,
    UpdateDevice,
    SetSettings,
    TestTorch,
    TorchFix,
    ChangePin,
    LogoutSessions,
    DismissNotice,
)
Action = Annotated[Union[_ACTIONS], Field(discriminator="type")]

DEVICE_ACTIONS: dict[str, frozenset[str]] = {
    "security": frozenset({"use_open", "use_close"}),
    "spectator": frozenset(),
    "comms": frozenset(),
    "emergency": frozenset(),
}
GM_ACTIONS = frozenset(
    {
        "assign_cam",
        "unassign_cam",
        "set_room",
        "add_manual_phone",
        "forget_phone",
        "set_pairing_open",
        "approve_pairing",
        "reject_pairing",
        "revoke_device",
        "update_device",
        "set_settings",
        "test_torch",
        "torch_fix",
        "change_pin",
        "logout_sessions",
        "dismiss_notice",
    }
)


# ---------------------------------------------------------------- envelopes


class StateMsg(Model):
    t: Literal["state"] = "state"
    now: EpochMs
    v: View


class EventMsg(Model):
    t: Literal["event"] = "event"
    e: Event


class ErrorMsg(Model):
    t: Literal["error"] = "error"
    code: Code
    ref: str | None = None


class PongMsg(Model):
    t: Literal["pong"] = "pong"
    now: EpochMs


ServerMsg = Annotated[Union[StateMsg, EventMsg, ErrorMsg, PongMsg], Field(discriminator="t")]


class ActMsg(Model):
    t: Literal["act"]
    id: str | None = Field(default=None, max_length=16)
    a: Action


class PingMsg(Model):
    t: Literal["ping"]


ClientMsg = Annotated[Union[ActMsg, PingMsg], Field(discriminator="t")]


class CamsHeartbeat(Model):
    """Text message on /ws/cams every 5 s."""

    t: Literal["hb"] = "hb"
    now: EpochMs


class CamSub(Model):
    """Text message on /ws/cams choosing which slots to receive and the wanted frame rate."""

    t: Literal["sub"]
    slots: list[Slot] = Field(max_length=4)
    fps: int = Field(default=30, ge=1, le=30)


# ---------------------------------------------------------------- binary frame header (/ws/cams)

FRAME_VERSION = 1
FRAME_HEADER = struct.Struct(">BBHII")  # version, slot, gen, seq, age_ms


def pack_frame(slot: int, gen: int, seq: int, age_ms: int, jpeg: bytes) -> bytes:
    head = FRAME_HEADER.pack(FRAME_VERSION, slot, gen & 0xFFFF, seq & 0xFFFFFFFF, max(0, min(age_ms, 0xFFFFFFFF)))
    return head + jpeg


# ---------------------------------------------------------------- schema export


class ServerContract(Model):
    """Everything the server sends (exported in serialization mode)."""

    ws: ServerMsg
    cams_text: CamsHeartbeat
    pair_status: PairStatus
    gm_status: GmStatus
    health: Health
    public: PublicInfo


class ClientContract(Model):
    """Everything the client sends (exported in validation mode)."""

    ws: ClientMsg
    cam_sub: CamSub
    pin: PinBody
    setup: SetupBody


def contract_json_schema() -> dict:
    """One JSON schema whose $defs hold every contract type, for the TypeScript generator."""
    _, schema = models_json_schema(
        [(ServerContract, "serialization"), (ClientContract, "validation")],
        title="Contract",
    )
    return schema
