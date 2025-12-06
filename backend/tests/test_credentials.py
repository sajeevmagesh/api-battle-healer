import unittest

from backend.credentials import (
  Credential,
  get_next_credential,
  mark_credential_status,
  record_usage,
  reset_credentials,
  seed_default_credentials,
)


class CredentialPoolTests(unittest.TestCase):
  def setUp(self) -> None:
    reset_credentials([
      Credential(
        id="cred-a",
        provider="demo",
        model="std",
        api_key="token-a",
        daily_call_limit=1,
      ),
      Credential(
        id="cred-b",
        provider="demo",
        model="std",
        api_key="token-b",
        daily_call_limit=5,
      ),
      Credential(
        id="cred-disabled",
        provider="demo",
        model="std",
        api_key="token-disabled",
        status="disabled",
      ),
    ])

  def tearDown(self) -> None:
    seed_default_credentials()

  def test_rotates_when_quota_hit(self) -> None:
    first = get_next_credential("demo", "std")
    self.assertIsNotNone(first)
    self.assertEqual(first.id, "cred-a")
    record_usage(first.id, call_count=1)

    second = get_next_credential("demo", "std")
    self.assertIsNotNone(second)
    self.assertEqual(second.id, "cred-b")

  def test_skips_disabled_credentials(self) -> None:
    mark_credential_status("cred-a", "disabled", reason="test")
    next_cred = get_next_credential("demo", "std")
    self.assertIsNotNone(next_cred)
    self.assertEqual(next_cred.id, "cred-b")


if __name__ == "__main__":
  unittest.main()
