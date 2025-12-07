from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import time
from typing import Any, Deque, Dict, List, Optional
from collections import deque

logger = logging.getLogger("credential-pool")


@dataclass
class Credential:
  id: str
  provider: str
  model: str
  api_key: str
  status: str = "active"  # active | exhausted | disabled
  tier: str = "primary"
  daily_call_limit: Optional[int] = None
  max_calls_per_day: Optional[int] = None
  max_tokens_per_day: Optional[int] = None
  estimated_cost_per_1k_tokens: Optional[float] = None
  used_calls: int = 0
  used_tokens: int = 0
  reset_at: Optional[datetime] = None
  last_rotated_at: Optional[datetime] = None
  total_calls: int = 0
  total_tokens: int = 0
  metadata: Dict[str, Any] = field(default_factory=dict)


credential_pool: Dict[str, Credential] = {}
token_to_id: Dict[str, str] = {}
credential_order: List[str] = []
_cursor_index = 0
call_rate_window: Dict[str, Deque[float]] = {}

TIER_PRIORITY = {
  "primary": 0,
  "backup": 1,
  "free-tier": 2,
}

NEAR_QUOTA_THRESHOLD = 0.9


def _register_credential(credential: Credential) -> None:
  credential_pool[credential.id] = credential
  token_to_id[credential.api_key] = credential.id
  credential_order.append(credential.id)


def _auto_reset(credential: Credential) -> None:
  if credential.reset_at and datetime.utcnow() >= credential.reset_at:
    credential.used_calls = 0
    credential.reset_at = None
    if credential.status == "exhausted":
      credential.status = "active"
      credential.used_tokens = 0


def _tier_priority(tier: str) -> int:
  return TIER_PRIORITY.get(tier, 99)


def _effective_call_limit(credential: Credential) -> Optional[int]:
  return credential.max_calls_per_day or credential.daily_call_limit


def _is_near_quota(credential: Credential) -> bool:
  call_limit = _effective_call_limit(credential)
  token_limit = credential.max_tokens_per_day
  if call_limit and credential.used_calls >= call_limit * NEAR_QUOTA_THRESHOLD:
    return True
  if token_limit and credential.used_tokens >= token_limit * NEAR_QUOTA_THRESHOLD:
    return True
  return False


def seed_default_credentials() -> None:
  reset_credentials([
    Credential(
      id="cred-primary",
      provider="battle-healer",
      model="standard",
      api_key="new-token-abc",
      daily_call_limit=200,
      max_tokens_per_day=250_000,
      tier="primary",
      estimated_cost_per_1k_tokens=0.6,
    ),
    Credential(
      id="cred-secondary",
      provider="battle-healer",
      model="standard",
      api_key="token-backup-xyz",
      daily_call_limit=150,
      max_tokens_per_day=200_000,
      tier="backup",
      estimated_cost_per_1k_tokens=0.5,
    ),
    Credential(
      id="cred-spiky",
      provider="battle-healer",
      model="standard",
      api_key="spiky-token",
      daily_call_limit=20,
      tier="free-tier",
      max_tokens_per_day=25_000,
      estimated_cost_per_1k_tokens=0.1,
    ),
    Credential(
      id="cred-chatty",
      provider="battle-healer",
      model="standard",
      api_key="chatty-token",
      daily_call_limit=40,
      tier="free-tier",
      max_tokens_per_day=30_000,
      estimated_cost_per_1k_tokens=0.1,
    ),
    Credential(
      id="cred-blocked",
      provider="battle-healer",
      model="standard",
      api_key="blocked-token-001",
      status="disabled",
      metadata={"status_reason": "API key blocked due to suspicious activity. Contact support."},
    ),
    Credential(
      id="cred-disabled-eu",
      provider="battle-healer",
      model="eu",
      api_key="disabled-token-eu",
      status="disabled",
      metadata={"status_reason": "API key disabled in the EU region. Provision a new key."},
    ),
  ])


def reset_credentials(custom_credentials: Optional[List[Credential]] = None) -> None:
  """Reset the credential pool (used by defaults + unit tests)."""
  global _cursor_index
  credential_pool.clear()
  credential_order.clear()
  token_to_id.clear()
  _cursor_index = 0
  for credential in custom_credentials or []:
    _register_credential(credential)


def get_credential_by_token(token: str) -> Optional[Credential]:
  credential_id = token_to_id.get(token)
  if not credential_id:
    return None
  credential = credential_pool.get(credential_id)
  if credential:
    _auto_reset(credential)
  return credential


def seconds_until_reset(credential: Credential) -> Optional[int]:
  if not credential.reset_at:
    return None
  delta = credential.reset_at - datetime.utcnow()
  remaining = int(delta.total_seconds())
  if remaining <= 0:
    return None
  return remaining


