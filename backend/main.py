"""
FastAPI server simulating flaky upstream behavior and logging endpoints.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import random
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional
from uuid import uuid4

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict

from .credentials import (
  get_credential_by_token,
  get_next_credential,
  mark_credential_status_by_token,
  note_call,
  predict_quota_action,
  record_usage,
  seconds_until_reset,
)

app = FastAPI(title="Battle Healer Mock API", version="0.1.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

logging.basicConfig(level=os.getenv("HEALER_LOG_LEVEL", "INFO"))
logger = logging.getLogger("healing")

QUEUE_POLL_INTERVAL_SECONDS = float(os.getenv("QUEUE_POLL_INTERVAL_SECONDS", "5"))
QUEUE_MAX_RETRIES = int(os.getenv("QUEUE_MAX_RETRIES", "5"))
QUEUE_OVERFLOW_THRESHOLD = int(os.getenv("QUEUE_OVERFLOW_THRESHOLD", "200"))
QUEUE_DEAD_ALERT_THRESHOLD = int(os.getenv("QUEUE_DEAD_ALERT_THRESHOLD", "20"))
QUEUE_DEAD_ALERT_WINDOW_SECONDS = int(os.getenv("QUEUE_DEAD_ALERT_WINDOW_SECONDS", "300"))
DISABLE_QUEUE_WORKER = os.getenv("DISABLE_QUEUE_WORKER", "0") == "1"


BLOCKED_TOKENS = {
  "blocked-token-001": "API key blocked due to suspicious activity. Contact support.",
  "disabled-token-eu": "API key disabled in the EU region. Provision a new key.",
}
RATE_LIMITED_TOKENS = {
  "spiky-token": {
    "message": "Token request burst detected. Throttling applied.",
    "limit": 2,
    "window_seconds": 30,
  },
  "chatty-token": {
    "message": "Too many requests for this API key. Wait before retrying.",
    "limit": 5,
    "window_seconds": 60,
  },
}
DEPRECATED_REGIONS = {
  "deprecated-eu": "Region deprecated. Please migrate your traffic.",
}
UNHEALTHY_REGIONS = {
  "maintenance-ap": "Region is temporarily unavailable for maintenance.",
}
TOKEN_REQUEST_LIMIT = 5
TOKEN_REQUEST_WINDOW_SECONDS = 60
_token_request_count = 0
_token_window_start = time.monotonic()
_token_rate_state: Dict[str, Dict[str, Any]] = {}
queue_entries: Dict[str, "QueueRecord"] = {}
queue_lock = asyncio.Lock()
dead_entry_history: Deque[datetime] = deque(maxlen=1000)
recent_log_events: Deque[Dict[str, Any]] = deque(maxlen=500)


def reset_queue_state_for_tests() -> None:
  """Utility for test suites to reset queue state."""
  queue_entries.clear()
  dead_entry_history.clear()
  recent_log_events.clear()


def log_healing_event(event: str, **context: Any) -> None:
  payload = {"event": event, **context}
  logger.info(json.dumps(payload, default=str))
  recent_log_events.append(payload)


class ExternalApiResponse(BaseModel):
  """Successful payload for /external-api."""

  message: str
  region: str


class ExternalApiError(BaseModel):
  """Error payload for /external-api when a region is unhealthy."""

  error: str


class RefreshTokenResponse(BaseModel):
  """Payload returned from /refresh-token."""

  token: str
  credential_id: str
  action: str
  message: str


class RefreshTokenRequest(BaseModel):
  """Payload accepted by /refresh-token."""

  previous_token: str | None = None
  failure_status: int | None = None
  provider: str = "battle-healer"
  model: str = "standard"


class RefreshTokenError(BaseModel):
  """Error payload for /refresh-token quota exhaustion."""

  error: str
  retry_after_seconds: int


class GenerateApiKeyRequest(BaseModel):
  """Payload accepted by /generate-api-key."""

  user_id: str | None = Field(default=None, alias="userId")
  provider: str = "battle-healer"
  model: str = "standard"

  model_config = ConfigDict(populate_by_name=True)


class GenerateApiKeyResponse(BaseModel):
  """Response payload for /generate-api-key."""

  token: str
  credential_id: str
  provider: str
  model: str
  status: str
  daily_call_limit: int | None = None
  used_calls: int = 0


class QueueFailedPayload(BaseModel):
  """Payload accepted by /queue-failed."""

  request_id: str
  correlation_id: str | None = None
  endpoint: str
  provider: str | None = None
  region: str | None = None
  method: str
  url: str
  headers: Dict[str, str] = Field(default_factory=dict)
  body: Any | None = None
  error_type: str | None = None
  error_message: str | None = None
  error_status: int | None = None
  timestamp: datetime = Field(default_factory=datetime.utcnow)
  retry_count: int = 0


class MockResponsePayload(BaseModel):
  """Payload accepted by /mock-response."""

  schema_hint: Dict[str, Any] | None = None
  example_response: Any | None = None
  cached_payload: Any | None = None
  provider: str | None = None
  endpoint: str | None = None
  reason: str | None = None
  error: str | None = None
  metadata: Dict[str, Any] | None = None


class MockResponseResult(BaseModel):
  """Response returned from /mock-response."""

  mock: Any
  degradation: str = "mocked"
  reason: str
  source: str = "llm-mock"
  original_error: str | None = None


class LogPayload(BaseModel):
  """Arbitrary log payload provided by the client agent."""

  event: str
  metadata: Dict[str, Any] = {}


class QueueStatusResponse(BaseModel):
  """Response for queue status endpoint."""

  queued: int
  running: int
  dead_recent: int


class LogListResponse(BaseModel):
  """Response for retrieving logs."""

  logs: List[Dict[str, Any]]


@dataclass
class QueueRecord:
  """In-memory representation of a queued replay."""

  id: str
  payload: QueueFailedPayload
  status: str = "queued"
  created_at: datetime = field(default_factory=datetime.utcnow)
  updated_at: datetime = field(default_factory=datetime.utcnow)
  next_retry_at: datetime = field(default_factory=datetime.utcnow)
  last_response_status: Optional[int] = None
  last_response_excerpt: Optional[str] = None


def _reset_token_window(now: float) -> None:
  """Reset the token quota window if enough time has elapsed."""
  global _token_request_count, _token_window_start
  if now - _token_window_start >= TOKEN_REQUEST_WINDOW_SECONDS:
    _token_window_start = now
    _token_request_count = 0


def _remaining_window_seconds(now: float) -> int:
  """Return how many seconds remain before the quota resets."""
  remaining = TOKEN_REQUEST_WINDOW_SECONDS - (now - _token_window_start)
  if remaining <= 0:
    return 1
  return max(1, int(remaining))


def _enforce_token_rate_limit(token: str, cfg: Dict[str, Any], now: float) -> None:
  """Rate-limit specific API keys to simulate exhausted quotas."""
  state = _token_rate_state.get(token)
  window = cfg["window_seconds"]
  if not state or now - state["window_start"] >= window:
    _token_rate_state[token] = {
      "count": 0,
      "window_start": now,
    }
    state = _token_rate_state[token]

  if state["count"] >= cfg["limit"]:
    retry_after = window - (now - state["window_start"])
    retry_after_seconds = max(1, int(retry_after))
    raise HTTPException(
      status_code=status.HTTP_429_TOO_MANY_REQUESTS,
      detail={
        "error": cfg["message"],
        "retry_after_seconds": retry_after_seconds,
      },
      headers={"Retry-After": str(retry_after_seconds)},
    )

  state["count"] += 1


def _acquire_token_issue_slot(now: float) -> None:
  """Global quota guard for issuing new credentials."""
  global _token_request_count
  _reset_token_window(now)
  if _token_request_count >= TOKEN_REQUEST_LIMIT:
    retry_after = _remaining_window_seconds(now)
    raise HTTPException(
      status_code=status.HTTP_429_TOO_MANY_REQUESTS,
      detail={
        "error": "Token request quota exceeded. Please wait before retrying.",
        "retry_after_seconds": retry_after,
      },
      headers={"Retry-After": str(retry_after)},
    )
  _token_request_count += 1


def _process_previous_token(previous_token: str, failure_status: int | None) -> tuple[str, str]:
  """Mark prior credentials based on the reported failure status."""
  action = "refresh_token"
  message = "Issued a standard replacement token."
  if not previous_token:
    return action, message

  if previous_token in BLOCKED_TOKENS or failure_status == status.HTTP_403_FORBIDDEN:
    reason = BLOCKED_TOKENS.get(previous_token, "Provider blocked previous credential.")
    mark_credential_status_by_token(previous_token, "disabled", reason=reason)
    log_healing_event(
      "CREDENTIAL_MARKED",
      token=previous_token,
      status="disabled",
      reason=reason,
      failure_status=failure_status,
    )
    return "rotate_token", reason

  if failure_status == status.HTTP_401_UNAUTHORIZED:
    reason = "Credential rejected due to authentication failure."
    mark_credential_status_by_token(previous_token, "disabled", reason=reason)
    log_healing_event(
      "CREDENTIAL_MARKED",
      token=previous_token,
      status="disabled",
      reason=reason,
      failure_status=failure_status,
    )
    return "rotate_token", reason

  if failure_status == status.HTTP_429_TOO_MANY_REQUESTS:
    cfg = RATE_LIMITED_TOKENS.get(previous_token)
    cooldown = cfg["window_seconds"] if cfg else TOKEN_REQUEST_WINDOW_SECONDS
    reason = cfg["message"] if cfg else "Rate limit exceeded for credential."
    mark_credential_status_by_token(
      previous_token,
      "exhausted",
      reason=reason,
      cooldown_seconds=cooldown,
    )
    log_healing_event(
      "CREDENTIAL_MARKED",
      token=previous_token,
      status="exhausted",
      reason=reason,
      failure_status=failure_status,
      cooldown_seconds=cooldown,
    )
    return action, "Previous credential temporarily exhausted. Selecting alternate token."

  if failure_status == status.HTTP_410_GONE:
    reason = "Region deprecated. Prefer alternative credential."
    mark_credential_status_by_token(previous_token, "disabled", reason=reason)
    log_healing_event(
      "CREDENTIAL_MARKED",
      token=previous_token,
      status="disabled",
      reason=reason,
      failure_status=failure_status,
    )
    return "rotate_token", reason

  return action, message


def _sanitize_headers(headers: Dict[str, str]) -> Dict[str, str]:
  blocked = {"authorization", "proxy-authorization", "cookie"}
  return {
    key: value
    for key, value in headers.items()
    if key.lower() not in blocked
  }


def _estimate_tokens(region_label: str, body_size: int = 0) -> int:
  base = 150 + len(region_label) * 5
  body_component = body_size // 4
  jitter = random.randint(10, 50)
  return max(100, base + body_component + jitter)


def _generate_mock_payload(payload: MockResponsePayload) -> Any:
  base: Dict[str, Any] = {}
  if isinstance(payload.cached_payload, dict):
    base.update(payload.cached_payload)
  elif isinstance(payload.example_response, dict):
    base.update(payload.example_response)
  elif isinstance(payload.example_response, list) and payload.example_response:
    candidate = payload.example_response[0]
    if isinstance(candidate, dict):
      base.update(candidate)

  schema_fields: List[str] = []
  if isinstance(payload.schema_hint, dict):
    schema_fields = list(payload.schema_hint.keys())
    if "fieldMap" in payload.schema_hint and isinstance(payload.schema_hint["fieldMap"], dict):
      schema_fields.extend(payload.schema_hint["fieldMap"].keys())

  for field in schema_fields:
    if field not in base:
      base[field] = f"MOCK_{field.upper()}_{random.randint(100, 999)}"

  if not base:
    base["mock"] = f"MOCK_VALUE_{random.randint(1000, 9999)}"
    base["timestamp"] = datetime.utcnow().isoformat()

  return base


def _prepare_queue_payload(payload: QueueFailedPayload) -> QueueFailedPayload:
  data = payload.model_dump()
  data["headers"] = _sanitize_headers(data.get("headers") or {})
  data["correlation_id"] = data.get("correlation_id") or data["request_id"]
  return QueueFailedPayload(**data)


def _create_queue_record(payload: QueueFailedPayload) -> QueueRecord:
  prepared = _prepare_queue_payload(payload)
  return QueueRecord(
    id=str(uuid4()),
    payload=prepared,
    next_retry_at=datetime.utcnow(),
  )


async def enqueue_queue_payload(payload: QueueFailedPayload) -> QueueRecord:
  record = _create_queue_record(payload)
  async with queue_lock:
    queue_entries[record.id] = record
    queue_length = len(queue_entries)
  log_healing_event(
    "QUEUE_ENQUEUED",
    queue_id=record.id,
    correlation_id=record.payload.correlation_id,
    provider=record.payload.provider,
    region=record.payload.region,
    endpoint=record.payload.endpoint,
  )
  _check_queue_overflow(queue_length, record)
  return record


def _check_queue_overflow(queue_length: int, record: QueueRecord) -> None:
  if queue_length > QUEUE_OVERFLOW_THRESHOLD:
    log_healing_event(
      "QUEUE_OVERFLOW",
      provider=record.payload.provider,
      region=record.payload.region,
      count=queue_length,
    )


def _record_dead_event(record: QueueRecord) -> None:
  now = datetime.utcnow()
  dead_entry_history.append(now)
  window_start = now - timedelta(seconds=QUEUE_DEAD_ALERT_WINDOW_SECONDS)
  recent = sum(1 for ts in dead_entry_history if ts >= window_start)
  if recent >= QUEUE_DEAD_ALERT_THRESHOLD:
    log_healing_event(
      "QUEUE_DEAD_EXCEEDED",
      provider=record.payload.provider,
      region=record.payload.region,
      recent_dead=recent,
    )


async def process_queue_entry(
  record: QueueRecord,
  *,
  http_client: httpx.AsyncClient | None = None,
) -> str:
  close_client = False
  client = http_client
  if client is None:
    client = httpx.AsyncClient(timeout=10)
    close_client = True

  try:
    request_kwargs: Dict[str, Any] = {
      "method": record.payload.method,
      "url": record.payload.url,
      "headers": record.payload.headers,
    }
    if record.payload.body is not None:
      if isinstance(record.payload.body, (dict, list)):
        request_kwargs["json"] = record.payload.body
      else:
        request_kwargs["content"] = (
          record.payload.body
          if isinstance(record.payload.body, (bytes, bytearray))
          else str(record.payload.body)
        )
    response = await client.request(**request_kwargs)
    record.last_response_status = response.status_code
    record.last_response_excerpt = response.text[:200]
    record.status = "completed"
    record.updated_at = datetime.utcnow()
    log_healing_event(
      "QUEUE_REPLAY_SUCCESS",
      queue_id=record.id,
      correlation_id=record.payload.correlation_id,
      status=response.status_code,
    )
    return record.status
  except Exception as error:  # pragma: no cover - log branch
    record.payload.retry_count += 1
    record.updated_at = datetime.utcnow()
    if record.payload.retry_count >= QUEUE_MAX_RETRIES:
      record.status = "dead"
      record.next_retry_at = record.updated_at
      record.last_response_excerpt = str(error)
      log_healing_event(
        "QUEUE_REPLAY_DEAD",
        queue_id=record.id,
        correlation_id=record.payload.correlation_id,
        error=str(error),
      )
      _record_dead_event(record)
      return record.status

    delay = min(60, 2 ** record.payload.retry_count)
    record.next_retry_at = record.updated_at + timedelta(seconds=delay)
    record.status = "queued"
    record.last_response_excerpt = str(error)
    log_healing_event(
      "QUEUE_RETRY_SCHEDULED",
      queue_id=record.id,
      correlation_id=record.payload.correlation_id,
      retry_count=record.payload.retry_count,
      next_retry_at=record.next_retry_at.isoformat(),
    )
    return record.status
  finally:
    if close_client:
      await client.aclose()


async def queue_worker() -> None:
  while True:
    await asyncio.sleep(QUEUE_POLL_INTERVAL_SECONDS)
    await _process_queue_batch()


async def _process_queue_batch() -> None:
  now = datetime.utcnow()
  due_records: List[QueueRecord] = []
  async with queue_lock:
    for record in queue_entries.values():
      if record.status in {"queued", "retrying"} and record.next_retry_at <= now:
        record.status = "running"
        record.updated_at = now
        due_records.append(record)

  for record in due_records:
    status_result = await process_queue_entry(record)
    if status_result in {"completed", "dead"}:
      async with queue_lock:
        queue_entries.pop(record.id, None)


@app.on_event("startup")
async def start_background_workers() -> None:
  if DISABLE_QUEUE_WORKER:
    log_healing_event("QUEUE_WORKER_SKIPPED", reason="disabled via env")
    return
  worker = asyncio.create_task(queue_worker())
  app.state.queue_worker = worker
  log_healing_event("QUEUE_WORKER_STARTED")


@app.on_event("shutdown")
async def stop_background_workers() -> None:
  worker: asyncio.Task | None = getattr(app.state, "queue_worker", None)
  if worker:
    worker.cancel()
    with contextlib.suppress(asyncio.CancelledError):
      await worker



EXTERNAL_API_RESPONSES = {
  status.HTTP_401_UNAUTHORIZED: {
    "description": "Missing or invalid credentials",
    "model": ExternalApiError,
  },
  status.HTTP_403_FORBIDDEN: {
    "description": "API key blocked or disabled",
    "model": ExternalApiError,
  },
  status.HTTP_410_GONE: {
    "description": "Deprecated region targeted",
    "model": ExternalApiError,
  },
  status.HTTP_429_TOO_MANY_REQUESTS: {
    "description": "API key rate limit exceeded",
    "model": ExternalApiError,
  },
  status.HTTP_503_SERVICE_UNAVAILABLE: {
    "description": "Simulated region outage",
    "model": ExternalApiError,
  },
}


@app.get(
  "/external-api",
  response_model=ExternalApiResponse,
  responses=EXTERNAL_API_RESPONSES,
  status_code=status.HTTP_200_OK,
)
async def external_api(
  authorization: str = Header(..., description="Bearer access token"),
) -> ExternalApiResponse:
  """Default region endpoint."""
  return _handle_external_api(authorization=authorization, region_hint="default")


@app.post(
  "/external-api",
  response_model=ExternalApiResponse,
  responses=EXTERNAL_API_RESPONSES,
  status_code=status.HTTP_200_OK,
)
async def external_api_post(
  authorization: str = Header(..., description="Bearer access token"),
) -> ExternalApiResponse:
  """POST variant for clients that need to send bodies."""
  return _handle_external_api(authorization=authorization, region_hint="default")


@app.get(
  "/regions/{region}/external-api",
  response_model=ExternalApiResponse,
  responses=EXTERNAL_API_RESPONSES,
  status_code=status.HTTP_200_OK,
)
async def regional_external_api(
  region: str,
  authorization: str = Header(..., description="Bearer access token"),
) -> ExternalApiResponse:
  """Region-scoped endpoint to demonstrate failover."""
  return _handle_external_api(authorization=authorization, region_hint=region)


@app.post(
  "/regions/{region}/external-api",
  response_model=ExternalApiResponse,
  responses=EXTERNAL_API_RESPONSES,
  status_code=status.HTTP_200_OK,
)
async def regional_external_api_post(
  region: str,
  authorization: str = Header(..., description="Bearer access token"),
) -> ExternalApiResponse:
  """POST variant for the region-scoped endpoint."""
  return _handle_external_api(authorization=authorization, region_hint=region)


def _handle_external_api(*, authorization: str, region_hint: str) -> ExternalApiResponse:
  """Shared handler for the external API."""
  if not authorization.startswith("Bearer "):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail={"error": "Missing bearer token"},
    )

  now = time.monotonic()
  token = authorization.replace("Bearer ", "", 1).strip()
  region_label = (region_hint or "default").lower()

  if region_label in DEPRECATED_REGIONS:
    raise HTTPException(
      status_code=status.HTTP_410_GONE,
      detail={"error": DEPRECATED_REGIONS[region_label]},
    )

  if region_label in UNHEALTHY_REGIONS:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail={"error": UNHEALTHY_REGIONS[region_label]},
    )

  credential = get_credential_by_token(token)

  if token in BLOCKED_TOKENS:
    mark_credential_status_by_token(token, "disabled", reason=BLOCKED_TOKENS[token])
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail={"error": BLOCKED_TOKENS[token]},
    )

  if token in RATE_LIMITED_TOKENS:
    _enforce_token_rate_limit(token, RATE_LIMITED_TOKENS[token], now)

  if credential is None:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail={"error": "Invalid token"},
    )

  if credential.status == "disabled":
    message = credential.metadata.get("status_reason", "Credential disabled.")
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail={"error": message},
    )

  if credential.status == "exhausted":
    retry_after = seconds_until_reset(credential) or 60
    raise HTTPException(
      status_code=status.HTTP_429_TOO_MANY_REQUESTS,
      detail={
        "error": "Credential quota exhausted. Awaiting reset.",
        "retry_after_seconds": retry_after,
      },
      headers={"Retry-After": str(retry_after)},
    )

  tokens_used = _estimate_tokens(region_label)
  record_usage(credential.id, tokens_used=tokens_used, call_count=1)
  avg_calls = note_call(credential.id)
  quota_action = predict_quota_action(credential, avg_calls)
  if quota_action != "allow":
    log_healing_event(
      "CREDENTIAL_QUOTA_SIGNAL",
      credential_id=credential.id,
      action=quota_action,
      avg_calls_per_min=round(avg_calls, 2),
      remaining_calls=(
        (credential.max_calls_per_day or credential.daily_call_limit or 0) - credential.used_calls
      ),
      remaining_tokens=(
        (credential.max_tokens_per_day or 0) - credential.used_tokens
        if credential.max_tokens_per_day
        else None
      ),
    )
    if quota_action == "switch":
      credential.status = "exhausted"
      credential.reset_at = credential.reset_at or datetime.utcnow() + timedelta(minutes=15)

  if random.random() < 0.5:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail={"error": "Region down"},
    )

  return ExternalApiResponse(message="Success!", region=region_label or "default")


@app.post(
  "/generate-api-key",
  response_model=GenerateApiKeyResponse,
  status_code=status.HTTP_200_OK,
)
async def generate_api_key(payload: GenerateApiKeyRequest) -> GenerateApiKeyResponse:
  """Issue an API credential from the in-memory pool."""
  now = time.monotonic()
  _acquire_token_issue_slot(now)

  credential = get_next_credential(payload.provider, payload.model)
  if not credential:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail={"error": "No credentials available for requested provider/model."},
    )

  log_healing_event(
    "CREDENTIAL_ISSUED",
    credential_id=credential.id,
    provider=credential.provider,
    model=credential.model,
    issued_for=payload.user_id or "anonymous",
    via="generate",
  )

  return GenerateApiKeyResponse(
    token=credential.api_key,
    credential_id=credential.id,
    provider=credential.provider,
    model=credential.model,
    status=credential.status,
    daily_call_limit=credential.daily_call_limit,
    used_calls=credential.used_calls,
  )


@app.post(
  "/refresh-token",
  response_model=RefreshTokenResponse,
  responses={
    status.HTTP_429_TOO_MANY_REQUESTS: {
      "description": "Token quota exhausted",
      "model": RefreshTokenError,
    }
  },
  status_code=status.HTTP_200_OK,
)
async def refresh_token(payload: RefreshTokenRequest | None = None) -> RefreshTokenResponse:
  """Return a fresh token to satisfy the external API."""
  now = time.monotonic()
  _acquire_token_issue_slot(now)
  request_context = payload or RefreshTokenRequest()

  previous_token = request_context.previous_token or ""
  action, message = _process_previous_token(previous_token, request_context.failure_status)

  credential = get_next_credential(request_context.provider, request_context.model)
  if not credential:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail={"error": "No healthy credentials available for rotation."},
    )

  log_healing_event(
    "CREDENTIAL_ISSUED",
    credential_id=credential.id,
    provider=credential.provider,
    model=credential.model,
    via="refresh",
    action=action,
  )

  return RefreshTokenResponse(
    token=credential.api_key,
    credential_id=credential.id,
    action=action,
    message=message,
  )


@app.post("/mock-response", response_model=MockResponseResult)
async def mock_response(payload: MockResponsePayload) -> MockResponseResult:
  """Return a synthetic response used for graceful degradation."""
  mock_payload = _generate_mock_payload(payload)
  reason = payload.reason or "Provider outage; synthetic mock generated"
  return MockResponseResult(
    mock=mock_payload,
    reason=reason,
    original_error=payload.error,
  )


@app.post("/queue-failed", status_code=status.HTTP_202_ACCEPTED)
async def queue_failed(payload: QueueFailedPayload) -> Dict[str, str]:
  """Accept failed requests for queued recovery."""
  record = await enqueue_queue_payload(payload)
  return {"status": "queued", "id": record.id}


@app.get("/queue-status", response_model=QueueStatusResponse)
async def queue_status() -> QueueStatusResponse:
  async with queue_lock:
    snapshot = list(queue_entries.values())
  queued = sum(1 for entry in snapshot if entry.status in {"queued", "retrying"})
  running = sum(1 for entry in snapshot if entry.status == "running")
  now = datetime.utcnow()
  window = now - timedelta(minutes=10)
  dead_recent = sum(1 for ts in dead_entry_history if ts >= window)
  return QueueStatusResponse(queued=queued, running=running, dead_recent=dead_recent)


@app.post("/log", status_code=status.HTTP_202_ACCEPTED)
async def log_event(payload: LogPayload, request: Request) -> Dict[str, str]:
  """Accept structured logs from the agent and echo acknowledgement."""
  client_host = request.client.host if request.client else "unknown"
  print(f"[agent-log] host={client_host} payload={payload.json()}")
  recent_log_events.append({"event": payload.event, "metadata": payload.metadata, "host": client_host})
  return {"status": "accepted"}


@app.get("/logs", response_model=LogListResponse)
async def get_logs(
  correlation_id: str | None = None,
  limit: int = 50,
) -> LogListResponse:
  entries = list(recent_log_events)
  if correlation_id:
    filtered = [entry for entry in entries if entry.get("correlation_id") == correlation_id]
  else:
    filtered = entries
  return LogListResponse(logs=filtered[-limit:])
