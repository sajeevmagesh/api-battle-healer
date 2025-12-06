# api-battle-healer

## FastAPI Mock Server

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run the server:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### Endpoints

1. `POST /generate-api-key`
   - Body: `{ "userId": "demo-user" }`
   - Returns a token with quotas, retry budget, and TTL.

2. `POST /refresh-token`
   - Body: `{ "token": "<old>" }` (optional) to rotate credentials without waiting for expiry.

3. `GET|POST /simulate-budget`
   - Inspect or mutate per-token quota/ budget counters to force 402/429 behavior.

4. `GET|POST /queue-failed`
   - Append failures into a recovery queue, with overflow simulation once the queue fills up.

5. `POST /mock-response`
   - Return graceful-degradation payloads or feed your own fallback body.

6. `GET|POST /log`
   - Collect structured healing logs; `GET /log` echoes recent entries.

7. `GET|POST /external-api`
   - Requires `Authorization: Bearer <token>`.
   - Supports dev-time triggers (comma-delimited) through:
     - Header `X-Simulate-Failure: region_down,retryable_500,schema_drift,...`
     - Query string `?simulate=mock` or `?simulate=repair`.
   - Built-in scenarios:
     - Retryable failures: `retryable_500`, `region_down`, `quota`
     - Credential healing: tokens expire quickly; use `/refresh-token` or `/generate-api-key`
     - Request repair: include `simulate=repair` to force a 422 with schema hints
     - Schema drift: `schema_drift` randomly renames/omits fields
     - Graceful degradation: `mock` returns cached/stale payloads
     - Budget/quota exhaustion: adjust via `/simulate-budget` to trigger 402/429

8. `POST /simulate-budget`
   - Body: `{ "token": "...", "call_budget_delta": -10 }` etc.

### Example cURL Commands

```bash
# Create a token for demo-user
curl -i http://localhost:8000/generate-api-key \
  -H 'Content-Type: application/json' \
  -d '{"userId":"demo-user"}'

# Use the token to hit the protected API (force schema drift + retryable errors)
curl -i 'http://localhost:8000/external-api?simulate=schema_drift,retryable_500' \
  -H 'Authorization: Bearer token-1234...' \
  -H 'Content-Type: application/json' \
  -d '{"transactionId":"abc-123","amount":99.5}'

# Force quota exhaustion
curl -i http://localhost:8000/simulate-budget \
  -H 'Content-Type: application/json' \
  -d '{"token":"token-1234","quota_delta":-20}'

# Send a structured log from the agent
curl -i http://localhost:8000/log \
  -H 'Content-Type: application/json' \
  -d '{"event":"retry_attempt","metadata":{"attempt":1,"region":"us-east-1"}}'

# Request a graceful degradation payload
curl -s http://localhost:8000/mock-response \
  -H 'Content-Type: application/json' \
  -d '{"reason":"smoke-test","payload":{"message":"cached value"}}'
```

## Next.js Demo UI

Install Node dependencies (already defined in `package.json`):

```bash
npm install
```

Copy the example env file and adjust values as needed:

```bash
cp .env.local.example .env.local
```

Run both servers in separate terminals:

```bash
# Terminal 1: FastAPI backend
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Next.js frontend
npm run dev
```

Open http://localhost:3000 to generate keys, launch `/test-healing`, or try `/openai-test`.

## OpenAI SmartFetch Test

The Next.js app also includes `/openai-test`, which exercises `smartFetch` through a server-side proxy to OpenAI.

1. Copy `.env.local.example` to `.env.local` and set a valid key plus backend origin:
   ```
   OPENAI_API_KEY=sk-your-key
   NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
   ```
2. Restart `npm run dev` so the environment variable loads.
3. Visit http://localhost:3000/openai-test, enter a prompt, and submit. The page calls `/api/openai-proxy`, which relays to OpenAI using your key while letting `smartFetch` handle retries/logging.

### Failure Trigger Cheatsheet

| Trigger Value | Effect |
| ------------- | ------ |
| `region_down` | Returns HTTP 503 with retry budget metadata (region failover) |
| `retryable_500` | Returns HTTP 500 and decrements retry budget |
| `quota` | Immediate 429 to test quota awareness |
| `schema_drift` | Response schema renamed/trimmed |
| `mock` | Returns mocked/stale payload |
| `repair` | Forces 422 with schema hints |
| `malformed` | Alias of `repair` for client testing |

## Gemini-Healing Agent

The TypeScript agent under `src/agent/` loops through decision cycles powered by Gemini 3:

1. Calls `smartFetch` once per cycle to gather fresh failure metadata.
2. Passes condensed state + history to Gemini via `getHealingDecision()`.
3. Executes the returned action through the healing toolkit (token refresh, region failover, schema adaptation, payload repair, queueing, degraded response, etc.).
4. Logs every intervention and continues until success, a graceful degradation, queued recovery, or abort.

Usage sketch:

```ts
import { runHealingAgent } from '@/src/agent';
import { fetchTestApiKey } from '@/src/apiKeys';

const result = await runHealingAgent({
  url: `${process.env.NEXT_PUBLIC_BACKEND_URL}/external-api?simulate=region_down,schema_drift`,
  options: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId: 'demo-1', amount: 42 }),
  },
  regions: [
    process.env.NEXT_PUBLIC_BACKEND_URL!,
    'http://localhost:8000?region=eu',
  ],
  tokenProvider: () => fetchTestApiKey('agent-demo'),
  backendBaseUrl: process.env.NEXT_PUBLIC_BACKEND_URL!,
});
```

Set `GEMINI_API_KEY` (or `NEXT_PUBLIC_GEMINI_API_KEY`) to enable full Gemini planning; otherwise, heuristics handle the decision loop.
