// ============================================================
// 盘中同步启动聚类（题材发现与佐证工具）
//
// 逻辑：同一板块的股票往往在盘中同一时段被资金集中点火——
// 首封时间相邻（默认间隔 ≤2 分钟链式聚合）且数量 ≥3 只的批次，
// 很可能是同一题材的同步启动。参考炒作类型归类的辅助信号：
//   · 批次内 ≥2 只共享同一主线题材 → 佐证该题材（如 尾盘福建概念批量封板）
//   · 批次内无共享主线 → "待归类候选"（可能是新题材，供维护 themeRules.ts）
//
// 纯前端聚合计算：输入当日涨停明细（含首封时间），不落库、不改 schema。
// ============================================================

export interface SyncLaunchInput {
  stockCode: string;
  stockName: string;
  boardCount: number;
  industry: string | null;
  themes: string | null; // JSON 字符串（LimitUp.themes）
  firstLimitTime: string | null; // HH:MM:SS
}

export interface SyncClusterStock {
  stockCode: string;
  stockName: string;
  boardCount: number;
  industry: string | null;
  themes: string[];
  firstLimitTime: string;
}

export interface SyncCluster {
  windowLabel: string; // 如 "14:23~14:24"
  startLabel: string; // 如 "14:23"
  phase: "open" | "am" | "midday" | "pm"; // 竞价开盘/上午/午间/尾盘
  phaseLabel: string; // 中文阶段名（open→竞价/开盘 等）
  kind: "batch" | "wave"; // batch=题材批次（跨度≤10分钟，有效信号）/ wave=启动潮（跨度大，低信号）
  spanMinutes: number; // 批次首尾跨度（分钟）
  stocks: SyncClusterStock[];
  sharedThemes: string[]; // ≥2 只成员共享的主线题材（题材佐证）
  isCandidate: boolean; // 无共享主线 → 候选新题材（仅 batch 有意义）
}

/** 分钟差（"HH:MM:SS" → 当日分钟数），无法解析返回 null */
function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function phaseOf(t: string): SyncCluster["phase"] {
  const mins = toMinutes(t) ?? 0;
  if (mins < 9 * 60 + 35) return "open"; // 竞价/开盘秒板
  if (mins < 11 * 60 + 30) return "am";
  if (mins < 13 * 60 + 30) return "midday";
  return "pm";
}

export const PHASE_LABEL: Record<SyncCluster["phase"], string> = {
  open: "竞价/开盘",
  am: "上午",
  midday: "午间",
  pm: "午后/尾盘",
};

/**
 * 同步启动聚类：
 * @param gapMinutes 相邻两股首封时间最大间隔（分钟），默认 2
 * @param minSize 聚类最小股票数，默认 3
 * @param spanMaxMinutes 批次最大跨度（分钟），超过则视为"启动潮"（开盘/盘中普涨封板潮，非题材批次），默认 10
 */
export function buildSyncClusters(
  rows: SyncLaunchInput[],
  opts?: { gapMinutes?: number; minSize?: number; spanMaxMinutes?: number }
): SyncCluster[] {
  const gap = (opts?.gapMinutes ?? 2) * 60; // 秒
  const minSize = opts?.minSize ?? 3;
  const spanMax = (opts?.spanMaxMinutes ?? 10) * 60;

  const timed = rows
    .filter((r) => r.firstLimitTime && toMinutes(r.firstLimitTime) !== null)
    .map((r) => {
      let themes: string[] = [];
      if (r.themes) {
        try { themes = JSON.parse(r.themes) as string[]; } catch { themes = []; }
      }
      return {
        stockCode: r.stockCode,
        stockName: r.stockName.replace(/[\s*＊]/g, ""),
        boardCount: r.boardCount,
        industry: r.industry,
        themes,
        firstLimitTime: r.firstLimitTime!.trim(),
        secs: toMinutes(r.firstLimitTime)! * 60 + (Number(r.firstLimitTime.slice(-2)) || 0),
      };
    })
    .sort((a, b) => a.secs - b.secs || a.firstLimitTime.localeCompare(b.firstLimitTime));

  // 链式聚合：相邻首封间隔 ≤ gapMinutes 归为同批
  const clusters: SyncClusterStock[][] = [];
  let current: (typeof timed)[number][] = [];
  for (const s of timed) {
    if (current.length === 0 || s.secs - current[current.length - 1].secs <= gap) {
      current.push(s);
    } else {
      clusters.push(current);
      current = [s];
    }
  }
  if (current.length > 0) clusters.push(current);

  return clusters
    .filter((c) => c.length >= minSize)
    .map((c) => {
      // 共享主线：出现于 ≥2 只成员的题材
      const themeCount = new Map<string, number>();
      for (const s of c) for (const t of s.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
      const sharedThemes = [...themeCount.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t);

      const label = (x: SyncClusterStock) => x.firstLimitTime.slice(0, 5);
      const phase = phaseOf(c[0].firstLimitTime);
      const spanSeconds = c[c.length - 1].secs - c[0].secs;
      return {
        windowLabel: `${label(c[0])}~${label(c[c.length - 1])}`,
        startLabel: label(c[0]),
        phase,
        phaseLabel: PHASE_LABEL[phase],
        kind: spanSeconds <= spanMax ? ("batch" as const) : ("wave" as const),
        spanMinutes: Math.round((spanSeconds / 60) * 10) / 10,
        stocks: c.map((s) => ({
          stockCode: s.stockCode,
          stockName: s.stockName,
          boardCount: s.boardCount,
          industry: s.industry,
          themes: s.themes,
          firstLimitTime: s.firstLimitTime,
        })),
        sharedThemes,
        isCandidate: sharedThemes.length === 0,
      };
    });
}
