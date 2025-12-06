from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional


@dataclass
class Credential:
  id: str
  provider: str
  model: str
  api_key: str
  status: str = "active"  # active | exhausted | disabled
  daily_call_limit: Optional[int] = None
  used_calls: int = 0
  reset_at: Optional[datetime] = None
  last_rotated_at: Optional[datetime] = None
  total_calls: int = 0
  total_tokens: int = 0
  metadata: Dict[str, Any] = field(default_factory=dict)


credential_pool: Dict[str, Credential] = {}
token_to_id: Dict[str, str] = {}
credential_order: List[str] = []
_cursor_index = 0


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


def seed_default_credentials() -> None:
  reset_credentials([
    Credential(
      id="cred-primary",
      provider="battle-healer",
      model="standard",
      api_key="new-token-abc",
      daily_call_limit=200,
    ),
    Credential(
      id="cred-secondary",
      provider="battle-healer",
      model="standard",
      api_key="token-backup-xyz",
      daily_call_limit=150,
    ),
    Credential(
      id="cred-spiky",
      provider="battle-healer",
      model="standard",
      api_key="spiky-token",
      daily_call_limit=20,
    ),
    Credential(
      id="cred-chatty",
      provider="battle-healer",
      model="standard",
      api_key="chatty-token",
      daily_call_limit=40,
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
    if credential.daily_call_limit and credential.used_calls >= credential.daily_call_limit:
      credential.status = "exhausted"
      credential.reset_at = credential.reset_at or (datetime.utcnow() + timedelta(hours=1))
      continue
    credential.last_rotated_at = datetime.utcnow()
    _cursor_index = (idx + 1) % total
    return credential
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
  if credential.daily_call_limit and credential.used_calls >= credential.daily_call_limit:
    credential.status = "exhausted"
    credential.reset_at = datetime.utcnow() + timedelta(hours=1)
  return credential


seed_default_credentials()

