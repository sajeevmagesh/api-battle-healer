import functools
import json
import os
import time
import uuid
from typing import Any, Callable, Optional

import requests


def heal_api_call(
  endpoint: str,
  *,
  provider: str = "battle-healer",
  backend_url: Optional[str] = None,
  queue_on_failure: bool = True,
  retry_attempts: int = 0,
  retry_delay_seconds: float = 0.5,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
  """Decorator that wraps an API call with simple healing assistance.

  On failure it optionally retries once and enqueues the request metadata on the
  healing backend so that the queue worker can replay it later.
  """

  base_backend = backend_url or os.getenv("HEALER_BACKEND_URL", "http://localhost:8000")

  def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
      correlation_id = kwargs.pop("healer_correlation_id", None) or f"py-{uuid.uuid4()}"
      attempts = 0
      while True:
        try:
          return func(*args, **kwargs)
        except Exception as exc:  # pragma: no cover - network/logging side effects
          attempts += 1
          if attempts <= retry_attempts:
            time.sleep(retry_delay_seconds)
            continue
          if queue_on_failure:
            _queue_failure(
              backend_url=base_backend,
              provider=provider,
              endpoint=endpoint,
              correlation_id=correlation_id,
              error=str(exc),
              payload={"args": repr(args), "kwargs": repr(kwargs)},
            )
          raise

    return wrapper

  return decorator


def _queue_failure(
  *,
  backend_url: str,
  provider: str,
  endpoint: str,
  correlation_id: str,
  error: str,
  payload: dict,
) -> None:
  try:
    requests.post(
      f"{backend_url}/queue-failed",
      json={
        "request_id": f"decorator-{int(time.time()*1000)}",
        "correlation_id": correlation_id,
        "endpoint": endpoint,
        "provider": provider,
        "region": "python-sdk",
        "method": "DECORATED",
        "url": endpoint,
        "headers": {},
        "body": json.dumps(payload),
        "error_type": "python.decorator",
        "error_message": error,
        "retry_count": 0,
      },
      timeout=5,
    )
  except Exception as queue_error:  # pragma: no cover - logging fallback
    print(f"[healing-sdk] failed to queue recovery: {queue_error}")
