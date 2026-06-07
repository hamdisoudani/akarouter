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
    token_expires_at: str | None = None
    provider_name: str = "hermes-nous"
    client_id: str = "hermes-cli"
    token_scope: str = "inference:invoke"
    health_status: str = "unknown"
    weight: float = 1.0
    is_active: bool = True
    total_requests: int = 0
    total_errors: int = 0
    in_flight: int = 0
    max_concurrent: int = 12
    last_used_at: str | None = None
    last_error_at: str | None = None
    last_error_msg: str | None = None
    refresh_lock_acquired_at: str | None = None
    models: list[str] = field(default_factory=list)

    def expired(self) -> bool:
        if not self.token_expires_at:
            return True
        try:
            exp = time.mktime(time.strptime(self.token_expires_at[:19], "%Y-%m-%dT%H:%M:%S"))
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
        concurrency_penalty = min(1.0, self.in_flight / self.max_concurrent)
        return self.weight * self.success_rate() * (1.0 - concurrency_penalty)


class Router:
    def __init__(self) -> None:
        self.accounts: list[Account] = []

    def load_accounts(self) -> None:
        supabase = get_supabase()
        resp = (
            supabase.table("providers")
            .select("*")
            .eq("provider_name", "hermes-nous")
            .eq("health_status", "active")
            .execute()
        )
        self.accounts = [Account(**row) for row in resp.data or []]

    def pick(self, model: str) -> Account | None:
        candidates = [account for account in self.accounts if model in account.models]
        if not candidates:
            # If no model-specific match, pick any healthy account
            if self.accounts:
                return max(self.accounts, key=lambda a: a.score())
            return None
        return max(candidates, key=lambda account: account.score())


router = Router()
