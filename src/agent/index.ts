import { smartFetch } from '../smartFetch';
import { ROUTING_TREE, findRegionByEndpoint } from '../config/routing';
import { resolveNextRegion } from './routing';
import { getHealingDecision } from './geminiPlanner';
import { executeAction } from './toolkit';
import {
  HealingAgentParams,
  HealingAgentResult,
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

  const requestId =
    providedRequestId || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const correlationId = params.correlationId || requestId;
  const initialToken = await tokenProvider();

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
  };

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
    });

    if (!result.error) {
      state = {
        ...state,
        cachedResponse: result.data,
        regionHealth: {
          ...state.regionHealth,
          [currentRegionId]: 'healthy',
        },
      };
      return {
        success: true,
        data: result.data,
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
    const { updatedState, intervention } = await executeAction(
      decision.action,
      state,
      { backendBaseUrl, requestId: state.requestId, correlationId: state.correlationId },
      decision.params,
    );
    updatedState.interventions = [...updatedState.interventions, intervention];
    state = updatedState;

    if (decision.action === 'use_mock') {
      return {
        success: true,
        data: state.cachedResponse as T,
        state,
      };
    }

    if (decision.action === 'queue_recovery' || decision.action === 'abort') {
      break;
    }
  }

  return {
    success: false,
    data: null,
    finalError: state.attempts.at(-1)?.error ?? { message: 'Agent exhausted' },
    state,
  };
}
