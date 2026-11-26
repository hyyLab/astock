// ============================================================
// 盘中异动判定层（纯函数，供采样器与查询服务共用）
//
// 时段判定：北京时间（UTC+8 偏移读 getUTC*，与 scheduler 同约定）
//   交易采样窗口 = 工作日 09:20–11:36 ∪ 12:55–15:06（覆盖竞价后与收盘瞬间）
//
// 窗口涨幅：当前价 vs 窗口起点最近一次采样价（优先精确基线，回退当日最早采样）
//
// 事件阈值（口径透明，与前端口径说明一致）：
//   拉升：10 分钟窗口涨幅 ≥ +2.0%
//     ├─ 共振拉升：同期上证 ≥ +0.15%
//     ├─ 逆势拉升：同期上证 ≤ -0.15%
//     └─ 独立拉升：大盘窗口基本走平
//   跳水：10 分钟窗口跌幅 ≤ -3.0%
//   封板：涨幅达到涨停幅度（阈值容差 0.15pp，规避价格舍入）
//   炸板：上一采样轮封板、本轮脱离涨停价
//   分时爆量：腾讯实时量比 ≥ 3 且当日涨幅 ≥ 1%（放量且向上）
//   去重：同股同类事件 10 分钟一个桶（dedupeKey），防刷屏
// ============================================================

export type EventKind =
  | "surge_resonance"
  | "surge_counter"
  | "surge"
  | "dive"
  | "seal"
  | "unseal"
  | "volume";

export const EVENT_KIND_META: Record<EventKind, { label: string; cls: string }> = {
  surge_resonance: { label: "共振拉升", cls: "text-up bg-up-soft" },
  surge_counter: { label: "逆势拉升", cls: "text-down bg-down-soft" },
  surge: { label: "快速拉升", cls: "text-up bg-up-soft" },
  dive: { label: "快速跳水", cls: "text-down bg-down-soft" },
  seal: { label: "封板", cls: "text-up bg-up-soft" },
  unseal: { label: "炸板", cls: "text-warn bg-warn-soft" },
  volume: { label: "分时爆量", cls: "text-warn bg-warn-soft" },
};

// ---------- 阈值集中定义 ----------

export const SURGE_WINDOW_MIN = 10; // 拉升/跳水判定窗口（分钟）
export const SURGE_PCT = 2.0; // 拉升阈值 %
export const DIVE_PCT = -3.0; // 跳水阈值 %
export const IDX_RES_PCT = 0.15; // 大盘窗口共振/逆势分界（百分点）
export const VOLUME_RATIO_PCT = 3; // 分时爆量量比阈值（腾讯口径）
export const VOLUME_MOVE_PCT = 1; // 分时爆量要求当日最低涨幅 %
export const LIMIT_TOL_PCT = 0.15; // 封板判定的幅度容差（百分点）
export const MIN_BASELINE_AGE_MIN = 3; // 窗口基线最小时效（分钟），防止基线太近失真
export const BASELINE_MAX_SLACK_MIN = 5; // 基线最大滞后（分钟），超过视为窗口失真（如午休跨越）

// ---------- 北京时间与交易时段 ----------

export function bjNow(): Date {
  return new Date(Date.now() + 8 * 3600_000);
}

export function bjDateStr(d: Date = bjNow()): string {
  return d.toISOString().slice(0, 10);
}

