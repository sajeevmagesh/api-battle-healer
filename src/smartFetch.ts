type FixAction =
  | `retry_status_${number}`
  | `fallback_region_${string}`
  | 'network_error';

export interface SmartFetchConfig {
  maxRetries?: number;
  regions?: string[];
  retryStatusCodes?: number[];
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  logger?: (entry: SmartFetchLogEntry) => void;
}

export interface SmartFetchLogEntry {
  attempt: number;
  region: string;
  url: string;
  status?: number;
  error?: string;
  fixActions: FixAction[];
}

export interface SmartFetchMeta {
  attempts: SmartFetchLogEntry[];
  retries: number;
  region: string;
  regionsTried: string[];
  fixActions: FixAction[];
}

export interface SmartFetchResult<T = unknown> {
  data: T | null;
  meta: SmartFetchMeta;
  error: { status?: number; message: string; body?: unknown } | null;
}

const DEFAULT_RETRY_CODES: Set<number> = (() => {
  const set = new Set<number>([429]);
  for (let status = 500; status <= 599; status += 1) {
    set.add(status);
  }
  return set;
})();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildUrlForRegion = (target: string, region: string) => {
  if (!region) {
    return target;
  }

  if (/^https?:\/\//i.test(target)) {
    return target;
  }

  const trimmedRegion = region.endsWith('/')
    ? region.slice(0, -1)
    : region;
  const normalizedPath = target.startsWith('/')
    ? target
    : `/${target}`;
  return `${trimmedRegion}${normalizedPath}`;
};

const isRetryable = (
  status: number | undefined,
  retryCodes: Set<number>,
) => {
  if (!status) {
    return true;
  }

  if (retryCodes.has(status)) {
    return true;
  }

  if (status >= 500 && status <= 599) {
    return true;
  }

  return false;
};

const shouldFallbackRegion = (status?: number) => status === 503;

export async function smartFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
  config: SmartFetchConfig = {},
): Promise<SmartFetchResult<T>> {
  const {
    maxRetries = 2,
    regions = [''],
    retryStatusCodes,
    backoffBaseMs = 300,
    backoffMaxMs = 3_000,
    logger,
  } = config;

  const retryCodeSet = retryStatusCodes?.length
    ? new Set<number>(retryStatusCodes)
    : new Set<number>(DEFAULT_RETRY_CODES);

  const attempts: SmartFetchLogEntry[] = [];
  const fixActionSet = new Set<FixAction>();
  const regionsTried: string[] = [];
  const totalAttempts = maxRetries + 1;
  let lastError: SmartFetchResult['error'] = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const currentRegion = regions[attempt % regions.length] || '';
    const targetUrl = buildUrlForRegion(url, currentRegion);
    regionsTried.push(currentRegion || 'default');
    const fixActionsForAttempt: FixAction[] = [];

    try {
      const response = await fetch(targetUrl, options);
      const status = response.status;
      const shouldRetry = isRetryable(status, retryCodeSet);

      const logEntry: SmartFetchLogEntry = {
        attempt: attempt + 1,
        region: currentRegion || 'default',
        url: targetUrl,
        status,
        fixActions: [],
      };

      if (response.ok) {
        const data = await parseResponse<T>(response);
        logEntry.fixActions = [...fixActionsForAttempt];
        attempts.push(logEntry);
        logger?.(logEntry);

        return {
          data,
          meta: {
            attempts,
            retries: attempt,
            region: currentRegion || 'default',
            regionsTried,
            fixActions: Array.from(fixActionSet),
          },
          error: null,
        };
      }

      if (shouldRetry) {
        fixActionsForAttempt.push(`retry_status_${status}`);
        fixActionSet.add(`retry_status_${status}`);

        if (
          shouldFallbackRegion(status) &&
          regions.length > 1
        ) {
          const nextRegion = regions[(attempt + 1) % regions.length] || 'default';
          fixActionsForAttempt.push(`fallback_region_${nextRegion}`);
          fixActionSet.add(`fallback_region_${nextRegion}`);
        }

        logEntry.fixActions = fixActionsForAttempt;
        attempts.push(logEntry);
        logger?.(logEntry);

        if (attempt < totalAttempts - 1) {
          const delay = Math.min(
            backoffMaxMs,
            backoffBaseMs * 2 ** attempt,
          );
          const jitter = Math.random() * backoffBaseMs;
          await sleep(delay + jitter);
          continue;
        }
      }

      const body = await safeParseBody(response);
      lastError = {
        status,
        message: `Request failed with status ${status}`,
        body,
      };
      logEntry.fixActions = [...fixActionsForAttempt];
      logEntry.error = lastError.message;
      attempts.push(logEntry);
      logger?.(logEntry);
      break;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown network error';
      const logEntry: SmartFetchLogEntry = {
        attempt: attempt + 1,
        region: currentRegion || 'default',
        url: targetUrl,
        error: errorMessage,
        fixActions: [],
      };
      fixActionsForAttempt.push('network_error');
      fixActionSet.add('network_error');
      logEntry.fixActions = fixActionsForAttempt;
      attempts.push(logEntry);
      logger?.(logEntry);

      if (attempt < totalAttempts - 1) {
        const delay = Math.min(
          backoffMaxMs,
          backoffBaseMs * 2 ** attempt,
        );
        const jitter = Math.random() * backoffBaseMs;
        await sleep(delay + jitter);
        continue;
      }

      lastError = {
        message: errorMessage,
      };
      break;
    }
  }

  return {
    data: null,
    meta: {
      attempts,
      retries: Math.max(0, attempts.length - 1),
      region: attempts.at(-1)?.region || 'default',
      regionsTried,
      fixActions: Array.from(fixActionSet),
    },
    error: lastError ?? { message: 'Request failed' },
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  return text as unknown as T;
}

async function safeParseBody(response: Response) {
  try {
    return await parseResponse(response);
  } catch {
    return null;
  }
}
