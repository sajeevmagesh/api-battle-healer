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

1. `GET /external-api`
   - Requires `Authorization: Bearer new-token-abc`.
   - Returns 200 with `{ "message": "Success!", "region": "us-east-1" }` or 503 with `{ "error": "Region down" }`.
   - A 401 is returned when the token is missing or invalid.

2. `POST /refresh-token`
   - Always returns `{ "token": "new-token-abc" }`.

3. `POST /log`
   - Accepts structured JSON logs and writes them to stdout.

### Example cURL Commands

```bash
# Attempt the external API with an invalid token (expect 401)
curl -i http://localhost:8000/external-api \
  -H 'Authorization: Bearer bad-token'

# Fetch a new token
curl -s http://localhost:8000/refresh-token

# Call the external API with the good token (may 200 or 503)
curl -i http://localhost:8000/external-api \
  -H 'Authorization: Bearer new-token-abc'

# Send a structured log from the agent
curl -i http://localhost:8000/log \
  -H 'Content-Type: application/json' \
  -d '{"event":"retry_attempt","metadata":{"attempt":1,"region":"us-east-1"}}'
```
