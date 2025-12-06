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
from pydantic import BaseModel

app = FastAPI(title="Battle Healer Mock API", version="0.1.0")


EXPECTED_TOKEN = "new-token-abc"
DEPRECATED_TOKENS = {
  "legacy-token-abc": "API key legacy-token-abc has been deprecated. Request a new token.",
  "legacy-token-eu": "Region-specific legacy token detected. Please rotate credentials.",
}
TOKEN_REQUEST_LIMIT = 5
TOKEN_REQUEST_WINDOW_SECONDS = 60
_token_request_count = 0
_token_window_start = time.monotonic()


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


@app.get(
  "/external-api",
  response_model=ExternalApiResponse,
  responses={
    status.HTTP_401_UNAUTHORIZED: {
      "description": "Missing or invalid credentials",
      "model": ExternalApiError,
    },
    status.HTTP_410_GONE: {
      "description": "Deprecated API token used",
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

  token = authorization.replace("Bearer ", "", 1).strip()
  if token in DEPRECATED_TOKENS:
    raise HTTPException(
      status_code=status.HTTP_410_GONE,
      detail={"error": DEPRECATED_TOKENS[token]},
    )

  if token != EXPECTED_TOKEN:
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
async def refresh_token() -> RefreshTokenResponse:
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
  return RefreshTokenResponse(token=EXPECTED_TOKEN)


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
