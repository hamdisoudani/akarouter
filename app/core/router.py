from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Iterable

from app.core.supabase import get_supabase
from app.core.config import settings


@dataclass
class Account:
    id: str
    account_label: str | None = None
    access_token: str = ""
    refresh_token: str | None = None
    expires_at: str | None = None
    models: list[str] = field(default_factory=list)
    weight: float = 1.0
    is_active: bool = True
    health_status: str = "unknown"
    total_requests: int = 0
    total_errors: int = 0
    in_flight: int = 0
    refresh_lock_at: str | None = None

    def expired(self) -> bool:
        if not self.expires_at:
            return True
        try:
            exp = time.mktime(time.strptime(self.expires_at[:19], "%Y-%m-%dT%H:%M:%S"))
            return time.time() > (exp - settings.token_refresh_skew)
        except Exception:
            return True

    def success_rate(self) -> float:
        if self.total_requests <= 0:
            return 1.0
        return max(0.0, 1.0 - (self.total_errors / self.total_requests))

    def score(self) -> float:
        if not self.is_active or self.health_status == "dead":
            return 0.0
        concurrency_penalty = min(1.0, self.in_flight / settings.max_concurrent_per_account)
        return self.weight * self.success_rate() * (1.0 - concurrency_penalty)


class Router:
    def __init__(self) -> None:
        self.accounts: list[Account] = []

    def load_accounts(self) -> None:
        supabase = get_supabase()
        resp = (
            supabase.table("accounts")
            .select("*")
            .eq("provider_id", self._provider_id())
            .eq("is_active", True)
            .execute()
        )
        self.accounts = [Account(**row) for row in resp.data or []]

    def _provider_id(self) -> str:
        supabase = get_supabase()
        rows = (
            supabase.table("providers")
            .select("id")
            .eq("name", "nous")
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            raise RuntimeError("Missing provider 'nous' in Supabase")
        return rows[0]["id"]

    def pick(self, model: str) -> Account | None:
        candidates = [account for account in self.accounts if model in account.models]
        if not candidates:
            return None
        return max(candidates, key=lambda account: account.score())


router = Router()
