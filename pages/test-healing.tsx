import { useState } from 'react';
import { smartFetch, SmartFetchResult } from '../src/smartFetch';

type ApiResult = SmartFetchResult<Record<string, unknown>>;

export default function TestHealingPage() {
  const [result, setResult] = useState<ApiResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const tokenRefresher = async () => {
        const res = await fetch('http://localhost:8000/refresh-token', {
          method: 'POST',
        });
        if (!res.ok) {
          throw new Error('Failed to refresh token');
        }
        const data = (await res.json()) as { token: string };
        return data.token;
      };

      const response = await smartFetch(
        'http://localhost:8000/external-api',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer invalid-token',
          },
        },
        {
          regions: ['http://localhost:8000'],
          maxRetries: 2,
          logger: console.log,
          tokenRefresher,
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

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Self-Healing API Test</h1>
      <p>
        Click the button to trigger the smartFetch agent against the FastAPI mock
        service.
      </p>
      <button onClick={handleClick} disabled={isLoading}>
        {isLoading ? 'Testing…' : 'Test smartFetch'}
      </button>
      <pre style={{ marginTop: '1.5rem', minHeight: '200px', background: '#f4f4f4', padding: '1rem' }}>
        {result ? JSON.stringify(result, null, 2) : 'No request yet'}
      </pre>
    </main>
  );
}
