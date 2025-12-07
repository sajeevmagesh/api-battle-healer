import argparse
import json
import os
from typing import Any

import requests

DEFAULT_BACKEND = os.getenv('HEALER_BACKEND_URL', 'http://localhost:8000')
DEFAULT_FRONTEND = os.getenv('HEALER_FRONTEND_URL', 'http://localhost:3000')


def cmd_test_request(args: argparse.Namespace) -> None:
  url = f"{args.frontend.rstrip('/')}/api/heal-runner"
  response = requests.post(url, json={'simulate': args.simulate})
  response.raise_for_status()
  data = response.json()
  print(json.dumps(data, indent=2))


def cmd_queue_status(args: argparse.Namespace) -> None:
  response = requests.get(f"{args.backend.rstrip('/')}/queue-status")
  response.raise_for_status()
  print(json.dumps(response.json(), indent=2))


def cmd_logs(args: argparse.Namespace) -> None:
  params: dict[str, Any] = {'limit': args.limit}
  if args.correlation_id:
    params['correlation_id'] = args.correlation_id
  response = requests.get(f"{args.backend.rstrip('/')}/logs", params=params)
  response.raise_for_status()
  logs = response.json()
  print(json.dumps(logs, indent=2))


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(description='Battle Healer CLI helper')
  parser.set_defaults(func=None)
  parser.add_argument('--backend', default=DEFAULT_BACKEND, help='Healing backend URL')
  parser.add_argument('--frontend', default=DEFAULT_FRONTEND, help='Next.js frontend URL (for test requests)')

  subparsers = parser.add_subparsers(dest='command')

  test_parser = subparsers.add_parser('test-request', help='Send a test request through the healing agent')
  test_parser.add_argument('--simulate', default='region_down,retryable_500,repair', help='Simulation triggers passed to the agent')
  test_parser.set_defaults(func=cmd_test_request)

  queue_parser = subparsers.add_parser('queue-status', help='Show queue metrics')
  queue_parser.set_defaults(func=cmd_queue_status)

  log_parser = subparsers.add_parser('logs', help='Inspect healing logs')
  log_parser.add_argument('--correlation-id', help='Correlation ID to filter by')
  log_parser.add_argument('--limit', type=int, default=25)
  log_parser.set_defaults(func=cmd_logs)

  return parser


def main() -> None:
  parser = build_parser()
  args = parser.parse_args()
  if not args.func:
    parser.print_help()
    return
  args.func(args)


if __name__ == '__main__':
  main()
