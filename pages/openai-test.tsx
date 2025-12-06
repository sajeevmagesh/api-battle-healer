import { FormEvent, useState } from 'react';
import { smartFetch, SmartFetchResult } from '../src/smartFetch';

type CompletionResult = SmartFetchResult<unknown>;

export default function OpenAITestPage() {
  const [prompt, setPrompt] = useState('Give me a one sentence pep talk.');
  const [result, setResult] = useState<CompletionResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const response = await smartFetch<unknown>(
        '/api/openai-proxy',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: prompt }),
        },
        {
          maxRetries: 2,
          logger: console.log,
          retryStatusCodes: [429],
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
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>smartFetch × OpenAI</h1>
      <p>
        This page proxies OpenAI traffic through Next.js and still funnels every
        request via <code>smartFetch</code>.
      </p>
      <form onSubmit={handleSubmit} style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: '.5rem' }}>
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          style={{ width: '100%', maxWidth: 600 }}
        />
        <div style={{ marginTop: '1rem' }}>
          <button type="submit" disabled={loading}>
            {loading ? 'Calling OpenAI…' : 'Send to OpenAI'}
          </button>
        </div>
      </form>

      <pre
        style={{
          marginTop: '1rem',
          minHeight: '250px',
          background: '#f4f4f4',
          padding: '1rem',
          overflowX: 'auto',
        }}
      >
        {result ? JSON.stringify(result, null, 2) : 'No request yet'}
      </pre>
    </main>
  );
}
