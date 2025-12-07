import { fetchTestApiKey } from '../apiKeys';
import { findRegionByEndpoint } from '../config/routing';
import {
  HealingActionType,
  HealingIntervention,
  HealingState,
  SchemaHints,
  ToolkitContext,
} from './types';
import { resolveNextRegion } from './routing';
import { requestMockResponse } from './mockClient';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

const MAX_REPAIR_ATTEMPTS = 2;
const REPAIR_WINDOW_MS = 60_000;
const REPAIR_WINDOW_LIMIT = 4;
const endpointRepairWindow = new Map<string, { count: number; windowStart: number }>();
const REPAIR_HEADER = 'X-Healer-Repair-Attempt';

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
      return repairPayload(state);
    case 'rewrite_request':
      return rewriteRequest(state, params);
    case 'queue_recovery':
      return queueForRecovery(state, context, params);
    case 'adapt_schema':
    case 'infer_schema':
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
  const currentRegionEndpoint = state.regions[state.regionIndex] || '';
  const currentRegionNode = findRegionByEndpoint(currentRegionEndpoint);
  const nextNode = resolveNextRegion(currentRegionNode?.id, state.regionHealth);
  if (!nextNode) {
    return {
      updatedState: state,
      intervention: createIntervention(state, 'switch_region', 'No alternate region available'),
    };
  }
  let nextIndex = state.regions.findIndex((item) => item === nextNode.endpoint);
  if (nextIndex === -1) {
    nextIndex = state.regions.length;
  }
  const updatedRegions =
    nextIndex < state.regions.length
      ? state.regions
      : [...state.regions, nextNode.endpoint];
  const updated = {
    ...state,
    regions: updatedRegions,
    regionIndex: nextIndex,
  };
  return {
    updatedState: updated,
    intervention: createIntervention(state, 'switch_region', 'Switching to alternate region', {
      region: nextNode.id,
    }),
  };
}

async function fetchMock(
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown>,
) {
  const degraded = await requestMockResponse(context, {
    schema: state.schemaHints,
    cachedPayload: state.cachedResponse,
    provider: (params.provider as string) || 'battle-healer',
    endpoint: (params.endpoint as string) || state.url,
    reason: params.reason as string | undefined,
    error: state.attempts.at(-1)?.error?.message,
  });
  const updated = { ...state, cachedResponse: degraded.data, degraded };
  return {
    updatedState: updated,
    intervention: createIntervention(
      state,
      'use_mock',
      degraded.reason || 'Returning degraded response',
      { degradation: degraded.degradation },
    ),
  };
}

async function repairPayload(state: HealingState) {
  const guard = ensureRepairAllowance(state);
  if (!guard.allowed) {
    return guard.interventionPayload!;
  }

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
        headers: withRepairHeaders(state.options.headers, state.repairAttempts + 1),
        body: JSON.stringify(parsed),
      };
      cloned.repairAttempts = state.repairAttempts + 1;
    }
  } catch {
    cloned.options = {
      ...state.options,
      headers: withRepairHeaders(state.options.headers, state.repairAttempts + 1),
      body: JSON.stringify({
        transactionId: `fallback-${Date.now()}`,
        amount: 0,
      }),
    };
    cloned.repairAttempts = state.repairAttempts + 1;
  }

  return {
    updatedState: cloned,
    intervention: createIntervention(state, 'repair_payload', 'Auto-repaired payload schema'),
  };
}

async function rewriteRequest(
  state: HealingState,
  params: Record<string, unknown>,
) {
  const guard = ensureRepairAllowance(state);
  if (!guard.allowed) {
    return guard.interventionPayload!;
  }

  const candidateBody =
    params.body ?? params.newBody ?? params.payload ?? params.rewrittenBody;
  if (candidateBody == null) {
    return {
      updatedState: state,
      intervention: createIntervention(
        state,
        'rewrite_request',
        'Planner requested rewrite but no payload provided',
      ),
    };
  }

  const serialized =
    typeof candidateBody === 'string'
      ? candidateBody
      : JSON.stringify(candidateBody);
  const headers = withRepairHeaders(state.options.headers, state.repairAttempts + 1);
  const extraHeaders = params.headers as Record<string, string> | undefined;
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => {
      headers.set(key, String(value));
    });
  }

  const updated: HealingState = {
    ...state,
    options: {
      ...state.options,
      body: serialized,
      headers,
    },
    repairAttempts: state.repairAttempts + 1,
  };

  return {
    updatedState: updated,
    intervention: createIntervention(
      state,
      'rewrite_request',
      params.notes ? String(params.notes) : 'Rewriting payload per Gemini plan',
      { notes: params.notes },
    ),
  };
}

async function adaptSchema(
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown>,
) {
  const nextHints = mergeSchemaHints(state.schemaHints, params);
  const updatedResponse = state.cachedResponse
    ? applySchemaAdaptation(nextHints, state.cachedResponse)
    : state.cachedResponse;
  const updated = {
    ...state,
    schemaHints: nextHints,
    cachedResponse: updatedResponse,
  };
  return {
    updatedState: updated,
    intervention: createIntervention(
      state,
      'adapt_schema',
      'Adjusting schema expectations',
      nextHints as Record<string, unknown>,
    ),
  };
}

