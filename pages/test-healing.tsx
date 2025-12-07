import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type SmartFetchResult } from '../src/smartFetch';
import { runHealingAgent } from '../src/agent';
import type { HealingState } from '../src/agent/types';
import type { DegradedResponse } from '../src/healing/degradedResponse';
import { ROUTING_TREE, flattenRoutingTree } from '../src/config/routing';
import { fetchTestApiKey } from '../src/apiKeys';

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
const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
const IS_LOCAL_BACKEND = /localhost|127\.0\.0\.1/.test(BACKEND_BASE_URL);

async function resetCredentialPool(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/admin/reset-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch (error) {
    console.warn('Failed to reset credential pool', error);
    return false;
  }
}

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
  const [agentState, setAgentState] = useState<HealingState | null>(null);
  const [degradedInfo, setDegradedInfo] = useState<DegradedResponse<Record<string, unknown>> | null>(null);
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const [autoIssuedToken, setAutoIssuedToken] = useState<string | null>(null);

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
    setAgentState(null);
    setDegradedInfo(null);
    setKeyNotice(null);
    try {
      const issueSandboxToken = async (): Promise<string | null> => {
        if (autoIssuedToken) {
          setKeyNotice('Rate limit detected. Reusing previously issued sandbox API key.');
          if (!customToken.trim()) {
            setCustomToken(autoIssuedToken);
          }
          return autoIssuedToken;
        }
        try {
          const freshToken = await fetchTestApiKey('rate-limit-recovery');
          setKeyNotice('Rate limit detected. Issued a fresh sandbox API key for continued retries.');
          setAutoIssuedToken(freshToken);
          if (!customToken.trim()) {
            setCustomToken(freshToken);
          }
          return freshToken;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          const exhausted = /No credentials available/i.test(message);
          if (IS_LOCAL_BACKEND && exhausted) {
            setKeyNotice('Credential pool exhausted. Resetting sandbox credentials…');
            const resetOk = await resetCredentialPool(BACKEND_BASE_URL);
            if (resetOk) {
              try {
                const retried = await fetchTestApiKey('rate-limit-recovery');
                setKeyNotice('Sandbox credentials reset. Issued a fresh API key.');
                setAutoIssuedToken(retried);
                if (!customToken.trim()) {
                  setCustomToken(retried);
                }
                return retried;
              } catch (retryError) {
                const retryMessage = retryError instanceof Error ? retryError.message : 'unknown error';
                setKeyNotice(
                  `Credential pool reset but issuing a key still failed: ${retryMessage}`,
                );
                return null;
              }
            }
            setKeyNotice(
              'Credential pool exhausted and automatic reset failed. Restart the backend or provide a custom token.',
            );
            return null;
          }
          setKeyNotice(
            `Rate limit detected but automatic token issuance failed: ${message}`,
          );
          return null;
        }
      };

      const baseRequestInit: RequestInit = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionId: 'heal-test',
          amount: 1337,
        }),
      };
      const targetPath = '/external-api?simulate=region_down,retryable_500,schema_drift,repair';
      const agentResult = await runHealingAgent<Record<string, unknown>>({
        url: targetPath,
        options: baseRequestInit,
        regions: regionList,
        requestId: sessionKey,
        correlationId: sessionKey,
        maxCycles: maxRetries + 1,
        tokenProvider: async () => activeToken,
        backendBaseUrl: BACKEND_BASE_URL,
        degradation: {
          enableStaleCache: true,
          enableMock: true,
          cacheKey: `${targetPath}-${activeToken}`,
        },
        tokenRecoveryHandler: async (context) => {
          if (context.status !== 429) {
            return null;
          }
          if (!IS_LOCAL_BACKEND) {
            setKeyNotice(
              'Rate limit (429) detected against a remote backend. Please rotate your production credential manually.',
            );
            return null;
          }
          return issueSandboxToken();
        },
      });
      setAgentState(agentResult.state);
      setDegradedInfo(agentResult.degraded as DegradedResponse<Record<string, unknown>>);
      const aggregatedAttempts = agentResult.state.attempts.flatMap(
        (observation) => observation.meta.attempts,
      );
      const aggregatedFixes = Array.from(
        new Set(
          agentResult.state.attempts.flatMap(
            (observation) => observation.meta.fixActions,
          ),
        ),
      );
      const meta = agentResult.state.attempts.at(-1)?.meta ?? {
        attempts: aggregatedAttempts,
        retries: agentResult.state.attempts.length,
        region: agentResult.state.regionHistory.at(-1) ?? 'default',
        regionsTried: agentResult.state.regionHistory,
        fixActions: aggregatedFixes,
        correlationId: agentResult.state.correlationId,
      };
      setResult({
        data: agentResult.data,
        meta,
        error: agentResult.success
          ? null
          : agentResult.finalError ?? { message: 'Agent exhausted' },
      });
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
          correlationId: sessionKey,
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
        Configure a scenario and let the Gemini-powered healing agent drive <code>smartFetch</code>
        through retries, token rotation, budgets, and region fallback against the FastAPI mock server.
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
              onChange={(event) => {
                setCustomToken(event.target.value);
                setAutoIssuedToken(null);
              }}
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
          {isLoading ? 'Testing…' : 'Run healing agent'}
        </button>
        <span style={{ marginLeft: '1rem' }}>
          Active token:&nbsp;
          <code>{activeToken}</code>
        </span>
        {keyNotice && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              borderRadius: 6,
              background: '#ecfdf5',
              border: '1px solid #34d399',
            }}
          >
            <strong>API key notice:</strong> {keyNotice}
          </div>
        )}
      </section>

      <section>
                <button type="button" onClick={() => window.open('/api/heal-runner', '_blank')} style={{ marginLeft: '1rem' }}>
          View raw agent output
        </button>
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
              {degradedInfo && (
                <StatCard
                  label="Degradation"
                  value={
                    degradedInfo.degradation === 'none'
                      ? 'none'
                      : `${degradedInfo.degradation}${
                          degradedInfo.source ? ` (${degradedInfo.source})` : ''
                        }`
                  }
                />
              )}
            </div>

            <AttemptsTable result={result} />

            {degradedInfo && degradedInfo.degradation !== 'none' && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  borderRadius: 6,
                  background: '#fff6e6',
                  border: '1px solid #f3c98b',
                }}
              >
                <strong>Degraded response:</strong>{' '}
                {degradedInfo.reason || 'Fallback engaged due to upstream failure.'}
              </div>
            )}

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

      {agentState && (
        <section
          style={{
            marginTop: '2rem',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: '1rem',
          }}
        >
          <h2>Healing Agent Interventions</h2>
          <p>
            Correlation ID: <code>{agentState.correlationId}</code>
          </p>
          <p>
            Region history: {agentState.regionHistory.join(' → ') || 'default'}
          </p>
          <p>
            Schema hints:{' '}
            {agentState.schemaHints
              ? JSON.stringify(agentState.schemaHints)
              : 'None'}
          </p>
          {agentState.degraded && (
            <p>
              Degradation level: <strong>{agentState.degraded.degradation}</strong>
              {agentState.degraded.reason ? ` — ${agentState.degraded.reason}` : ''}
            </p>
          )}
          {agentState.interventions.length ? (
            <ul>
              {agentState.interventions.map((intervention) => (
                <li key={`${intervention.cycle}-${intervention.action}`}>
                  <strong>{intervention.action}</strong> — {intervention.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontStyle: 'italic' }}>No interventions recorded.</p>
          )}
        </section>
      )}

      {agentState?.decisionLog?.length ? (
        <DecisionLog entries={agentState.decisionLog} />
      ) : null}
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
            No attempts recorded. Check the console for potential errors running the healing agent.
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

function DecisionLog({ entries }: { entries: HealingState['decisionLog'] }) {
  return (
    <section
      style={{
        marginTop: '2rem',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '1rem',
        background: '#fdfdfd',
      }}
    >
      <h2>Decision Log</h2>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
          }}
        >
          <thead>
            <tr>
              <Th>Cycle</Th>
              <Th>Action</Th>
              <Th>Reason</Th>
              <Th>Params</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.cycle}-${entry.action}-${entry.reason}`}>
                <Td>{entry.cycle + 1}</Td>
                <Td>{entry.action}</Td>
                <Td style={{ maxWidth: 320 }}>{entry.reason}</Td>
                <Td style={{ maxWidth: 320 }}>
                  {entry.params
                    ? JSON.stringify(entry.params, null, 2)
                    : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