/** "HH:MM"（北京时间） */
export function bjHHMM(d: Date = bjNow()): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "HHMM" 4 位数字（分时接口时间轴用） */
export function bjHHMM4(d: Date = bjNow()): string {
  const s = bjHHMM(d).replace(":", "");
  return s;
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

export type SessionPhase = "pre" | "am" | "lunch" | "pm" | "closed";

export interface SessionInfo {
  phase: SessionPhase;
  label: string; // 未开盘 / 盘中(上午) / 午间休市 / 盘中(下午) / 已收盘 / 非交易日
  isTradingDay: boolean; // 工作日（节假日由数据源自校验兜底，见采样器）
  inPollWindow: boolean; // 当前是否应执行采样
  isTrading: boolean; // phase === am || pm
}

export function sessionInfo(d: Date = bjNow()): SessionInfo {
  const tradingDay = isWeekday(d);
  const t = d.getUTCHours() * 60 + d.getUTCMinutes();
  let phase: SessionPhase;
  if (!tradingDay) phase = "closed";
  else if (t < 9 * 60 + 15) phase = "pre";
  else if (t <= 11 * 60 + 30) phase = "am";
  else if (t < 13 * 60) phase = "lunch";
  else if (t <= 15 * 60) phase = "pm";
  else phase = "closed";
  // 采样窗口：上午/下午各向两端多留几分钟（9:20 前竞价、11:36/15:06 收盘落定）
  const inPollWindow =
    tradingDay &&
    ((t >= 9 * 60 + 20 && t <= 11 * 60 + 36) || (t >= 12 * 60 + 55 && t <= 15 * 60 + 6));
  const label = !tradingDay
    ? "非交易日"
    : phase === "pre"
      ? "未开盘"
      : phase === "am"
        ? "盘中 · 上午时段"
        : phase === "lunch"
          ? "午间休市"
          : phase === "pm"
            ? "盘中 · 下午时段"
            : "已收盘";
  return { phase, label, isTradingDay: tradingDay, inPollWindow, isTrading: phase === "am" || phase === "pm" };
}

/** 该分钟是否应执行采样（调度器每分钟 tick 调用；偶数分钟采样，节奏 2 分钟） */
export function shouldPollAt(tMinutes: number, minuteMod = 2): boolean {
  return (
    (tMinutes >= 9 * 60 + 20 && tMinutes <= 11 * 60 + 36) ||
    (tMinutes >= 12 * 60 + 55 && tMinutes <= 15 * 60 + 6)
  ) && tMinutes % minuteMod === 0;
}

// ---------- 涨停状态（按涨幅近似，规避快照无最高价） ----------

export type LimitState = "sealed" | "near" | null;

/** limitPct：该股涨跌幅限制（10/20/30/5），由 rules.limitPctOf 提供 */
export function limitStateOf(changePct: number, limitPct: number): LimitState {
  if (changePct >= limitPct - LIMIT_TOL_PCT) return "sealed";
  if (changePct >= limitPct - 1.2) return "near";
  return null;
}

// ---------- 窗口基线 ----------

export interface SnapPoint {
  pollTs: string; // "HH:MM"
  price: number;
}

/**
 * 从当日采样点序列中取窗口基线：
 * 1) 优先取「不晚于 t-window 的最近一点」（精确窗口起点）
 * 2) 回退当日最早一点（仅当时效 ≥ MIN_BASELINE_AGE_MIN 时有效，窗口为部分窗口）
 * 返回 null 表示基线不足、无法计算窗口涨幅
 */
export function windowBaseline(
  points: SnapPoint[],
  nowTs: string,
  windowMin: number
): { price: number; ageMin: number } | null {
  if (points.length === 0) return null;
  const toMin = (ts: string) => Number(ts.slice(0, 2)) * 60 + Number(ts.slice(3, 5));
  const now = toMin(nowTs);
  const sorted = [...points].sort((a, b) => a.pollTs.localeCompare(b.pollTs));
  const target = now - windowMin;
  let exact: SnapPoint | null = null;
  for (const p of sorted) {
    if (toMin(p.pollTs) <= target) exact = p;
    else break;
  }
  const chosen = exact ?? sorted[0];
  const ageMin = now - toMin(chosen.pollTs);
  if (ageMin < MIN_BASELINE_AGE_MIN) return null;
  if (ageMin > windowMin + BASELINE_MAX_SLACK_MIN) return null; // 基线过旧（午休/断采）→ 窗口不可比
  if (!(chosen.price > 0)) return null;
  return { price: chosen.price, ageMin };
}

// ---------- 事件检测 ----------

export interface PollRow {
  stockCode: string;
  stockName: string;
  price: number;
  changePct: number;
  volumeRatio: number | null;
  limitState: LimitState;
  themes: string[];
}

export interface DetectedEvent {
  ts: string; // "HH:MM"
  kind: EventKind;
  stockCode: string;
  stockName: string;
  price: number;
  changePct: number;
  windowPct: number | null;
  indexPct: number | null;
  rsPct: number | null;
  volumeRatio: number | null;
  themes: string[];
  detail: Record<string, unknown>;
  dedupeKey: string;
}

export interface DetectInput {
  tradeDate: string;
  ts: string; // "HH:MM" 本轮采样时刻
  rows: PollRow[];
  /** 10 分钟窗口基线：code → {price, ageMin}（无基线的股不产生拉升/跳水事件） */
  baseline10: Map<string, { price: number; ageMin: number }>;
  /** 大盘窗口：指数当前涨幅 与 10 分钟前涨幅（缺失时共振/逆势不可分，归独立） */
  indexPctNow: number | null;
  indexPctBase: number | null;
  /** 上一采样轮处于封板状态的股票集合（炸板判定） */
  prevSealed: Set<string>;
}

function bucket10(ts: string): string {
  const h = Number(ts.slice(0, 2));
  const m = Number(ts.slice(3, 5));
  const b = Math.floor(m / 10) * 10;
  return `${ts.slice(0, 2)}:${String(b).padStart(2, "0")}`;
}

/** 对一轮采样做异动事件检测（纯函数，不落库） */
export function detectEvents(input: DetectInput): DetectedEvent[] {
  const { tradeDate, ts, rows, baseline10, indexPctNow, indexPctBase, prevSealed } = input;
  const indexWindow =
    indexPctNow != null && indexPctBase != null
      ? Math.round((indexPctNow - indexPctBase) * 100) / 100
      : null;
  const out: DetectedEvent[] = [];
  for (const r of rows) {
    const base = baseline10.get(r.stockCode);
    const windowPct = base ? Math.round((r.price / base.price - 1) * 10000) / 100 : null;

    const mk = (
      kind: EventKind,
      over?: { windowPct?: number; indexPct?: number; rsPct?: number; indexWindow?: number }
    ): DetectedEvent => {
      const wWin = over?.windowPct !== undefined ? over.windowPct : (windowPct ?? null);
      const wIdx =
        over?.indexPct !== undefined
          ? over.indexPct
          : over?.indexWindow !== undefined
            ? over.indexWindow
            : windowPct != null
              ? indexWindow
              : null;
      const wRs =
        over?.rsPct !== undefined
          ? over.rsPct
          : wWin != null && wIdx != null
            ? Math.round((wWin - wIdx) * 100) / 100
            : null;
      return {
        ts,
        kind,
        stockCode: r.stockCode,
        stockName: r.stockName,
        price: r.price,
        changePct: r.changePct,
        windowPct: wWin,
        indexPct: wIdx,
        rsPct: wRs,
        volumeRatio: r.volumeRatio,
        themes: r.themes,
        detail: { windowMinutes: wWin != null ? SURGE_WINDOW_MIN : undefined },
        dedupeKey: `${tradeDate}|${r.stockCode}|${kind}|${bucket10(ts)}`,
      };
    };

    // 封板 / 炸板（状态转移，不依赖窗口基线）
    const sealedNow = r.limitState === "sealed";
    const wasSealed = prevSealed.has(r.stockCode);
    if (sealedNow && !wasSealed) {
      out.push(mk("seal"));
    } else if (!sealedNow && wasSealed) {
      out.push(mk("unseal", { windowPct: undefined, indexPct: undefined, rsPct: undefined }));
    }

    // 拉升三分类
    if (windowPct != null && windowPct >= SURGE_PCT && r.limitState !== "sealed") {
      const kind: EventKind =
        indexWindow == null || Math.abs(indexWindow) < IDX_RES_PCT
          ? "surge"
          : indexWindow > 0
            ? "surge_resonance"
            : "surge_counter";
      out.push(mk(kind, { indexWindow }));
    }

    // 快速跳水（封板状态不报跳水——跌停另说，日级监控已有跌停池）
    if (windowPct != null && windowPct <= DIVE_PCT && !sealedNow) {
      out.push(mk("dive", { indexWindow }));
    }

    // 分时爆量（量比≥3 且向上；封板股量比天然放大，报 seal 即可不重复报量）
    if (
      !sealedNow &&
      r.volumeRatio != null &&
      r.volumeRatio >= VOLUME_RATIO_PCT &&
      r.changePct >= VOLUME_MOVE_PCT
    ) {
      out.push(mk("volume", { windowPct: undefined, indexPct: undefined, rsPct: undefined }));
    }
  }
  return out;
}
