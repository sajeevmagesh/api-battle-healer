import { HealingDecision, HealingObservation, HealingState } from './types';

interface PlannerPayload {
  state: Omit<HealingState, 'options' | 'token'> & { tokenKnown: boolean };
  recentObservations: HealingObservation[];
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
- adapt_schema: accept response schema drift and adjust client expectations
- use_mock: return cached/mocked response
- queue_recovery: queue request for background retry if budgets exhausted
- abort: stop and explain why

Respond with strict JSON: { "action": "<name>", "reason": "<why>", "params": { ... } }

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
      action: 'repair_payload',
      reason: 'Heuristic: schema validation failed',
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
