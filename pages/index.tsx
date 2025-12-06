import Link from 'next/link';
import { useState } from 'react';
import { fetchTestApiKey } from '../src/apiKeys';
import type { HealingAgentResult } from '../src/agent/types';

const backendEndpoints = [
  { path: '/generate-api-key', method: 'POST', description: 'Issue scoped API keys with TTL + budgets' },
  { path: '/refresh-token', method: 'POST', description: 'Rotate credentials immediately' },
  { path: '/simulate-budget', method: 'GET/POST', description: 'Inspect or mutate quota/call/retry budgets' },
  { path: '/external-api', method: 'GET/POST', description: 'Primary flaky API supporting simulate triggers' },
  { path: '/mock-response', method: 'POST', description: 'Graceful degradation / cached responses' },
  { path: '/queue-failed', method: 'GET/POST', description: 'Queue failed calls and test overflow' },
  { path: '/log', method: 'GET/POST', description: 'Structured healing logs intake' },
];

export default function Home() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healingResult, setHealingResult] = useState<HealingAgentResult | null>(null);
  const [healingLoading, setHealingLoading] = useState(false);
  const [healingError, setHealingError] = useState<string | null>(null);
  const [scenario, setScenario] = useState('preset');

  const handleGenerateKey = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await fetchTestApiKey('homepage-demo');
      setApiKey(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleRunAgent = async () => {
    setHealingLoading(true);
    setHealingError(null);
    setHealingResult(null);
    try {
      const response = await fetch('/api/heal-runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulate: scenario }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Agent run failed');
      }
      setHealingResult(data);
    } catch (err) {
      setHealingError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setHealingLoading(false);
    }
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>API Battle Healer</h1>
      <p>
        This sandbox issues API keys, simulates flaky regions, and routes everything through{' '}
        <code>smartFetch</code>.
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2>1. Generate a Test API Key</h2>
        <button onClick={handleGenerateKey} disabled={loading}>
          {loading ? 'Generating…' : 'Generate API Key'}
        </button>
        {apiKey && (
          <pre
            style={{
              background: '#f4f4f4',
              padding: '0.75rem',
              marginTop: '1rem',
              overflowX: 'auto',
            }}
          >
            {apiKey}
          </pre>
        )}
        {error && (
          <p style={{ color: 'crimson' }}>
            {error}
          </p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>2. Explore Backend Endpoints</h2>
        <ul>
          {backendEndpoints.map((endpoint) => (
            <li key={endpoint.path}>
              <code>{endpoint.method} {endpoint.path}</code> — {endpoint.description}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>2. Self-Healing Fetch</h2>
        <p>
          Trigger retries, token refresh, and region failover in the{' '}
          <Link href="/test-healing">/test-healing</Link> page.
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>3. OpenAI Proxy Demo</h2>
        <p>
          Send prompts through <code>smartFetch</code> + Next.js API proxy on{' '}
          <Link href="/openai-test">/openai-test</Link>.
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>4. Gemini Healing Run</h2>
        <p>
          Click below to force a multi-symptom failure (`region_down`, `retryable_500`, `schema_drift`, `repair`) and let the Gemini planning
          agent choose the healing sequence.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            Scenario:
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              style={{ marginLeft: '0.5rem' }}
            >
              <option value="preset">Preset (multi-symptom)</option>
              <option value="region_down,retryable_500">Region failover</option>
              <option value="schema_drift,repair">Schema drift + repair</option>
              <option value="quota,retryable_500">Quota exhaustion</option>
              <option value="mock">Graceful degradation</option>
              <option value="repair">Request repair only</option>
              <option value="random">Random mix</option>
            </select>
          </label>
          <button onClick={handleRunAgent} disabled={healingLoading}>
            {healingLoading ? 'Healing…' : 'Run scenario'}
          </button>
        </div>
        {healingError && (
          <p style={{ color: 'crimson' }}>{healingError}</p>
        )}
        <pre
          style={{
            marginTop: '1rem',
            minHeight: '220px',
            background: '#f4f4f4',
            padding: '1rem',
            overflowX: 'auto',
          }}
        >
          {healingResult
            ? JSON.stringify(healingResult, null, 2)
            : 'No agent run yet'}
        </pre>
      </section>
    </main>
  );
}
