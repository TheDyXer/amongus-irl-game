"""Everything a request or socket handler needs, built once by the lifespan (docs/CONTRACT.md §10)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from starlette.requests import HTTPConnection

if TYPE_CHECKING:
    from app.auth import Auth
    from app.cams.discovery import Discovery
    from app.cams.manager import CamManager
    from app.clock import Clock
    from app.config import Config
    from app.hub import Hub
    from app.storage import Storage


@dataclass
class AppContext:
    config: Config
    clock: Clock
    storage: Storage
    auth: Auth
    hub: Hub
    cams: CamManager
    discovery: Discovery | None


def get_ctx(request: HTTPConnection) -> AppContext:
    """Works for HTTP requests and WebSockets alike."""
    return request.app.state.ctx
