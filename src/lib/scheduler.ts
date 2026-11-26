// ============================================================
// 进程内轻量调度器（新闻每日自动更新的核心）
//
// 背景：此前快讯只在「有人打开页面触发 /api/news」时才抓取入库；
// 本调度器让服务端进程自己按北京时间自动执行：
//   ① 快讯自动更新：每日 07:00–23:59，每 10 分钟抓取新浪 7x24 快讯入库（幂等 upsert）
//   ② 全量采集：工作日 15:35 / 17:35 自动跑 runCollection
//      （涨停池/炸板/日K/爆量/题材/个股新闻证据等全链路，幂等可重跑）
//   ③ 收盘数据缺口自愈：启动 20 秒后 + 每日 09:05 盘前各检查一次——
//      库内最新交易日 < 最近应收盘交易日（进程曾被回收、定时点错过）
//      → 补跑采集（幂等回补近 10 个交易日，次日发现也能补上）
//      快讯同样在启动时立即补抓一次
//
// 说明：
// - 平台环境无独立 cron 守护，故用 instrumentation（src/instrumentation.ts）
//   在服务进程启动时拉起；进程内 setInterval，HMR/重复 register 有 globalThis 防重入
// - 北京时间 = UTC+8 偏移后读 getUTC*，不依赖服务器时区
// - 运行状态存 globalThis，供 /api/admin/scheduler 查询
// ============================================================

import { db } from "@/lib/db";
import { cacheClearPrefix } from "@/lib/cache";
import { refreshNewsNow } from "@/lib/services/news";
import { runCollection } from "@/lib/collector/collect";
import { runIntradayPoll, pruneIntraday } from "@/lib/collector/intradayPoll";
import { bjHHMM, bjNow as calcBjNow, sessionInfo, shouldPollAt } from "@/lib/calc/intradayMoves";

interface JobState {
  lastRunAt: string | null; // 最近一次运行时间（ISO）
  lastOk: boolean | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runs: number;
}

interface SchedulerGlobal {
  __lbSchedulerStarted?: boolean;
  __lbSchedulerState?: { news: JobState; collect: JobState; intraday: JobState };
  __lbSchedulerLastMinuteKey?: string;
  __lbSchedulerTimer?: ReturnType<typeof setInterval>;
  __lbSchedulerGapCheckDate?: string; // 最近一次缺口补跑的北京日期（每日一次防抖，长假不空转）
}

const g = globalThis as SchedulerGlobal;

/** 北京时间（UTC+8 偏移后以 getUTC* 读取） */
function bjNow(): Date {
  return new Date(Date.now() + 8 * 3600_000);
}

