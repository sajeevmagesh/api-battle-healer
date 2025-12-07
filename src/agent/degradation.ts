import type { SmartFetchResult } from '../smartFetch';
import type { ToolkitContext, HealingState } from './types';
import { createDegradedResponse, type DegradedResponse } from '../healing/degradedResponse';
import { recallResponse, rememberResponse } from '../healing/responseCache';
import { requestMockResponse } from './mockClient';

export interface DegradationConfig {
  cacheKey?: string;
  enableStaleCache?: boolean;
  staleTtlMs?: number;
  enableMock?: boolean;
  mockSchema?: Record<string, unknown>;
  mockExample?: unknown;
}

export const DEFAULT_DEGRADATION: Required<Omit<DegradationConfig, 'cacheKey' | 'mockSchema' | 'mockExample'>> = {
  enableStaleCache: true,
  staleTtlMs: 5 * 60 * 1_000,
  enableMock: true,
};

type MockFetcher = typeof requestMockResponse;

export function rememberSuccessfulResponse(
  key: string,
  data: unknown,
  config?: DegradationConfig,
): void {
  if (config?.enableStaleCache === false) {
    return;
  }
  rememberResponse(key, data);
}

export async function applyDegradationPipeline(
  args: {
    config?: DegradationConfig;
    cacheKey: string;
    lastError?: SmartFetchResult['error'];
    context: ToolkitContext;
    state: HealingState;
  },
  mockFetcher: MockFetcher = requestMockResponse,
): Promise<DegradedResponse<unknown> | null> {
  const effective = {
    ...DEFAULT_DEGRADATION,
    ...args.config,
  };
  const { cacheKey, lastError, context, state } = args;

  if (effective.enableStaleCache !== false) {
    const cached = recallResponse(cacheKey, effective.staleTtlMs);
    if (cached) {
      return createDegradedResponse(cached.data, 'stale-cache', {
        reason: 'Using last known good value while provider heals',
        source: 'cache',
        originalError: lastError?.message,
      });
    }
  }

  if (effective.enableMock) {
    try {
      const degraded = await mockFetcher(context, {
        schema: effective.mockSchema ?? state.schemaHints,
        example: effective.mockExample ?? state.cachedResponse,
        cachedPayload: state.cachedResponse,
        provider: 'battle-healer',
        endpoint: state.url,
        error: lastError?.message,
      });
      return degraded;
    } catch (error) {
      console.warn('mock fallback failed', error);
    }
  }

  return null;
}