def get_next_credential(provider: str, model: Optional[str] = None) -> Optional[Credential]:
  global _cursor_index
  if not credential_order:
    return None

  total = len(credential_order)
  candidates: List[Credential] = []
  for offset in range(total):
    idx = (_cursor_index + offset) % total
    credential_id = credential_order[idx]
    credential = credential_pool[credential_id]
    _auto_reset(credential)
    if credential.provider != provider:
      continue
    if model and credential.model != model:
      continue
    if credential.status != "active":
      continue
    call_limit = _effective_call_limit(credential)
    if call_limit and credential.used_calls >= call_limit:
      credential.status = "exhausted"
      credential.reset_at = credential.reset_at or (datetime.utcnow() + timedelta(hours=1))
      logger.info(
        "credential_exhausted_calls id=%s used=%s limit=%s",
        credential.id,
        credential.used_calls,
        call_limit,
      )
      continue
    if credential.max_tokens_per_day and credential.used_tokens >= credential.max_tokens_per_day:
      credential.status = "exhausted"
      credential.reset_at = credential.reset_at or (datetime.utcnow() + timedelta(hours=1))
      logger.info(
        "credential_exhausted_tokens id=%s used=%s limit=%s",
        credential.id,
        credential.used_tokens,
        credential.max_tokens_per_day,
      )
      continue
    candidates.append(credential)

  if not candidates:
    return None

  non_near = [cred for cred in candidates if not _is_near_quota(cred)]
  subset = non_near or candidates
  subset.sort(key=lambda cred: (_tier_priority(cred.tier), cred.last_rotated_at or datetime.min))
  chosen = subset[0]
  if _is_near_quota(chosen):
    logger.info(
      "credential_near_quota id=%s tier=%s used_calls=%s used_tokens=%s",
      chosen.id,
      chosen.tier,
      chosen.used_calls,
      chosen.used_tokens,
    )
  chosen.last_rotated_at = datetime.utcnow()
  _cursor_index = (credential_order.index(chosen.id) + 1) % total
  return chosen

  return None


def mark_credential_status(
  credential_id: str,
  status: str,
  *,
  reason: Optional[str] = None,
  cooldown_seconds: Optional[int] = None,
) -> None:
  credential = credential_pool.get(credential_id)
  if not credential:
    return
  credential.status = status
  if reason:
    credential.metadata["status_reason"] = reason
  if cooldown_seconds:
    credential.reset_at = datetime.utcnow() + timedelta(seconds=cooldown_seconds)
  elif status != "exhausted":
    credential.reset_at = None


def mark_credential_status_by_token(
  token: str,
  status: str,
  *,
  reason: Optional[str] = None,
  cooldown_seconds: Optional[int] = None,
) -> None:
  credential_id = token_to_id.get(token)
  if credential_id:
    mark_credential_status(credential_id, status, reason=reason, cooldown_seconds=cooldown_seconds)


def note_call(credential_id: str) -> float:
  now = time.monotonic()
  history = call_rate_window.setdefault(credential_id, deque())
  history.append(now)
  while history and now - history[0] > 120:
    history.popleft()
  return get_average_calls_per_minute(credential_id)


def get_average_calls_per_minute(credential_id: str) -> float:
  history = call_rate_window.get(credential_id)
  if not history or len(history) < 2:
    return float(len(history or []))
  window_seconds = history[-1] - history[0]
  if window_seconds <= 0:
    return float(len(history))
  return (len(history) - 1) / (window_seconds / 60)


def record_usage(
  credential_id: str,
  *,
  tokens_used: int = 0,
  call_count: int = 1,
) -> Optional[Credential]:
  credential = credential_pool.get(credential_id)
  if not credential:
    return None
  credential.total_calls += call_count
  credential.total_tokens += tokens_used
  credential.used_calls += call_count
  credential.used_tokens += tokens_used
  call_limit = _effective_call_limit(credential)
  if call_limit and credential.used_calls >= call_limit:
    credential.status = "exhausted"
    credential.reset_at = datetime.utcnow() + timedelta(hours=1)
  if credential.max_tokens_per_day and credential.used_tokens >= credential.max_tokens_per_day:
    credential.status = "exhausted"
    credential.reset_at = datetime.utcnow() + timedelta(hours=1)
  return credential


def predict_quota_action(credential: Credential, avg_calls_per_minute: float) -> str:
  call_limit = _effective_call_limit(credential)
  remaining_calls = call_limit - credential.used_calls if call_limit else None
  remaining_tokens = (
    credential.max_tokens_per_day - credential.used_tokens
    if credential.max_tokens_per_day
    else None
  )

  if remaining_calls is not None and remaining_calls <= 0:
    return "switch"
  if remaining_tokens is not None and remaining_tokens <= 0:
    return "switch"

  if remaining_calls is not None and avg_calls_per_minute > 0:
    minutes_left = remaining_calls / avg_calls_per_minute
    if minutes_left < 5:
      return "switch"
    if minutes_left < 15:
      return "throttle"

  if remaining_tokens is not None:
    usage_ratio = remaining_tokens / credential.max_tokens_per_day
    if usage_ratio <= 0.05:
      return "switch"
    if usage_ratio <= 0.15:
      return "throttle"

  return "allow"


seed_default_credentials()
