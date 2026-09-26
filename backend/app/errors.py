"""The one exception type for rejected actions (docs/CONTRACT.md §10, codes in §12)."""


class ActionError(Exception):
    def __init__(self, code: str, **params: str) -> None:
        super().__init__(code)
        self.code = code
        self.params = params