function bjDateStr(d: Date = bjNow()): string {
  return d.toISOString().slice(0, 10);
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function emptyState(): JobState {
  return { lastRunAt: null, lastOk: null, lastError: null, lastDurationMs: null, runs: 0 };
}

function state(): { news: JobState; collect: JobState; intraday: JobState } {
  if (!g.__lbSchedulerState)
    g.__lbSchedulerState = { news: emptyState(), collect: emptyState(), intraday: emptyState() };
  return g.__lbSchedulerState;
}

async function runNewsJob(): Promise<void> {
  const st = state().news;
  const t0 = Date.now();
  st.lastRunAt = new Date().toISOString();
  try {
    const r = await refreshNewsNow();
    st.lastOk = true;
    st.lastError = null;
    console.log(`[scheduler] 快讯自动更新完成：${r.count} 条 @ ${r.fetchedAt}`);
  } catch (e) {
    st.lastOk = false;
    st.lastError = (e as Error).message;
    console.error("[scheduler] 快讯自动更新失败:", (e as Error).message);
  } finally {
    st.lastDurationMs = Date.now() - t0;
    st.runs += 1;
  }
}

async function runCollectJob(reason: string): Promise<void> {
  const st = state().collect;
  const t0 = Date.now();
  st.lastRunAt = new Date().toISOString();
  try {
    const s = await runCollection({ backfillDays: 10 });
    cacheClearPrefix("review:");
    cacheClearPrefix("stock:");
    cacheClearPrefix("news:");
    cacheClearPrefix("anomaly:");
    cacheClearPrefix("volume-hold:");
    cacheClearPrefix("intraday:");
    // 盘中采样表只留最近 3 个交易日（事件留 30 天），随每日采集滚动清理
    await pruneIntraday(3);
    st.lastOk = true;
    st.lastError = null;
    console.log(`[scheduler] 自动采集完成（${reason}）：最新交易日 ${s.latestDate}，涨停 ${s.limitUpCount} 只，个股新闻 ${s.stockNewsCount} 条`);
  } catch (e) {
    st.lastOk = false;
    st.lastError = (e as Error).message;
    console.error(`[scheduler] 自动采集失败（${reason}）:`, (e as Error).message);
  } finally {
    st.lastDurationMs = Date.now() - t0;
    st.runs += 1;
  }
}

/** 最近一个「应已收盘」的交易日：工作日 15:35 后 = 今天，否则 = 上一个工作日 */
function lastExpectedEodDate(): string {
  const d = bjNow();
  const t = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (isWeekday(d) && t >= 15 * 60 + 35) return bjDateStr(d);
  for (let i = 1; i <= 7; i++) {
    const prev = new Date(d.getTime() - i * 86_400_000);
    if (isWeekday(prev)) return bjDateStr(prev);
  }
  return bjDateStr(d);
}

/**
 * 收盘数据缺口检测：库内最新交易日 < 最近应收盘交易日 → 补跑采集。
 * 覆盖场景：进程在 15:35 采集点被回收、整段时间宕机、次日才发现缺口。
 * 幂等（runCollection 可重跑回补近 10 日）；每日只补跑一次防抖
 * （法定节假日按工作日规则会认为有缺口，防抖避免长假每天空转）。
 * 返回是否触发了补跑。
 */
async function gapCheck(reason: string): Promise<boolean> {
  const today = bjDateStr();
  if (g.__lbSchedulerGapCheckDate === today) return false; // 今天已补跑过
  const expected = lastExpectedEodDate();
  const latest = await db.dailyMarket.findFirst({
    orderBy: { tradeDate: "desc" },
    select: { tradeDate: true },
  });
  if (latest && latest.tradeDate >= expected) return false; // 无缺口
  console.log(
    `[scheduler] 收盘数据缺口（${reason}）：库内最新 ${latest?.tradeDate ?? "无"} < 应有 ${expected}，补跑采集`
  );
  g.__lbSchedulerGapCheckDate = today;
  await runCollectJob(`缺口补跑·${reason}`);
  return true;
}

/** 盘中采样：交易时段每 2 分钟一轮（调度器每分钟 tick 判定，偶数分钟触发） */
async function runIntradayJob(): Promise<void> {
  const st = state().intraday;
  const t0 = Date.now();
  st.lastRunAt = new Date().toISOString();
  try {
    const r = await runIntradayPoll();
    st.lastOk = true;
    st.lastError = null;
    console.log(
      `[scheduler] 盘中采样完成 ${r.tradeDate} ${r.pollTs}：宇宙 ${r.universeCount} 只 · 回补基线 ${r.backfillCount} 只 · 异动事件 ${r.eventsCount} 条 · ${r.durationMs}ms`
    );
  } catch (e) {
    st.lastOk = false;
    st.lastError = (e as Error).message;
    console.error("[scheduler] 盘中采样失败:", (e as Error).message);
  } finally {
    st.lastDurationMs = Date.now() - t0;
    st.runs += 1;
  }
}

/** 每分钟心跳：判断是否到达任务触发点 */
function tick(): void {
  const bj = bjNow();
  const minuteKey = `${bjDateStr(bj)} ${bj.getUTCHours()}:${bj.getUTCMinutes()}`;
  if (minuteKey === g.__lbSchedulerLastMinuteKey) return; // 同一分钟只判一次
  g.__lbSchedulerLastMinuteKey = minuteKey;

  const t = bj.getUTCHours() * 60 + bj.getUTCMinutes();

  // ① 快讯：07:00–23:59 每 10 分钟
  if (t >= 7 * 60 && t <= 23 * 60 + 59 && bj.getUTCMinutes() % 10 === 0) {
    void runNewsJob();
  }

  // ② 全量采集：工作日 15:35（收盘数据落定）/ 17:35（15:35 失败后的重试点）
  if (isWeekday(bj) && (t === 15 * 60 + 35 || t === 17 * 60 + 35)) {
    void runCollectJob("定时触发");
  }

  // ③ 盘中采样：交易时段每 2 分钟（09:20–11:36 ∪ 12:55–15:06，偶数分钟触发）
  if (isWeekday(bj) && shouldPollAt(t)) {
    void runIntradayJob();
  }

  // ④ 收盘数据缺口巡检：每日 09:05 盘前（昨天的数据若因宕机/进程回收缺失，开盘前补上）
  if (t === 9 * 60 + 5) {
    void gapCheck("盘前巡检");
  }
}

/** 启动自检：补齐因进程回收错过的任务 */
async function startupCheck(): Promise<void> {
  try {
    // 快讯立即补抓一次（预热，无需等下一个 10 分钟刻度）
    void runNewsJob();

    // 盘中自检：处于交易采样窗口内 → 立即补一轮采样（进程被回收后重启的兑底）
    const bj2 = calcBjNow();
    const info = sessionInfo(bj2);
    const t2 = bj2.getUTCHours() * 60 + bj2.getUTCMinutes();
    if (info.isTradingDay && shouldPollAt(t2)) {
      console.log(`[scheduler] 启动自检：处于交易时段（${bjHHMM(bj2)} ${info.label}），立即补一轮盘中采样`);
      void runIntradayJob();
    }

    // 收盘数据缺口检测（启动即查：昨天/近期交易日的缺口当场补上，不必等到 15:35）
    await gapCheck("启动自检");
  } catch (e) {
    console.error("[scheduler] 启动自检失败:", (e as Error).message);
  }
}

/** 由 instrumentation（src/instrumentation.ts）在服务进程启动时调用 */
export function startScheduler(): void {
  if (g.__lbSchedulerStarted) return; // HMR / 重复 register 防重入
  g.__lbSchedulerStarted = true;

  g.__lbSchedulerTimer = setInterval(tick, 60_000);
  g.__lbSchedulerTimer.unref?.(); // 不阻止进程正常退出

  console.log(
    "[scheduler] 已启动：盘中采样每2分钟（交易时段）· 快讯每10分钟（07:00–23:59 北京时间）· 全量采集工作日 15:35/17:35 · 收盘缺口自愈（启动+每日09:05）· 启动自检 20s 后执行"
  );
  setTimeout(() => void startupCheck(), 20_000).unref?.();
}

/** 调度器运行状态（/api/admin/scheduler） */
export function getSchedulerStatus() {
  return {
    started: !!g.__lbSchedulerStarted,
    beijingNow: `${bjDateStr()} ${String(bjNow().getUTCHours()).padStart(2, "0")}:${String(
      bjNow().getUTCMinutes()
    ).padStart(2, "0")}（UTC+8）`,
    schedule: {
      news: "每日 07:00–23:59 每 10 分钟",
      collect: "工作日 15:35 / 17:35（北京时间）",
      intraday: "交易时段每 2 分钟采样（09:20–11:36 ∪ 12:55–15:06）",
      gapCheck: "收盘数据缺口自愈：启动自检 + 每日 09:05 盘前巡检（每日最多补跑一次）",
    },
    jobs: state(),
  };
}
