"""Injectable time source (docs/CONTRACT.md §10). Every loop sleeps via clock.sleep so tests can
drive time with FakeClock."""
import asyncio
import time
from typing import Protocol


class Clock(Protocol):
    def monotonic(self) -> float: ...

    def time(self) -> float: ...

    async def sleep(self, seconds: float) -> None: ...


class SystemClock:
    def monotonic(self) -> float:
        return time.monotonic()

    def time(self) -> float:
        return time.time()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(max(0.0, seconds))


class FakeClock:
    """Manual clock for tests: sleep() returns only after advance() moves time past its deadline.

    advance() only resolves futures; call `await settle()` (or a few `asyncio.sleep(0)`) afterwards so
    the woken tasks get to run.
    """

    def __init__(self, start_monotonic: float = 1000.0, start_time: float = 1_790_000_000.0) -> None:
        self._mono = start_monotonic
        self._wall = start_time
        self._sleepers: list[tuple[float, asyncio.Future[None]]] = []

    def monotonic(self) -> float:
        return self._mono

    def time(self) -> float:
        return self._wall

    async def sleep(self, seconds: float) -> None:
        if seconds <= 0:
            await asyncio.sleep(0)
            return
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        entry = (self._mono + seconds, fut)
        self._sleepers.append(entry)
        try:
            await fut
        finally:
            if entry in self._sleepers:
                self._sleepers.remove(entry)

    def advance(self, seconds: float) -> None:
        self._mono += seconds
        self._wall += seconds
        for deadline, fut in list(self._sleepers):
            if deadline <= self._mono and not fut.done():
                fut.set_result(None)

    @property
    def sleepers(self) -> int:
        return sum(1 for _, fut in self._sleepers if not fut.done())


async def settle(rounds: int = 5) -> None:
    """Let woken tasks run after FakeClock.advance()."""
    for _ in range(rounds):
        await asyncio.sleep(0)


def epoch_ms(clock: Clock) -> int:
    return int(clock.time() * 1000)
