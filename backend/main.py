"""
FastAPI server simulating flaky upstream behavior and logging endpoints.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import random
import time
from typing import Any, Dict

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Battle Healer Mock API", version="0.1.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


EXPECTED_TOKEN = "new-token-abc"
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
TOKEN_REQUEST_LIMIT = 5
TOKEN_REQUEST_WINDOW_SECONDS = 60
_token_request_count = 0
_token_window_start = time.monotonic()
_token_rate_state: Dict[str, Dict[str, Any]] = {}


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
  action: str
  message: str


class RefreshTokenRequest(BaseModel):
  """Payload accepted by /refresh-token."""

  previous_token: str | None = None
  failure_status: int | None = None


class RefreshTokenError(BaseModel):
  """Error payload for /refresh-token quota exhaustion."""

  error: str
  retry_after_seconds: int


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


@app.get(
  "/external-api",
  response_model=ExternalApiResponse,
  responses={
    status.HTTP_401_UNAUTHORIZED: {
      "description": "Missing or invalid credentials",
      "model": ExternalApiError,
    },
    status.HTTP_403_FORBIDDEN: {
      "description": "API key blocked or disabled",
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
  },
  status_code=status.HTTP_200_OK,
)
async def external_api(
  authorization: str = Header(..., description="Bearer access token"),
) -> ExternalApiResponse:
  """Simulate a protected API that randomly fails or succeeds."""
  if not authorization.startswith("Bearer "):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail={"error": "Missing bearer token"},
    )

  now = time.monotonic()
  token = authorization.replace("Bearer ", "", 1).strip()

  if token in BLOCKED_TOKENS:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail={"error": BLOCKED_TOKENS[token]},
    )

  if token in RATE_LIMITED_TOKENS:
    _enforce_token_rate_limit(token, RATE_LIMITED_TOKENS[token], now)

  if token != EXPECTED_TOKEN and token not in RATE_LIMITED_TOKENS:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail={"error": "Invalid token"},
    )

  if random.random() < 0.5:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail={"error": "Region down"},
    )

  return ExternalApiResponse(message="Success!", region="us-east-1")


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
  global _token_request_count
  now = time.monotonic()
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
  request_context = payload or RefreshTokenRequest()

  action = "refresh_token"
  message = "Issued a standard replacement token."
  previous_token = request_context.previous_token or ""
  if previous_token in BLOCKED_TOKENS:
    action = "rotate_token"
    message = BLOCKED_TOKENS[previous_token]
  elif previous_token in RATE_LIMITED_TOKENS:
    message = RATE_LIMITED_TOKENS[previous_token]["message"]

  return RefreshTokenResponse(token=EXPECTED_TOKEN, action=action, message=message)


class LogPayload(BaseModel):
  """Arbitrary log payload provided by the client agent."""

  event: str
  metadata: Dict[str, Any] = {}


@app.post("/log", status_code=status.HTTP_202_ACCEPTED)
async def log_event(payload: LogPayload, request: Request) -> Dict[str, str]:
  """Accept structured logs from the agent and echo acknowledgement."""
  client_host = request.client.host if request.client else "unknown"
  print(f"[agent-log] host={client_host} payload={payload.json()}")
  return {"status": "accepted"}
