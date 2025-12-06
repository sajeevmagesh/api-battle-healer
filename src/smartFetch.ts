type FixAction =
  | `retry_status_${number}`
  | `fallback_region_${string}`
  | 'network_error'
  | 'refresh_token'
  | 'retry_budget_exhausted'
  | 'rotate_token';

export interface SmartFetchConfig {
  maxRetries?: number;
  regions?: string[];
  retryStatusCodes?: number[];
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  logger?: (entry: SmartFetchLogEntry) => void;
  tokenRefresher?: (context: TokenRecoveryContext) => Promise<string | null | undefined>;
  jitterRatio?: number;
  retryBudget?: RetryBudgetConfig;
  correlationId?: string;
}

export interface SmartFetchLogEntry {
  attempt: number;
  region: string;
  url: string;
  status?: number;
  error?: string;
  fixActions: FixAction[];
  correlationId?: string;
}

export interface SmartFetchMeta {
  attempts: SmartFetchLogEntry[];
  retries: number;
  region: string;
  regionsTried: string[];
  fixActions: FixAction[];
  correlationId: string;
}

export interface SmartFetchResult<T = unknown> {
  data: T | null;
  meta: SmartFetchMeta;
  error: { status?: number; message: string; body?: unknown } | null;
}

export interface TokenRecoveryContext {
  status: number;
  attempt: number;
  region: string;
  previousToken?: string | null;
  error?: string;
}

export interface RetryBudgetConfig {
  key: string;
  limit: number;
  windowMs?: number;
}

const DEFAULT_RETRY_CODES: Set<number> = (() => {
  const set = new Set<number>([410, 429]);
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

const shouldFallbackRegion = (status?: number) => status === 503 || status === 410;

const extractTokenFromHeader = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }

  return trimmed;
};

const RETRY_BUDGET_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1_000;

type RetryBudgetWindow = {
  count: number;
  windowStart: number;
  windowMs: number;
};

const retryBudgetStore = new Map<string, RetryBudgetWindow>();

const getRetryBudgetWindow = (config: RetryBudgetConfig) => {
  const windowMs = config.windowMs ?? RETRY_BUDGET_DEFAULT_WINDOW_MS;
  const now = Date.now();
  const existing = retryBudgetStore.get(config.key);

  if (!existing || now - existing.windowStart >= windowMs) {
    const fresh: RetryBudgetWindow = {
      count: 0,
      windowStart: now,
      windowMs,
    };
    retryBudgetStore.set(config.key, fresh);
    return fresh;
  }

  return existing;
};

const consumeRetryBudget = (config: RetryBudgetConfig) => {
  const bucket = getRetryBudgetWindow(config);
  if (bucket.count >= config.limit) {
    return false;
  }
  bucket.count += 1;
  return true;
};

const parseRetryAfterMs = (response: Response) => {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const timestamp = Date.parse(retryAfter);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
};

