import { SmartFetchMeta, SmartFetchResult } from '../smartFetch';

export type HealingActionType =
  | 'retry'
  | 'refresh_token'
  | 'switch_region'
  | 'repair_payload'
  | 'adapt_schema'
  | 'use_mock'
  | 'queue_recovery'
  | 'abort';

export interface HealingDecision {
  action: HealingActionType;
  reason: string;
  params?: Record<string, unknown>;
}

export interface HealingObservation {
  cycle: number;
  meta: SmartFetchMeta;
  error: SmartFetchResult['error'];
  timestamp: string;
  triggerHints?: Record<string, unknown>;
}

export interface ToolkitContext {
  backendBaseUrl: string;
  requestId: string;
  correlationId: string;
}

export interface HealingState {
  requestId: string;
  url: string;
  options: RequestInit;
  regions: string[];
  regionIndex: number;
  regionHistory: string[];
  regionHealth: Record<string, 'healthy' | 'unhealthy' | 'deprecated'>;
  token?: string;
  cachedResponse?: unknown;
  schemaHints?: Record<string, unknown>;
  attempts: HealingObservation[];
  interventions: HealingIntervention[];
  maxCycles: number;
  cyclesUsed: number;
  queued?: boolean;
  correlationId: string;
}

export interface HealingIntervention {
  cycle: number;
  action: HealingActionType;
  reason: string;
  details?: Record<string, unknown>;
}

export interface HealingAgentParams {
  url: string;
  options: RequestInit;
  regions?: string[];
  requestId?: string;
  correlationId?: string;
  maxCycles?: number;
  tokenProvider: () => Promise<string>;
  backendBaseUrl: string;
}

export interface HealingAgentResult<T = unknown> {
  success: boolean;
  data: T | null;
  finalError?: SmartFetchResult['error'];
  state: HealingState;
}
