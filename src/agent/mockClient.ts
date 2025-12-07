import type { ToolkitContext } from './types';
import type { DegradedResponse } from '../healing/degradedResponse';
import { createDegradedResponse } from '../healing/degradedResponse';

interface MockRequestPayload {
  schema?: Record<string, unknown>;
  example?: unknown;
  cachedPayload?: unknown;
  provider?: string;
  endpoint?: string;
  reason?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export async function requestMockResponse(
  context: ToolkitContext,
  payload: MockRequestPayload,
): Promise<DegradedResponse<unknown>> {
  const response = await fetch(`${context.backendBaseUrl}/mock-response`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schema_hint: payload.schema,
      example_response: payload.example,
      cached_payload: payload.cachedPayload,
      provider: payload.provider ?? 'battle-healer',
      endpoint: payload.endpoint ?? 'external-api',
      reason: payload.reason ?? 'Provider outage; synthetic mock generated',
      error: payload.error,
      metadata: payload.metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate mock response (${response.status})`);
  }

  const body = await response.json();
  const mockPayload = body.mock ?? body.payload ?? null;
  return createDegradedResponse(mockPayload, (body.degradation ?? 'mocked') as 'mocked', {
    reason: body.reason,
    source: (body.source ?? 'llm-mock') as DegradedResponse<unknown>['source'],
    originalError: body.original_error ?? payload.error,
  });
}
