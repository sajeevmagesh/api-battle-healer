import { fetchTestApiKey } from '../apiKeys';
import {
  HealingActionType,
  HealingIntervention,
  HealingState,
  ToolkitContext,
} from './types';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

export async function executeAction(
  action: HealingActionType,
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown> = {},
): Promise<{ updatedState: HealingState; intervention: HealingIntervention }> {
  switch (action) {
    case 'refresh_token':
      return refreshCredentials(state, context);
    case 'switch_region':
      return switchRegion(state, context);
    case 'use_mock':
      return fetchMock(state, context, params);
    case 'repair_payload':
      return repairPayload(state, context);
    case 'queue_recovery':
      return queueForRecovery(state, context, params);
    case 'adapt_schema':
      return adaptSchema(state, context, params);
    case 'retry':
      return {
        updatedState: state,
        intervention: createIntervention(state, action, params.reason || 'Retrying request'),
      };
    case 'abort':
    default:
      return {
        updatedState: { ...state, cyclesUsed: state.maxCycles },
        intervention: createIntervention(state, 'abort', params.reason || 'Abort requested'),
      };
  }
}

async function refreshCredentials(
  state: HealingState,
): Promise<{ updatedState: HealingState; intervention: HealingIntervention }> {
  const token = await fetchTestApiKey(`agent-${state.requestId}`);
  const updated = { ...state, token };
  return {
    updatedState: updated,
    intervention: createIntervention(state, 'refresh_token', 'Issued new API token'),
  };
}

async function switchRegion(
  state: HealingState,
): Promise<{ updatedState: HealingState; intervention: HealingIntervention }> {
  const nextIndex = (state.regionIndex + 1) % state.regions.length;
  const updated = { ...state, regionIndex: nextIndex };
  return {
    updatedState: updated,
    intervention: createIntervention(state, 'switch_region', 'Switching to alternate region', {
      region: state.regions[nextIndex],
    }),
  };
}

async function fetchMock(
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown>,
) {
  const response = await fetch(`${context.backendBaseUrl}/mock-response`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      reason: params.reason || 'agent-degraded',
      payload: state.cachedResponse,
    }),
  });
  const data = await response.json();
  const updated = { ...state, cachedResponse: data };
  return {
    updatedState: updated,
    intervention: createIntervention(state, 'use_mock', 'Returning degraded response'),
  };
}

async function repairPayload(
  state: HealingState,
) {
  const cloned = { ...state };
  const body = state.options.body;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsed && typeof parsed === 'object') {
      if (!parsed.transactionId) {
        parsed.transactionId = `auto-${Date.now()}`;
      }
      if (parsed.amount == null) {
        parsed.amount = 0;
      }
      cloned.options = {
        ...state.options,
        body: JSON.stringify(parsed),
      };
    }
  } catch {
    cloned.options = {
      ...state.options,
      body: JSON.stringify({
        transactionId: `fallback-${Date.now()}`,
        amount: 0,
      }),
    };
  }

  return {
    updatedState: cloned,
    intervention: createIntervention(state, 'repair_payload', 'Auto-repaired payload schema'),
  };
}

async function adaptSchema(
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown>,
) {
  const hints = {
    ...(state.schemaHints ?? {}),
    ...(params || {}),
  };
  const updated = { ...state, schemaHints: hints };
  return {
    updatedState: updated,
    intervention: createIntervention(state, 'adapt_schema', 'Adjusting schema expectations', hints),
  };
}

async function queueForRecovery(
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown>,
) {
  await fetch(`${context.backendBaseUrl}/queue-failed`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      operation: 'external-api',
      payload: {
        requestId: state.requestId,
        params,
      },
    }),
  });
  const updated = { ...state, queued: true };
  return {
    updatedState: updated,
    intervention: createIntervention(
      state,
      'queue_recovery',
      'Queued request for async recovery',
      params,
    ),
  };
}

function createIntervention(
  state: HealingState,
  action: HealingActionType,
  reason: string,
  details?: Record<string, unknown>,
): HealingIntervention {
  return {
    cycle: state.cyclesUsed,
    action,
    reason,
    details,
  };
}
