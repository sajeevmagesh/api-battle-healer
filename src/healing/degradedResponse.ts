export type DegradationLevel = 'none' | 'stale-cache' | 'mocked' | 'partial';

export interface DegradedResponse<T> {
  data: T | null;
  degradation: DegradationLevel;
  reason?: string;
  source?: 'cache' | 'llm-mock' | 'fallback-endpoint';
  originalError?: string;
}

export function createDegradedResponse<T>(
  data: T | null,
  degradation: DegradationLevel,
  extras: Omit<DegradedResponse<T>, 'data' | 'degradation'> = {},
): DegradedResponse<T> {
  return {
    data,
    degradation,
    ...extras,
  };
}

