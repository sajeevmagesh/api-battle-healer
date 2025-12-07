type CacheEntry<T = unknown> = {
  data: T;
  cachedAt: number;
};

const cacheStore = new Map<string, CacheEntry>();

export function rememberResponse<T>(key: string, data: T): void {
  cacheStore.set(key, { data, cachedAt: Date.now() });
}

export function recallResponse<T>(key: string, ttlMs: number): CacheEntry<T> | null {
  const entry = cacheStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    return null;
  }
  if (ttlMs > 0 && Date.now() - entry.cachedAt > ttlMs) {
    return null;
  }
  return entry;
}

