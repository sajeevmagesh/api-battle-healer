import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { smartFetch, SmartFetchResult, type TokenRecoveryContext } from '../src/smartFetch';
import { ROUTING_TREE, flattenRoutingTree } from '../src/config/routing';

type ApiResult = SmartFetchResult<Record<string, unknown>>;

const TOKEN_SCENARIOS = [
  {
    id: 'valid',
    label: 'Valid token (new-token-abc)',
    token: 'new-token-abc',
  },
  {
    id: 'invalid',
    label: 'Invalid token (401 unauthorized)',
    token: 'bad-token',
  },
  {
    id: 'blocked',
    label: 'Blocked token blocked-token-001 (403)',
    token: 'blocked-token-001',
  },
  {
    id: 'rate-limited',
    label: 'Rate-limited token spiky-token (429 after bursts)',
    token: 'spiky-token',
  },
] as const;

const makeSessionKey = () =>
  `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const INITIAL_SESSION_KEY = 'session-initial';
const ROUTING_PRESET = ROUTING_TREE.children
  ?.map((node) => node.endpoint)
  .join(', ') ?? 'http://localhost:8000';

export default function TestHealingPage() {
  const [result, setResult] = useState<ApiResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tokenScenario, setTokenScenario] =
    useState<(typeof TOKEN_SCENARIOS)[number]['id']>('invalid');
  const [customToken, setCustomToken] = useState('');
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryBudgetLimit, setRetryBudgetLimit] = useState(3);
  const [retryBudgetWindowSeconds, setRetryBudgetWindowSeconds] = useState(60);
  const [regionsInput, setRegionsInput] = useState('http://localhost:8000');
  const [sessionKey, setSessionKey] = useState(INITIAL_SESSION_KEY);

  useEffect(() => {
    setSessionKey(makeSessionKey());
  }, []);

  const activeToken = customToken.trim()
    || TOKEN_SCENARIOS.find((scenario) => scenario.id === tokenScenario)?.token
    || 'bad-token';

  const regionList = useMemo(() => {
    const values = regionsInput
      .split(',')
      .map((region) => region.trim())
      .filter(Boolean);
    return values.length ? values : [''];
  }, [regionsInput]);

  const handleLoadFallbackDemo = () => {
    setRegionsInput(ROUTING_PRESET);
    setMaxRetries((current) => Math.max(current, 3));
  };

  const handleClick = async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const tokenRefresher = async (context: TokenRecoveryContext) => {
        const res = await fetch('http://localhost:8000/refresh-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            previous_token: context.previousToken,
            failure_status: context.status,
            attempt: context.attempt,
          }),
        });
        if (!res.ok) {
          throw new Error('Failed to refresh or rotate token');
        }
        const data = (await res.json()) as { token: string };
        return data.token;
      };

      const response = await smartFetch(
        '/external-api',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        },
        {
          regions: regionList,
          maxRetries,
          logger: console.log,
          tokenRefresher,
          jitterRatio: 0.35,
          retryBudget: {
            key: `${sessionKey}-${activeToken}`,
            limit: retryBudgetLimit,
            windowMs: retryBudgetWindowSeconds * 1_000,
          },
        },
      );
      setResult(response);
    } catch (error) {
      setResult({
        data: null,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        meta: {
          attempts: [],
          retries: 0,
          region: 'default',
          regionsTried: [],
          fixActions: [],
        },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetSession = () => {
    setSessionKey(makeSessionKey());
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Self-Healing API Playground</h1>
      <p>
        Configure a scenario and run <code>smartFetch</code> to visualize how retries,
        token rotation, budgets, and region fallback behave against the FastAPI mock
        server.
      </p>

      <section
        style={{
          border: '1px solid #ccc',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2>Request Settings</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <label style={{ flex: '1 1 220px' }}>
            Token scenario
            <select
              value={tokenScenario}
              onChange={(event) =>
                setTokenScenario(event.target.value as typeof tokenScenario)
              }
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            >
              {TOKEN_SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ flex: '1 1 220px' }}>
            Override token
            <input
              type="text"
              placeholder="Optional custom token"
              value={customToken}
              onChange={(event) => setCustomToken(event.target.value)}
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            />
          </label>

          <label style={{ flex: '1 1 120px' }}>
            Max retries
            <input
              type="number"
              min={0}
              max={10}
              value={maxRetries}
              onChange={(event) => setMaxRetries(Number(event.target.value))}
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            />
          </label>

          <label style={{ flex: '1 1 200px' }}>
            Regions (comma separated)
            <input
              type="text"
              value={regionsInput}
              onChange={(event) => setRegionsInput(event.target.value)}
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            />
            <small style={{ display: 'block', marginTop: 4 }}>
              Tip: preload a multi-region fallback demo (first region deprecated)
              <button
                type="button"
                onClick={handleLoadFallbackDemo}
                style={{ marginLeft: 8 }}
              >
                preload fallback
              </button>
            </small>
          </label>
        </div>
      </section>

      <section
        style={{
          border: '1px solid #ccc',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2>Retry Budget</h2>
        <p style={{ marginTop: 0 }}>
          Budget key: <code>{sessionKey}-{activeToken}</code>
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <label style={{ flex: '1 1 160px' }}>
            Retry limit per window
            <input
              type="number"
              min={1}
              max={20}
              value={retryBudgetLimit}
              onChange={(event) =>
                setRetryBudgetLimit(Number(event.target.value))
              }
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            />
          </label>

          <label style={{ flex: '1 1 180px' }}>
            Window (seconds)
            <input
              type="number"
              min={5}
              max={3600}
              value={retryBudgetWindowSeconds}
              onChange={(event) =>
                setRetryBudgetWindowSeconds(Number(event.target.value))
              }
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            />
          </label>

          <div style={{ alignSelf: 'flex-end' }}>
            <button type="button" onClick={handleResetSession}>
              Reset session/budget key
            </button>
          </div>
        </div>
      </section>
      <section
        style={{
          border: '1px solid #ccc',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
          background: '#f9fafb',
        }}
      >
        <h2>Run Scenario</h2>
        <button onClick={handleClick} disabled={isLoading}>
          {isLoading ? 'Testing…' : 'Test smartFetch'}
        </button>
        <span style={{ marginLeft: '1rem' }}>
          Active token:&nbsp;
          <code>{activeToken}</code>
        </span>
      </section>

      <section>
        <h2>Result</h2>
        {!result && (
          <p style={{ fontStyle: 'italic' }}>No request yet.</p>
        )}
        {result && (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1rem',
              }}
            >
              <StatCard
                label="Final status"
                value={result.error?.status?.toString() ?? '200'}
              />
              <StatCard
                label="Retries used"
                value={String(result.meta.retries)}
              />
              <StatCard
                label="Regions tried"
                value={result.meta.regionsTried.join(', ') || 'default'}
              />
              <StatCard
                label="Fix actions"
                value={
                  result.meta.fixActions.length
                    ? result.meta.fixActions.join(', ')
                    : 'None'
                }
              />
            </div>

            <AttemptsTable result={result} />

            <details style={{ marginTop: '1.5rem' }}>
              <summary>Raw response payload</summary>
              <pre
                style={{
                  marginTop: '1rem',
                  minHeight: '200px',
                  background: '#f4f4f4',
                  padding: '1rem',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: '1 1 180px',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '0.75rem',
        background: '#fff',
      }}
    >
      <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#555' }}>
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 20 }}>{value}</div>
    </div>
  );
}

function AttemptsTable({ result }: { result: ApiResult }) {
  if (!result.meta.attempts.length) {
    return (
      <p style={{ fontStyle: 'italic' }}>
        No attempts recorded. Check the console for potential errors running
        smartFetch.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: 400,
        }}
      >
        <thead>
          <tr>
            <Th>Attempt</Th>
            <Th>Region</Th>
            <Th>Status</Th>
            <Th>Error</Th>
            <Th>Fix actions</Th>
          </tr>
        </thead>
        <tbody>
          {result.meta.attempts.map((attempt) => (
            <tr key={`${attempt.attempt}-${attempt.region}`}>
              <Td>{attempt.attempt}</Td>
              <Td>{attempt.region}</Td>
              <Td>{attempt.status ?? '—'}</Td>
              <Td style={{ maxWidth: 260 }}>
                {attempt.error ?? 'None'}
              </Td>
              <Td>
                {attempt.fixActions.length
                  ? attempt.fixActions.join(', ')
                  : '—'}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Th = ({ children }: { children: ReactNode }) => (
  <th
    style={{
      textAlign: 'left',
      borderBottom: '1px solid #ddd',
      padding: '0.5rem',
      background: '#f0f2f5',
      fontWeight: 600,
    }}
  >
    {children}
  </th>
);

const Td = ({ children }: { children: ReactNode }) => (
  <td
    style={{
      borderBottom: '1px solid #eee',
      padding: '0.5rem',
      verticalAlign: 'top',
    }}
  >
    {children}
  </td>
);