const calculateDelayMs = (
  attempt: number,
  baseMs: number,
  maxMs: number,
  jitterRatio: number,
  overrideDelay?: number | null,
) => {
  if (typeof overrideDelay === 'number') {
    return Math.min(maxMs, overrideDelay);
  }

  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitterWindow = Math.max(0, exponential * jitterRatio);
  const jitter = Math.random() * jitterWindow;
  return Math.min(maxMs, exponential + jitter);
};

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
    tokenRefresher,
    jitterRatio = 0.25,
    retryBudget,
    correlationId: providedCorrelationId,
  } = config;

  const retryCodeSet = retryStatusCodes?.length
    ? new Set<number>(retryStatusCodes)
    : new Set<number>(DEFAULT_RETRY_CODES);

  const attempts: SmartFetchLogEntry[] = [];
  const fixActionSet = new Set<FixAction>();
  const regionsTried: string[] = [];
  const totalAttempts = maxRetries + 1;
  let lastError: SmartFetchResult['error'] = null;

  const correlationId =
    providedCorrelationId ||
    `corr-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

  const dynamicHeaders = new Headers(options.headers ?? undefined);
  const formatToken = (token: string) => {
    const trimmed = token.trim();
    return trimmed.toLowerCase().startsWith('bearer ')
      ? trimmed
      : `Bearer ${trimmed}`;
  };
  dynamicHeaders.set('X-Correlation-Id', correlationId);
  let currentTokenValue = extractTokenFromHeader(dynamicHeaders.get('Authorization'));
  const updateAuthorizationHeader = (token: string) => {
    const extracted = extractTokenFromHeader(token);
    if (!extracted) {
      return;
    }
    currentTokenValue = extracted;
    dynamicHeaders.set('Authorization', formatToken(extracted));
  };

  let tokenRecoveryAttempted = false;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const currentRegion = regions[attempt % regions.length] || '';
    const targetUrl = buildUrlForRegion(url, currentRegion);
    regionsTried.push(currentRegion || 'default');
    const fixActionsForAttempt: FixAction[] = [];
    const requestInit: RequestInit = {
      ...options,
      headers: new Headers(dynamicHeaders),
    };
    requestInit.headers.set('X-BattleHealer-Region', currentRegion || 'default');

    try {
      const response = await fetch(targetUrl, requestInit);
      const status = response.status;
      const shouldRetry = isRetryable(status, retryCodeSet);

      const logEntry: SmartFetchLogEntry = {
        attempt: attempt + 1,
        region: currentRegion || 'default',
        url: targetUrl,
        status,
        fixActions: [],
        correlationId,
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
            correlationId,
          },
          error: null,
        };
      }

      const shouldAttemptTokenRecovery =
        tokenRefresher &&
        !tokenRecoveryAttempted &&
        (status === 401 || status === 403 || status === 429);

      if (shouldAttemptTokenRecovery && tokenRefresher) {
        tokenRecoveryAttempted = true;
        const recoveryAction: Extract<FixAction, 'refresh_token' | 'rotate_token'> =
          status === 401 || status === 429 ? 'refresh_token' : 'rotate_token';
        const recoveryMessage =
          recoveryAction === 'refresh_token'
            ? 'Token refreshed after provider rejection.'
            : 'Token rotated after provider notice.';

        const recoveryContext: TokenRecoveryContext = {
          status,
          attempt: attempt + 1,
          region: currentRegion || 'default',
          previousToken: currentTokenValue,
        };

        try {
          const nextToken = await tokenRefresher(recoveryContext);
          if (nextToken) {
            updateAuthorizationHeader(nextToken);
            fixActionsForAttempt.push(recoveryAction);
            fixActionSet.add(recoveryAction);
            logEntry.fixActions = [...fixActionsForAttempt];
            logEntry.error = recoveryMessage;
            attempts.push(logEntry);
            logger?.(logEntry);
            continue;
          }
        } catch (recoveryError) {
          const message =
            recoveryError instanceof Error
              ? recoveryError.message
              : 'Token recovery failed';
          lastError = {
            status,
            message,
          };
          logEntry.fixActions = [...fixActionsForAttempt];
          logEntry.error = message;
          attempts.push(logEntry);
          logger?.(logEntry);
          break;
        }

        lastError = {
          status,
          message: 'Token recovery unavailable.',
        };
        logEntry.fixActions = [...fixActionsForAttempt];
        logEntry.error = lastError.message;
        attempts.push(logEntry);
        logger?.(logEntry);
        break;
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

        const hasAttemptsRemaining = attempt < totalAttempts - 1;

        if (hasAttemptsRemaining) {
          if (retryBudget && !consumeRetryBudget(retryBudget)) {
            const message = `Retry budget exhausted for key "${retryBudget.key}".`;
            fixActionsForAttempt.push('retry_budget_exhausted');
            fixActionSet.add('retry_budget_exhausted');
            logEntry.fixActions = [...fixActionsForAttempt];
            logEntry.error = message;
            attempts.push(logEntry);
            logger?.(logEntry);
            lastError = {
              status,
              message,
            };
            break;
          }

          logEntry.fixActions = fixActionsForAttempt;
          attempts.push(logEntry);
          logger?.(logEntry);

          const retryAfterMs = parseRetryAfterMs(response);
          const delay = calculateDelayMs(
            attempt,
            backoffBaseMs,
            backoffMaxMs,
            jitterRatio,
            retryAfterMs,
          );
          await sleep(delay);
          continue;
        }

        logEntry.fixActions = fixActionsForAttempt;
        attempts.push(logEntry);
        logger?.(logEntry);
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
      const hasAttemptsRemaining = attempt < totalAttempts - 1;

      if (hasAttemptsRemaining) {
        if (retryBudget && !consumeRetryBudget(retryBudget)) {
          const message = `Retry budget exhausted for key "${retryBudget.key}".`;
          fixActionsForAttempt.push('retry_budget_exhausted');
          fixActionSet.add('retry_budget_exhausted');
          logEntry.error = `${errorMessage}. ${message}`;
          logEntry.fixActions = fixActionsForAttempt;
          attempts.push(logEntry);
          logger?.(logEntry);
          lastError = {
            message,
          };
          break;
        }

        logEntry.fixActions = fixActionsForAttempt;
        attempts.push(logEntry);
        logger?.(logEntry);

        const delay = calculateDelayMs(
          attempt,
          backoffBaseMs,
          backoffMaxMs,
          jitterRatio,
        );
        await sleep(delay);
        continue;
      }

      logEntry.fixActions = fixActionsForAttempt;
      attempts.push(logEntry);
      logger?.(logEntry);

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
      correlationId,
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
