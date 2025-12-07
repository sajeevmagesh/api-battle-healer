import { smartFetch, TokenRecoveryContext } from '../smartFetch';
import { ROUTING_TREE, findRegionByEndpoint } from '../config/routing';
import { resolveNextRegion } from './routing';
import { getHealingDecision } from './geminiPlanner';
import { applySchemaAdaptation, executeAction } from './toolkit';
import { createDegradedResponse } from '../healing/degradedResponse';
import type { DegradedResponse } from '../healing/degradedResponse';
import {
  DEFAULT_DEGRADATION,
  applyDegradationPipeline,
  rememberSuccessfulResponse,
} from './degradation';
import {
  HealingAgentParams,
  HealingAgentResult,
  HealingDecision,
  HealingObservation,
  HealingState,
} from './types';

export async function runHealingAgent<T = unknown>(
  params: HealingAgentParams,
): Promise<HealingAgentResult<T>> {
  const {
    url,
    options,
    regions = ROUTING_TREE.children?.map((node) => node.endpoint) ?? [
      'http://localhost:8000',
    ],
    requestId: providedRequestId,
    maxCycles = 6,
    tokenProvider,
    backendBaseUrl,
  } = params;
  const tokenRecoveryHandler = params.tokenRecoveryHandler;
  const onTokenRecovery = params.onTokenRecovery;

  const requestId =
    providedRequestId || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const correlationId = params.correlationId || requestId;
  const initialToken = await tokenProvider();
  const degradationConfig = params.degradation;

  const makeCacheKey = (regionHint?: string) =>
    degradationConfig?.cacheKey || `${url}::${regionHint || 'default'}`;

  let state: HealingState = {
    requestId,
    url,
    options,
    regions,
    regionIndex: 0,
    regionHistory: [],
    regionHealth: {},
    token: initialToken,
    attempts: [],
    interventions: [],
    maxCycles,
    cyclesUsed: 0,
    correlationId,
    repairAttempts: 0,
    degraded: createDegradedResponse<T | null>(null, 'none'),
    decisionLog: [],
  };

  const tokenRefresher =
    tokenRecoveryHandler
      ? async (context: TokenRecoveryContext) => {
          try {
            const nextToken = await tokenRecoveryHandler(context);
            if (nextToken) {
              state = { ...state, token: nextToken };
            }
            onTokenRecovery?.({
              ...context,
              newToken: nextToken ?? null,
            });
            return nextToken ?? null;
          } catch (error) {
            onTokenRecovery?.({
              ...context,
              error: error instanceof Error ? error.message : 'Token recovery failed',
            });
            throw error;
          }
        }
      : undefined;

  while (state.cyclesUsed < state.maxCycles) {
    const region = state.regions[state.regionIndex] || '';
    const currentRegionNode = findRegionByEndpoint(region);
    const currentRegionId = currentRegionNode?.id ?? region;
    const headerBag = new Headers(state.options.headers ?? undefined);
    if (state.token) {
      headerBag.set('Authorization', `Bearer ${state.token}`);
    }
    const requestInit: RequestInit = {
      ...state.options,
      headers: headerBag,
    };

    const result = await smartFetch<T>(state.url, requestInit, {
      regions: [region],
      maxRetries: 0,
      logger: console.log,
      correlationId,
      tokenRefresher,
    });

    if (!result.error) {
      const normalizedData = state.schemaHints
        ? (applySchemaAdaptation(state.schemaHints, result.data) as T)
        : result.data;
      rememberSuccessfulResponse(makeCacheKey(currentRegionId), normalizedData, degradationConfig);
      const degraded = createDegradedResponse(normalizedData, 'none');
      state = {
        ...state,
        cachedResponse: normalizedData,
        regionHealth: {
          ...state.regionHealth,
          [currentRegionId]: 'healthy',
        },
        degraded,
      };
      return {
        success: true,
        data: normalizedData,
        degraded,
        state,
      };
    }

    const observation: HealingObservation = {
      cycle: state.cyclesUsed,
      meta: result.meta,
      error: result.error,
      timestamp: new Date().toISOString(),
      triggerHints: result.error.body as Record<string, unknown>,
    };
    const unhealthyStatus =
      result.error?.status === 410
        ? 'deprecated'
        : result.error?.status === 503 || result.error?.status === 429
          ? 'unhealthy'
          : undefined;

    state = {
      ...state,
      attempts: [...state.attempts, observation],
      cyclesUsed: state.cyclesUsed + 1,
      regionHistory: [...state.regionHistory, currentRegionId],
      regionHealth: unhealthyStatus
        ? { ...state.regionHealth, [currentRegionId]: unhealthyStatus }
        : state.regionHealth,
    };

    const decision = await getHealingDecision(state, observation);
    await logGeminiDecision(decision, {
      backendBaseUrl,
      requestId: state.requestId,
      correlationId: state.correlationId,
      cycle: observation.cycle,
    });
    state = {
      ...state,
      decisionLog: [
        ...state.decisionLog,
        {
          cycle: observation.cycle,
          action: decision.action,
          reason: decision.reason,
          params: decision.params,
        },
      ],
    };
    const { updatedState, intervention } = await executeAction(
      decision.action,
      state,
      { backendBaseUrl, requestId: state.requestId, correlationId: state.correlationId },
      decision.params,
    );
    updatedState.interventions = [...updatedState.interventions, intervention];
    state = updatedState;

    if (decision.action === 'use_mock') {
      const degraded = state.degraded ?? createDegradedResponse(state.cachedResponse as T | null, 'mocked');
      return {
        success: true,
        data: degraded.data as T,
        degraded: degraded as DegradedResponse<T>,
        state,
      };
    }

    if (decision.action === 'queue_recovery' || decision.action === 'abort') {
      break;
    }
  }
  const lastError = state.attempts.at(-1)?.error;
  const fallback = await applyDegradationPipeline(
    {
      config: degradationConfig,
      cacheKey: makeCacheKey(state.regionHistory.at(-1)),
      lastError,
      context: { backendBaseUrl, requestId: state.requestId, correlationId: state.correlationId },
      state,
    },
  );
  if (fallback) {
    state = { ...state, cachedResponse: fallback.data, degraded: fallback };
    return {
      success: true,
      data: fallback.data as T,
      degraded: fallback as DegradedResponse<T>,
      state,
    };
  }
  const degraded = createDegradedResponse<T | null>(
    null,
    'none',
    { originalError: lastError?.message },
  );

  return {
    success: false,
    data: null,
    degraded,
    finalError: lastError ?? { message: 'Agent exhausted' },
    state,
  };
}

async function logGeminiDecision(
  decision: HealingDecision,
  context: { backendBaseUrl: string; requestId: string; correlationId: string; cycle: number },
) {
  try {
    await fetch(`${context.backendBaseUrl}/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "gemini_decision",
        metadata: {
          requestId: context.requestId,
          correlationId: context.correlationId,
          cycle: context.cycle,
          action: decision.action,
          reason: decision.reason,
          params: decision.params,
        },
      }),
    });
  } catch (error) {
    console.warn("Failed to log Gemini decision", error);
  }
}
