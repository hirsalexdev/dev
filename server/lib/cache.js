import { config } from './config.js';

// Small TTL + LRU cache. Every cache hit is one request Instagram never sees,
// which is the single most effective rate-limit defence in this whole service.
const store = new Map();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }

  // Refresh recency for the LRU eviction below.
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function cacheSet(key, value, ttlSeconds = config.cacheTtlSeconds) {
  if (store.size >= config.cacheMaxEntries) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }

  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function cacheStats() {
  return { entries: store.size, max: config.cacheMaxEntries };
}
