import { HealingDecision, HealingObservation, HealingState } from './types';

interface PlannerPayload {
  state: Omit<HealingState, 'options' | 'token'> & { tokenKnown: boolean };
  recentObservations: HealingObservation[];
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyPreview?: unknown;
  };
}

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

const FALLBACK_ORDER: HealingDecision[] = [
  { action: 'retry', reason: 'Fallback heuristic: default retry' },
];

function buildPrompt(payload: PlannerPayload) {
  return `
You are Gemini 3, a recovery planner for unstable APIs. You receive structured failure logs and must select one healing action from this toolkit:

- retry: try the request again without changing anything
- refresh_token: fetch new credentials before retrying
- switch_region: move to the next region endpoint in rotation
- repair_payload: fix malformed payloads or missing fields
- rewrite_request: return a new request body/headers to fix malformed or deprecated payloads (respond with params.body)
- adapt_schema / infer_schema: accept response schema drift and return field mappings/defaults via params.fieldMap + params.defaults
- use_mock: return cached/mocked response
- queue_recovery: queue request for background retry if budgets exhausted
- abort: stop and explain why

Respond with strict JSON: { "action": "<name>", "reason": "<why>", "params": { ... } }

Request Summary:
${JSON.stringify(payload.request, null, 2)}

Context:
${JSON.stringify(payload, null, 2)}
`;
}

export async function getHealingDecision(
  state: HealingState,
  recentObservation: HealingObservation,
): Promise<HealingDecision> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const plannerPayload: PlannerPayload = {
    state: {
      ...state,
      tokenKnown: Boolean(state.token),
      options: undefined as never,
    },
    recentObservations: [recentObservation],
    request: summarizeRequest(state),
  };

  if (!apiKey) {
    return heuristicDecision(recentObservation);
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(plannerPayload) }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini planner error ${response.status}`);
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.output ??
      '';
    const decision = JSON.parse(sanitizeJson(text)) as HealingDecision;
    return decision;
  } catch (error) {
    console.warn('Gemini planner fallback', error);
    return heuristicDecision(recentObservation);
  }
}

function heuristicDecision(observation: HealingObservation): HealingDecision {
  const schemaHints = detectSchemaHints(observation);
  if (schemaHints) {
    return {
      action: 'adapt_schema',
      reason: 'Heuristic: schema drift hints detected',
      params: schemaHints,
    };
  }

  const status = observation.error?.status;
  if (status === 401) {
    return {
      action: 'refresh_token',
      reason: 'Heuristic: unauthorized response requires new token',
    };
  }
  if (status === 503) {
    const retryRemaining = getRetryBudgetRemaining(observation);
    if (typeof retryRemaining === 'number' && retryRemaining <= 0) {
      return {
        action: 'queue_recovery',
        reason: 'Heuristic: retry budget exhausted after region outages',
        params: { delaySeconds: 30 },
      };
    }
    if (typeof retryRemaining === 'number' && retryRemaining <= 1) {
      return {
        action: 'use_mock',
        reason: 'Heuristic: final retry before degradation; serving cached response',
      };
    }
    return {
      action: 'switch_region',
      reason: 'Heuristic: region outage detected',
    };
  }
  if (status === 422) {
    return {
      action: 'rewrite_request',
      reason: 'Heuristic: schema validation failed',
      params: observation.triggerHints ?? {},
    };
  }
  if (status === 429) {
    if (isQuotaError(observation)) {
      return {
        action: 'use_mock',
        reason: 'Heuristic: quota exhausted; serve degraded response',
      };
    }
    return {
      action: 'queue_recovery',
      reason: 'Heuristic: rate limited; retry later',
      params: { delaySeconds: 15 },
    };
  }
  if (status === 402) {
    return {
      action: 'use_mock',
      reason: 'Heuristic: call budget exhausted; degrade gracefully',
    };
  }
  return FALLBACK_ORDER[0];
}

function sanitizeJson(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/```json/g, '').replace(/```/g, '').trim();
  }
  return trimmed;
}

function summarizeRequest(state: HealingState) {
  const headers: Record<string, string> = {};
  try {
    new Headers(state.options.headers ?? undefined).forEach((value, key) => {
      if (!['authorization', 'proxy-authorization'].includes(key.toLowerCase())) {
        headers[key] = value;
      }
    });
  } catch {
    // ignore serialization errors
  }
  const body = typeof state.options.body === 'string'
    ? state.options.body.slice(0, 400)
    : state.options.body;
  return {
    method: (state.options.method || 'GET').toUpperCase(),
    url: state.url,
    headers,
    bodyPreview: body,
  };
}

function detectSchemaHints(observation: HealingObservation): Record<string, unknown> | null {
  const detail = getObservationDetail(observation);
  const schemaHint = detail?.schema_hint || detail?.schema || observation.triggerHints?.schema_hint;
  if (!schemaHint) {
    return null;
  }
  const fieldMap =
    schemaHint.field_map ||
    schemaHint.fieldMap ||
    schemaHint.mapping ||
    schemaHint.fields;
  const defaults = schemaHint.defaults || schemaHint.fallbacks;
  if (!fieldMap && !defaults) {
    return null;
  }
  return {
    fieldMap,
    defaults,
  };
}

function getObservationDetail(observation: HealingObservation): Record<string, any> | undefined {
  const body = observation.error?.body;
  if (body && typeof body === 'object') {
    if ('detail' in body && typeof (body as any).detail === 'object') {
      return (body as any).detail as Record<string, any>;
    }
    return body as Record<string, any>;
  }
  return undefined;
}

function getRetryBudgetRemaining(observation: HealingObservation): number | undefined {
  const body = observation.error?.body;
  if (
    body &&
    typeof body === 'object' &&
    'detail' in body &&
    typeof (body as Record<string, unknown>).detail === 'object'
  ) {
    const detail = (body as { detail?: Record<string, unknown> }).detail;
    const value = detail?.retry_budget_remaining;
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

function isQuotaError(observation: HealingObservation): boolean {
  const detail = (observation.error?.body as { detail?: Record<string, unknown> })?.detail;
  if (!detail) {
    return false;
  }
  const message = String(detail.error || '').toLowerCase();
  return (
    message.includes('quota') ||
    message.includes('rate') ||
    message.includes('limit')
  );
}
