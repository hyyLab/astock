// ============================================================
// 本地内存缓存（对应方案第二十步 Redis 环节的第一版实现）
// 键名风格与方案中的 Redis key 保持一致，后续可平滑切换：
//   review:today:market / review:today:limit_up / ...
// Vue->FastAPI->Redis 的链路对应为 Client->API Route->本缓存->SQLite
// ============================================================

interface CacheEntry {
  ts: number;
  data: unknown;
}

const store = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000;

export function cacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > DEFAULT_TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit.data as T;
}

export function cacheSet(key: string, data: unknown): void {
  store.set(key, { ts: Date.now(), data });
}

/** 读缓存或回源计算后写缓存（默认 TTL 60s） */
export async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const data = await loader();
  cacheSet(key, data);
  return data;
}

/** 带自定义 TTL 的读缓存（资讯类数据用，如新闻 2 分钟） */
export async function cachedTtl<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts <= ttlMs) return hit.data as T;
  const data = await loader();
  store.set(key, { ts: Date.now(), data });
  return data;
}

export function cacheClearPrefix(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
