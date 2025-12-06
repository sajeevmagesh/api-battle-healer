"""
FastAPI server simulating flaky upstream behavior and logging endpoints.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import random
from typing import Any, Dict

from fastapi import FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel

app = FastAPI(title="Battle Healer Mock API", version="0.1.0")


EXPECTED_TOKEN = "new-token-abc"


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


@app.get(
  "/external-api",
  response_model=ExternalApiResponse,
  responses={
    status.HTTP_401_UNAUTHORIZED: {
      "description": "Missing or invalid credentials",
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
  status_code=status.HTTP_200_OK,
)
async def refresh_token() -> RefreshTokenResponse:
  """Return a fresh token to satisfy the external API."""
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
