import { describe, expect, it } from 'vitest';
import { applyDegradationPipeline, rememberSuccessfulResponse } from './degradation';
import type { ToolkitContext, HealingState } from './types';
import { createDegradedResponse } from '../healing/degradedResponse';

const context: ToolkitContext = {
  backendBaseUrl: 'http://localhost:8000',
  requestId: 'req-test',
  correlationId: 'req-test',
};

function makeState(overrides: Partial<HealingState> = {}): HealingState {
  return {
    requestId: 'req-test',
    url: '/external-api',
    options: { method: 'GET', headers: {} },
    regions: ['http://localhost:8000'],
    regionIndex: 0,
    regionHistory: [],
    regionHealth: {},
    attempts: [],
    interventions: [],
    maxCycles: 3,
    cyclesUsed: 0,
    correlationId: 'req-test',
    repairAttempts: 0,
    ...overrides,
  };
}

describe('applyDegradationPipeline', () => {
  it('serves stale cache when available', async () => {
    rememberSuccessfulResponse('cache-key', { amount: 42 }, { enableStaleCache: true });
    const degraded = await applyDegradationPipeline(
      {
        config: { enableStaleCache: true, enableMock: false, staleTtlMs: 1000 },
        cacheKey: 'cache-key',
        lastError: { message: 'fail' },
        context,
        state: makeState(),
      },
      async () => {
        throw new Error('mock fetcher should not run');
      },
    );
    expect(degraded?.degradation).toBe('stale-cache');
    expect(degraded?.source).toBe('cache');
  });

  it('uses mock fallback when cache unavailable', async () => {
    const degraded = await applyDegradationPipeline(
      {
        config: { enableStaleCache: false, enableMock: true },
        cacheKey: 'missing',
        lastError: { message: 'fail' },
        context,
        state: makeState(),
      },
      async () => createDegradedResponse({ message: 'mock' }, 'mocked', { source: 'llm-mock' }),
    );
    expect(degraded?.degradation).toBe('mocked');
    expect(degraded?.data).toEqual({ message: 'mock' });
  });

  it('returns null when both cache and mock disabled', async () => {
    const degraded = await applyDegradationPipeline(
      {
        config: { enableStaleCache: false, enableMock: false },
        cacheKey: 'missing',
        lastError: { message: 'fail' },
        context,
        state: makeState(),
      },
    );
    expect(degraded).toBeNull();
  });
});

