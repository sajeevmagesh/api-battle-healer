// SmartFetch implementation

const DEFAULT_RETRY_CODES = (() => {
  const set = new Set([429]);
  for (let status = 500; status <= 599; status += 1) {
    set.add(status);
  }
  return set;
})();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildUrlForRegion = (target, region) => {
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

const isRetryable = (status, retryCodes) => {
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

const shouldFallbackRegion = (status) => status === 503;

const RETRY_BUDGET_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1_000;

const retryBudgetStore = new Map();

const getRetryBudgetWindow = (config) => {
  const windowMs = config.windowMs ?? RETRY_BUDGET_DEFAULT_WINDOW_MS;
  const now = Date.now();
  const existing = retryBudgetStore.get(config.key);

  if (!existing || now - existing.windowStart >= windowMs) {
    const fresh = {
      count: 0,
      windowStart: now,
      windowMs,
    };
    retryBudgetStore.set(config.key, fresh);
    return fresh;
  }

  return existing;
};

const consumeRetryBudget = (config) => {
  const bucket = getRetryBudgetWindow(config);
  if (bucket.count >= config.limit) {
    return false;
  }
  bucket.count += 1;
  return true;
};

const parseRetryAfterMs = (response) => {
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
  attempt,
  baseMs,
  maxMs,
  jitterRatio,
  overrideDelay
) => {
  if (typeof overrideDelay === 'number') {
    return Math.min(maxMs, overrideDelay);
  }

  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitterWindow = Math.max(0, exponential * jitterRatio);
  const jitter = Math.random() * jitterWindow;
  return Math.min(maxMs, exponential + jitter);
};

async function safeParseBody(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch {
    return null;
  }
}

export async function smartFetch(url, options = {}, config = {}) {
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
  } = config;

  const retryCodeSet = retryStatusCodes?.length
    ? new Set(retryStatusCodes)
    : new Set(DEFAULT_RETRY_CODES);

  const attempts = [];
  const fixActionSet = new Set();
  const regionsTried = [];
  const totalAttempts = maxRetries + 1;
  let lastError = null;

  const dynamicHeaders = new Headers(options.headers || undefined);
  const formatToken = (token) => {
    const trimmed = token.trim();
    return trimmed.toLowerCase().startsWith('bearer ')
      ? trimmed
      : `Bearer ${trimmed}`;
  };

  let tokenRefreshAttempted = false;
  let deprecatedTokenHandled = false;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const currentRegion = regions[attempt % regions.length] || '';
    const targetUrl = buildUrlForRegion(url, currentRegion);
    regionsTried.push(currentRegion || 'default');
    const fixActionsForAttempt = [];
    const requestInit = {
      ...options,
      headers: new Headers(dynamicHeaders),
    };

    try {
      // For simulation purposes, we check if we are in a simulation mode via a global or passed config
      // But here we'll just do a real fetch. 
      // NOTE: Since this is a frontend demo, we might not have real endpoints that fail.
      // We might want to inject a custom fetch implementation for simulation.
      const fetchImpl = config.fetch || window.fetch;
      
      const response = await fetchImpl(targetUrl, requestInit);
      const status = response.status;
      const shouldRetry = isRetryable(status, retryCodeSet);

      const logEntry = {
        attempt: attempt + 1,
        region: currentRegion || 'default',
        url: targetUrl,
        status,
        fixActions: [],
      };

      if (response.ok) {
        const data = await safeParseBody(response);
        logEntry.fixActions = [...fixActionsForAttempt];
        attempts.push(logEntry);
        if (logger) logger(logEntry);

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

      if (
        status === 401 &&
        tokenRefresher &&
        !tokenRefreshAttempted
      ) {
        tokenRefreshAttempted = true;
        try {
          const nextToken = await tokenRefresher();
          if (nextToken) {
            dynamicHeaders.set(
              'Authorization',
              formatToken(nextToken),
            );
            fixActionsForAttempt.push('refresh_token');
            fixActionSet.add('refresh_token');
            logEntry.fixActions = [...fixActionsForAttempt];
            logEntry.error = 'Unauthorized. Token refreshed.';
            attempts.push(logEntry);
            if (logger) logger(logEntry);
            continue;
          }
        } catch (refreshError) {
          const message =
            refreshError instanceof Error
              ? refreshError.message
              : 'Token refresh failed';
          lastError = {
            status,
            message,
          };
          logEntry.fixActions = [...fixActionsForAttempt];
          logEntry.error = message;
          attempts.push(logEntry);
          if (logger) logger(logEntry);
          break;
        }
      }

      if (
        status === 410 &&
        tokenRefresher &&
        !deprecatedTokenHandled
      ) {
        deprecatedTokenHandled = true;
        try {
          const rotatedToken = await tokenRefresher();
          if (rotatedToken) {
            dynamicHeaders.set(
              'Authorization',
              formatToken(rotatedToken),
            );
            fixActionsForAttempt.push('rotate_token');
            fixActionSet.add('rotate_token');
            logEntry.fixActions = [...fixActionsForAttempt];
            logEntry.error = 'Deprecated token replaced.';
            attempts.push(logEntry);
            if (logger) logger(logEntry);
            continue;
          }
        } catch (rotationError) {
          const message =
            rotationError instanceof Error
              ? rotationError.message
              : 'Token rotation failed';
          lastError = {
            status,
            message,
          };
          logEntry.fixActions = [...fixActionsForAttempt];
          logEntry.error = message;
          attempts.push(logEntry);
          if (logger) logger(logEntry);
          break;
        }
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
            if (logger) logger(logEntry);
            lastError = {
              status,
              message,
            };
            break;
          }

          logEntry.fixActions = fixActionsForAttempt;
          attempts.push(logEntry);
          if (logger) logger(logEntry);

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
        if (logger) logger(logEntry);
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
      if (logger) logger(logEntry);
      break;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown network error';
      const logEntry = {
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
          if (logger) logger(logEntry);
          lastError = {
            message,
          };
          break;
        }

        logEntry.fixActions = fixActionsForAttempt;
        attempts.push(logEntry);
        if (logger) logger(logEntry);

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
      if (logger) logger(logEntry);

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