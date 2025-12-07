import type { HealingAgentResult } from '@/agent/types';
import type { SmartFetchResult } from '@/smartFetch';

export type SmartFetchWithTimestamp = SmartFetchResult<Record<string, unknown>> & {
  requestedAt?: string;
};

const DEFAULT_PROVIDER = 'openai';

const REGION_FALLBACKS = ['us-east-1', 'eu-west-1'];

const nowIso = () => new Date().toISOString();

const extractRegionLabel = (value: string) => {
  if (!value) return 'default';
  try {
    const url = new URL(value);
    const regionParam = url.searchParams.get('region');
    if (regionParam) {
      return regionParam;
    }
    if (url.hostname.includes('localhost')) {
      return 'us-east-1';
    }
    return url.hostname;
  } catch {
    const match = /region=([^&]+)/.exec(value);
    if (match) {
      return match[1];
    }
    if (value.includes('localhost')) {
      return 'us-east-1';
    }
    return value.replace(/^https?:\/\//, '');
  }
};

const statusFromCounts = (successes: number, failures: number) => {
  if (failures === 0) {
    return 'healthy';
  }
  if (successes >= failures) {
    return 'degraded';
  }
  return 'unhealthy';
};

export const deriveEndpointHealth = (
  agentResult: HealingAgentResult | null,
  backendBaseUrl: string,
) => {
  const regions = agentResult?.state?.regions?.length
    ? agentResult.state.regions
    : [backendBaseUrl, ...REGION_FALLBACKS.map((label) => `${backendBaseUrl}?region=${label}`)];

  const stats = new Map<string, { successes: number; failures: number }>();
  agentResult?.state?.attempts.forEach((attempt) => {
    const latest = attempt.meta.attempts.at(-1);
    if (!latest) {
      return;
    }
    const regionKey = latest.region || extractRegionLabel(latest.url);
    const bucket = stats.get(regionKey) || { successes: 0, failures: 0 };
    if (latest.status && latest.status >= 200 && latest.status < 300) {
      bucket.successes += 1;
    } else {
      bucket.failures += 1;
    }
    stats.set(regionKey, bucket);
  });

  return regions.map((regionUrl, index) => {
    const regionLabel = extractRegionLabel(regionUrl);
    const bucket = stats.get(regionLabel) ?? { successes: 0, failures: 0 };
    const total = bucket.successes + bucket.failures || 1;
    return {
      id: `${regionLabel}-${index}`,
      endpoint_id: regionLabel,
      provider: DEFAULT_PROVIDER,
      region: regionLabel,
      status: statusFromCounts(bucket.successes, bucket.failures),
      latency_avg_ms: 200 + bucket.failures * 150,
      success_rate: bucket.successes / total,
      priority: index + 1,
      is_primary: index === 0,
    };
  });
};

export const deriveHealingLogs = (agentResult: HealingAgentResult | null) => {
  if (!agentResult?.state?.interventions?.length) {
    return [];
  }

  return agentResult.state.interventions.map((intervention, index) => ({
    id: `${agentResult.state.requestId}-log-${index}`,
    healing_type: intervention.action === 'switch_region'
      ? 'failover'
      : intervention.action === 'refresh_token'
        ? 'credential_rotation'
        : intervention.action === 'use_mock'
          ? 'mock_response'
          : intervention.action,
    action_taken: intervention.reason,
    outcome: agentResult.success ? 'resolved' : 'pending',
    duration_ms: 120 + index * 30,
    root_cause: (intervention.details?.error as string) || intervention.reason,
    created_date: nowIso(),
  }));
};

export const deriveRecoveryQueue = (agentResult: HealingAgentResult | null) => {
  if (!agentResult?.state?.queued) {
    return [];
  }

  return [
    {
      id: `${agentResult.state.requestId}-queued`,
      queue_id: `${agentResult.state.requestId}-queued`,
      request_id: agentResult.state.requestId,
      endpoint: agentResult.state.url,
      provider: DEFAULT_PROVIDER,
      status: 'pending',
      retry_attempts: agentResult.state.attempts.length,
      max_retries: agentResult.state.maxCycles,
      priority: 'high',
      error_message: agentResult.finalError?.message,
      next_retry_at: new Date(Date.now() + 30_000).toISOString(),
    },
  ];
};

export const deriveLiveEvents = (
  requests: SmartFetchWithTimestamp[],
  agentResult: HealingAgentResult | null,
) => {
  const events: any[] = [];

  requests.forEach((req, reqIdx) => {
    const timestamp = req.requestedAt || nowIso();
    req.meta?.attempts?.forEach((attempt) => {
      events.push({
        id: `sf-${timestamp}-${attempt.attempt}-${reqIdx}`,
        endpoint: attempt.url?.split('?')[0] ?? '/external-api',
        provider: DEFAULT_PROVIDER,
        status_code: attempt.status ?? req.error?.status ?? 0,
        retry_count: attempt.attempt - 1,
        outcome:
          attempt.status && attempt.status >= 200 && attempt.status < 300
            ? 'success'
            : 'failed',
        region: attempt.region,
        latency_ms: 200 + attempt.attempt * 50,
        created_date: timestamp,
        healing_applied: attempt.fixActions ?? [],
      });
    });
  });

  if (agentResult?.state?.attempts?.length) {
    agentResult.state.attempts.forEach((observation, idx) => {
      const latest = observation.meta.attempts.at(-1);
      events.push({
        id: `${agentResult.state.requestId}-obs-${idx}`,
        endpoint: agentResult.state.url,
        provider: DEFAULT_PROVIDER,
        status_code: latest?.status ?? observation.error?.status ?? 0,
        retry_count: observation.meta.retries,
        outcome: 'failed',
        region: observation.meta.region,
        latency_ms: 220 + idx * 40,
        created_date: observation.timestamp,
        healing_applied: observation.meta.fixActions ?? [],
      });
    });
  }

  if (agentResult) {
    const finalTimestamp =
      agentResult.state.attempts.at(-1)?.timestamp ?? nowIso();
    events.push({
      id: `${agentResult.state.requestId}-final`,
      endpoint: agentResult.state.url,
      provider: DEFAULT_PROVIDER,
      status_code: agentResult.success ? 200 : agentResult.finalError?.status ?? 0,
      retry_count: agentResult.state.attempts.length,
      outcome: agentResult.success ? 'success' : 'failed',
      region: agentResult.state.regions[agentResult.state.regionIndex] ?? 'us-east-1',
      latency_ms: 180 + agentResult.state.attempts.length * 35,
      created_date: finalTimestamp,
      healing_applied: agentResult.state.interventions.map((intervention) => intervention.action),
    });
  }

  return events
    .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
    .slice(0, 12);
};

export const deriveQuotaUsage = (
  requests: SmartFetchWithTimestamp[],
  agentResult: HealingAgentResult | null,
) => {
  const healingSuccess = agentResult?.success ? 1 : 0;
  const healingCalls =
    (agentResult?.state?.attempts.length ?? 0) + healingSuccess;
  const totalCalls = requests.length + healingCalls || 1;
  const successes = requests.filter((req) => !req.error).length + healingSuccess;
  return [
    {
      id: 'quota-primary',
      provider: DEFAULT_PROVIDER,
      model: 'battle-healer',
      date: new Date().toISOString().split('T')[0],
      tokens_used: successes * 1000,
      tokens_limit: 10_000,
      calls_made: totalCalls,
      calls_limit: 50,
      cost_usd: successes * 0.1,
      budget_usd: 15,
      predicted_exhaustion: totalCalls > 40
        ? new Date(Date.now() + 3600_000).toISOString()
        : undefined,
    },
  ];
};

export const deriveCredentialPool = (
  apiKey: string | null,
  requests: SmartFetchWithTimestamp[],
  agentResult: HealingAgentResult | null,
) => {
  const healingCalls =
    (agentResult?.state?.attempts.length ?? 0) + (agentResult?.success ? 1 : 0);
  const totalCalls = requests.length + healingCalls;
  if (!apiKey) {
    return [
      {
        id: 'no-key',
        credential_id: 'none',
        provider: DEFAULT_PROVIDER,
        key_alias: 'Request a key',
        status: 'disabled',
        calls_today: totalCalls,
        daily_limit: 50,
        priority: 1,
      },
    ];
  }

  return [
    {
      id: 'primary-key',
      credential_id: 'primary',
      provider: DEFAULT_PROVIDER,
      key_alias: 'Demo key',
      status: 'active',
      calls_today: totalCalls,
      daily_limit: 50,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      priority: 1,
    },
  ];
};
