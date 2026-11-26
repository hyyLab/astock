// ============================================================
// 通用网络工具：带超时的 fetch + 并发池
// ============================================================

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface FetchOpts {
  timeoutMs?: number;
  referer?: string;
  retries?: number;
  /** 请求间隔（毫秒），用于对数据源友好限速 */
  gapMs?: number;
}

let lastRequestAt = 0;

async function isWafBlock(err: unknown): Promise<boolean> {
  return String((err as Error)?.message ?? "").includes("HTTP 501");
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { timeoutMs = 12000, referer, retries = 1, gapMs = 0 } = opts;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    // 限速：与上次请求保持最小间隔，避免触发 WAF
    if (gapMs > 0) {
      const wait = lastRequestAt + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": DEFAULT_UA,
          ...(referer ? { Referer: referer } : {}),
        },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 90)}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      // 命中 WAF（HTTP 501）时用长退避重试
      const backoff = (await isWafBlock(e)) ? 6000 * (i + 1) * 2 : 400 + i * 600;
      if (i < retries) await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const text = await fetchText(url, opts);
  return JSON.parse(text) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 有界并发映射：保持输入顺序输出结果 */
export async function pmap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch {
        // 单个失败不阻塞整体，占位由调用方处理
        results[idx] = undefined as unknown as R;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
