"""Background token refresh loop for Hermes/Nous OAuth providers.

Runs as an asyncio task started in app.main.startup(). Calls
`oauth.refresh_expiring_providers()` periodically (default every 5 min)
so providers with access_token expiring within `token_refresh_skew` (120s)
get a fresh JWT before the next chat request hits them.

This was the missing piece: the function existed in oauth.py but had no
caller on a schedule. Expired tokens used to silently cause 401s until a
human hit POST /admin/providers/refresh-all by hand.
"""
import asyncio
import logging
from typing import Optional

from app.core.oauth import refresh_expiring_providers

logger = logging.getLogger(__name__)

# How often the loop wakes up to check for expiring tokens.
# 5 min gives plenty of headroom over the 120s refresh_skew
# — at most one chat could hit an expired token before the next refresh
# attempt, and even that would be caught by the lazy refresh in
# select_provider().
REFRESH_LOOP_INTERVAL_SECONDS = 300

_task: Optional[asyncio.Task] = None
_should_run: bool = False


async def _refresh_loop_worker() -> None:
    """Asynchronous worker that calls refresh_expiring_providers() on a loop."""
    logger.info("Token refresh loop worker started")
    while _should_run:
        try:
            await asyncio.sleep(REFRESH_LOOP_INTERVAL_SECONDS)
            refreshed = await refresh_expiring_providers()
            ok_count = sum(1 for r in refreshed if r.get("ok"))
            fail_count = len(refreshed) - ok_count
            if refreshed:
                logger.info(
                    "Token refresh loop tick: %d refreshed, %d failed",
                    ok_count, fail_count,
                )
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Error in token refresh loop: %s", e)
    logger.info("Token refresh loop worker stopped")


def start_refresh_loop() -> None:
    """Start the background token refresh task. Idempotent."""
    global _task, _should_run
    _should_run = True
    if _task is None or _task.done():
        _task = asyncio.create_task(_refresh_loop_worker())
        logger.info("Token refresh loop background task initialized")


async def stop_refresh_loop() -> None:
    """Stop the background token refresh task."""
    global _task, _should_run
    _should_run = False
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
    logger.info("Token refresh loop stopped")