async function queueForRecovery(
  state: HealingState,
  context: ToolkitContext,
  params: Record<string, unknown>,
) {
  const lastObservation = state.attempts.at(-1);
  const activeRegion = state.regions[state.regionIndex] || 'default';
  const method = (state.options.method || 'GET').toUpperCase();
  const sanitizedHeaders = sanitizeHeaders(headersToObject(state.options.headers));
  const body =
    typeof state.options.body === 'string'
      ? state.options.body
      : state.options.body
        ? JSON.stringify(state.options.body)
        : undefined;
  await fetch(`${context.backendBaseUrl}/queue-failed`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      request_id: state.requestId,
      correlation_id: context.correlationId,
      endpoint: (params.endpoint as string) || 'external-api',
      provider: (params.provider as string) || 'battle-healer',
      region: activeRegion,
      method,
      url: state.url,
      headers: sanitizedHeaders,
      body,
      error_type: lastObservation?.error?.message || undefined,
      error_message: lastObservation?.error?.message,
      error_status: lastObservation?.error?.status,
      timestamp: lastObservation?.timestamp ?? new Date().toISOString(),
      retry_count: (lastObservation?.meta.retries ?? 0) as number,
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

type RepairGuardResult = {
  allowed: boolean;
  interventionPayload?: { updatedState: HealingState; intervention: HealingIntervention };
};

function ensureRepairAllowance(state: HealingState): RepairGuardResult {
  if (state.repairAttempts >= MAX_REPAIR_ATTEMPTS) {
    const intervention = createIntervention(
      state,
      'abort',
      `Max repair attempts (${MAX_REPAIR_ATTEMPTS}) reached`,
      { repairAttempts: state.repairAttempts },
    );
    return {
      allowed: false,
      interventionPayload: { updatedState: { ...state, cyclesUsed: state.maxCycles }, intervention },
    };
  }
  const endpointKey = getEndpointKey(state.url);
  const now = Date.now();
  const existing = endpointRepairWindow.get(endpointKey);
  if (!existing || now - existing.windowStart > REPAIR_WINDOW_MS) {
    endpointRepairWindow.set(endpointKey, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (existing.count >= REPAIR_WINDOW_LIMIT) {
    const intervention = createIntervention(
      state,
      'abort',
      'Endpoint repair throttle reached',
      { endpoint: endpointKey },
    );
    return {
      allowed: false,
      interventionPayload: { updatedState: { ...state, cyclesUsed: state.maxCycles }, intervention },
    };
  }
  existing.count += 1;
  return { allowed: true };
}

function withRepairHeaders(headersInit: HeadersInit | undefined, attempt: number): Headers {
  const headers = toHeaders(headersInit);
  headers.set(REPAIR_HEADER, String(attempt));
  return headers;
}

function toHeaders(init?: HeadersInit): Headers {
  if (init instanceof Headers) {
    return new Headers(init);
  }
  return new Headers(init ?? undefined);
}

function getEndpointKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function mergeSchemaHints(
  current: SchemaHints | undefined,
  params: Record<string, unknown>,
): SchemaHints {
  const paramFieldMap =
    (params.fieldMap as Record<string, string>) ||
    ((params.mapping as Record<string, string>) ?? {});
  const nestedMap =
    ((params.schema as { fieldMap?: Record<string, string> })?.fieldMap) || {};
  const fieldMap = {
    ...(current?.fieldMap ?? {}),
    ...paramFieldMap,
    ...nestedMap,
  };

  const paramDefaults =
    (params.defaults as Record<string, unknown>) ||
    ((params.schema as { defaults?: Record<string, unknown> })?.defaults) ||
    {};
  const defaults = {
    ...(current?.defaults ?? {}),
    ...paramDefaults,
  };

  return {
    fieldMap: Object.keys(fieldMap).length ? fieldMap : current?.fieldMap,
    defaults: Object.keys(defaults).length ? defaults : current?.defaults,
  };
}

export function applySchemaAdaptation(
  hints: SchemaHints | undefined,
  payload: unknown,
): unknown {
  if (!hints || payload == null) {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => applySchemaAdaptation(hints, item));
  }
  if (typeof payload !== 'object') {
    return payload;
  }

  const normalized: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
  };
  const fieldMap = hints.fieldMap ?? {};
  Object.entries(fieldMap).forEach(([expected, actual]) => {
    if (actual in normalized) {
      normalized[expected] = normalized[actual];
    }
  });
  const defaults = hints.defaults ?? {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (normalized[key] === undefined) {
      normalized[key] = value;
    }
  });
  return normalized;
}

function headersToObject(init?: HeadersInit): Record<string, string> {
  if (!init) {
    return {};
  }
  const headers = new Headers(init);
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const blocked = new Set(['authorization', 'proxy-authorization', 'cookie']);
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (blocked.has(key.toLowerCase())) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
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
