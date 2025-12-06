import asyncio
import os
import unittest
from typing import List

os.environ["DISABLE_QUEUE_WORKER"] = "1"

from fastapi.testclient import TestClient

from backend.main import (
  QUEUE_MAX_RETRIES,
  QueueFailedPayload,
  QueueRecord,
  app,
  process_queue_entry,
  reset_queue_state_for_tests,
)


class MockResponse:
  def __init__(self, status_code: int, text: str = "ok"):
    self.status_code = status_code
    self.text = text


class MockAsyncClient:
  def __init__(self, responses: List[MockResponse | Exception]):
    self.responses = responses

  async def request(self, *args, **kwargs):
    if not self.responses:
      raise RuntimeError("No more responses configured")
    response = self.responses.pop(0)
    if isinstance(response, Exception):
      raise response
    return response

  async def aclose(self):
    return


class QueueEndpointTests(unittest.TestCase):
  def setUp(self):
    reset_queue_state_for_tests()
    self.client = TestClient(app)

  def tearDown(self):
    self.client.close()

  def test_queue_failed_accepts_payload(self):
    payload = {
      "request_id": "req-123",
      "correlation_id": "req-123",
      "endpoint": "external-api",
      "provider": "mock",
      "region": "default",
      "method": "GET",
      "url": "http://localhost:8000/external-api",
      "headers": {"x-test": "1"},
      "body": {"demo": True},
      "error_type": "RuntimeError",
      "error_message": "boom",
      "error_status": 503,
      "timestamp": "2024-01-01T00:00:00Z",
      "retry_count": 0,
    }
    response = self.client.post("/queue-failed", json=payload)
    self.assertEqual(response.status_code, 202)
    self.assertEqual(response.json()["status"], "queued")

  def test_queue_failed_rejects_invalid_payload(self):
    response = self.client.post("/queue-failed", json={"endpoint": "missing-fields"})
    self.assertEqual(response.status_code, 422)


class QueueWorkerTests(unittest.TestCase):
  def test_process_queue_entry_success(self):
    payload = QueueFailedPayload(
      request_id="req-success",
      correlation_id="req-success",
      endpoint="external-api",
      provider="mock",
      region="default",
      method="GET",
      url="http://example.com/success",
      headers={},
    )
    record = QueueRecord(id="record-success", payload=payload)
    client = MockAsyncClient([MockResponse(200, "ok")])
    status = asyncio.run(process_queue_entry(record, http_client=client))
    self.assertEqual(status, "completed")
    self.assertEqual(record.last_response_status, 200)

  def test_process_queue_entry_dead_letter(self):
    payload = QueueFailedPayload(
      request_id="req-dead",
      correlation_id="req-dead",
      endpoint="external-api",
      provider="mock",
      region="default",
      method="GET",
      url="http://example.com/failure",
      headers={},
    )
    record = QueueRecord(id="record-dead", payload=payload)
    responses: List[MockResponse | Exception] = [Exception("network")] * (QUEUE_MAX_RETRIES)
    client = MockAsyncClient(responses)
    status = "queued"
    for _ in range(QUEUE_MAX_RETRIES):
      status = asyncio.run(process_queue_entry(record, http_client=client))
      if status == "dead":
        break
    self.assertEqual(status, "dead")
    self.assertGreaterEqual(record.payload.retry_count, QUEUE_MAX_RETRIES)
