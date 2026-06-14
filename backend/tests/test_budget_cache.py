import time
import pytest
from app.core.cache import get_account_budget, set_account_budget, _account_budgets

def test_budget_cache_set_and_get():
    account_id = "test-account-id"
    
    # Clean previous state
    if account_id in _account_budgets:
        del _account_budgets[account_id]
        
    # Set budget with custom reset timestamps in the future
    now = time.time()
    reset_5h = now + 3600
    reset_7d = now + 36000
    
    set_account_budget(account_id, 0.05, 0.20, 0.80, reset_5h_at=reset_5h, reset_7d_at=reset_7d)
    
    # Retrieve budget
    budget = get_account_budget(account_id)
    assert budget is not None
    assert budget["consumed_5h"] == 0.05
    assert budget["consumed_7d"] == 0.20
    assert budget["consumed_month"] == 0.80
    assert budget["reset_5h_at"] == reset_5h
    assert budget["reset_7d_at"] == reset_7d

def test_budget_cache_expiration():
    account_id = "expired-account-id"
    
    # Set budget with custom reset timestamp in the past
    now = time.time()
    reset_5h = now - 100
    
    set_account_budget(account_id, 0.05, 0.20, 0.80, reset_5h_at=reset_5h)
    
    # Retrieving budget should return None and clear the cache entry
    budget = get_account_budget(account_id)
    assert budget is None
    assert account_id not in _account_budgets
