// ============================================================
// 采集健康检查 · P0（只读）
// A 采集成功 / B 窗口连续性 / C 行数对账 / D K线覆盖
// 输出：stdout 人读摘要 + logs/health-YYYYMMDD.json
// 退出码：FATAL=2 / ERROR=1 / WARN|INFO=0
// 约束：只读（不写库）、单次目标 < 3s、阈值集中
// ============================================================

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchAllIndexKlines } from "../src/lib/market/tx";
import { sealRateOf } from "../src/lib/calc/sentiment";

const THRESHOLDS = {
  maxAgeHours: 26, // 采集结果最大新鲜度（普通日）
  maxAgeHoursWeekend: 74, // 周一/周末放宽
  maxDurationMs: 180_000, // 单次采集耗时告警线
  poolCoverageMin: 0.95, // 当日 dailyStock 覆盖池内代码的最低比例
  missingFatalCount: 20, // 单日缺失超过该数 → FATAL
  missingFatalRatio: 0.05, // 单日缺失比例超过该值 → FATAL
  sealRateTolerance: 1e-4,
  calendarTimeoutMs: 2_500, // 交易日历联网预算，超时降级
  gapCheckDays: 5, // 个股断档抽查最近 N 个交易日
} as const;

type Level = "FATAL" | "ERROR" | "WARN" | "INFO";
interface CheckResult {
  id: string;
  level: Level;
  ok: boolean;
  detail: string;
}

const checks: CheckResult[] = [];
const add = (id: string, level: Level, ok: boolean, detail: string) => checks.push({ id, level, ok, detail });
const n = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const chunk = <T,>(a: T[], k: number) => Array.from({ length: Math.ceil(a.length / k) }, (_, i) => a.slice(i * k, i * k + k));
const startedAt = Date.now();
let winStart = "";
let winEnd = "";

const db = new PrismaClient({ log: [] });

function fmtList(arr: string[], max = 8) {
  return arr.slice(0, max).join(", ") + (arr.length > max ? ` …共${arr.length}项` : "");
}

async function main() {
  // ---------- 基线：最新采集日志 ----------
  const logs = await db.collectLog.findMany({ orderBy: { ranAt: "desc" }, take: 2 });
  const latestLog = logs[0];
  const latestSent = await db.sentimentDaily.findFirst({ orderBy: { tradeDate: "desc" } });
  const latestDate = latestSent?.tradeDate ?? "";

  // ---------- A 采集成功 ----------
  if (!latestLog) {
    add("A1", "FATAL", false, "collectLog 无记录，尚未成功采集过");
  } else {
    const statusOk = latestLog.status === "success";
    add(
      "A1",
      latestLog.status === "failed" ? "FATAL" : statusOk ? "INFO" : "ERROR",
      statusOk,
      `最新采集 ${latestLog.ranAt.toISOString()} status=${latestLog.status}`
    );

    const ageH = (Date.now() - latestLog.ranAt.getTime()) / 3_600_000;
    const dow = new Date().getDay();
    const limit = dow === 1 || dow === 0 || dow === 6 ? THRESHOLDS.maxAgeHoursWeekend : THRESHOLDS.maxAgeHours;
    add("A2", "FATAL", ageH <= limit, `距上次采集 ${ageH.toFixed(1)}h（阈值 ${limit}h）`);

    add(
      "A3",
      latestLog.durationMs > THRESHOLDS.maxDurationMs ? "WARN" : "INFO",
      latestLog.durationMs <= THRESHOLDS.maxDurationMs,
      `采集耗时 ${(latestLog.durationMs / 1000).toFixed(1)}s（阈值 ${THRESHOLDS.maxDurationMs / 1000}s）`
    );

    const windowEnd = latestLog.tradeDates.includes("~") ? latestLog.tradeDates.split("~")[1] : "";
    add(
      "A4",
      windowEnd && windowEnd !== latestDate ? "ERROR" : "INFO",
      !windowEnd || windowEnd === latestDate,
      `collectLog 窗口末日=${windowEnd || "?"} 库内最新=${latestDate || "?"}`
    );
  }
  const aligned = !!latestLog && (!latestLog.tradeDates.includes("~") || latestLog.tradeDates.split("~")[1] === latestDate);

  // ---------- 窗口 ----------
  let start = "";
  let end = "";
  if (latestLog?.tradeDates.includes("~")) {
    [start, end] = latestLog.tradeDates.split("~");
  } else {
    const ds = await db.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" }, select: { tradeDate: true } });
    start = ds[Math.max(0, ds.length - 10)]?.tradeDate ?? "";
    end = ds[ds.length - 1]?.tradeDate ?? "";
  }
  winStart = start;
  winEnd = end;
  if (!start || !end) {
    add("B0", "FATAL", false, "无法确定检查窗口（collectLog.tradeDates 与 sentimentDaily 均为空）");
    return;
  }
  const dbDates = (
    await db.sentimentDaily.findMany({
      where: { tradeDate: { gte: start, lte: end } },
      orderBy: { tradeDate: "asc" },
      select: { tradeDate: true },
    })
  ).map((r) => r.tradeDate);

  // ---------- B 窗口连续性 ----------
  const degraded = await Promise.race([
    fetchAllIndexKlines(90)
      .then((list) => ({ ok: true as const, list }))
      .catch(() => ({ ok: false as const, list: [] })),
    new Promise<{ ok: false; list: never[] }>((resolve) =>
      setTimeout(() => resolve({ ok: false, list: [] }), THRESHOLDS.calendarTimeoutMs)
    ),
  ]);
  const sh = degraded.list.find((s) => s.code === "000001");
  if (sh && sh.bars.length > 0) {
    const cal = sh.bars.map((b) => b.date).filter((d) => d >= start && d <= end);
    const have = new Set(dbDates);
    const miss = cal.filter((d) => !have.has(d));
    add("B1", miss.length ? "FATAL" : "INFO", miss.length === 0, miss.length ? `交易日历缺失 ${miss.length} 天：${fmtList(miss)}` : `窗口 ${start}~${end} 共 ${cal.length} 个交易日，无缺日`);
    const calSet = new Set(cal);
    const extra = dbDates.filter((d) => !calSet.has(d));
    add("B2", extra.length ? "WARN" : "INFO", extra.length === 0, extra.length ? `库内有交易日历外的日期：${fmtList(extra)}` : "库内日期均在交易日历内");
  } else {
    // 降级：仅本地连续性（相邻日期跨度 > 4 自然日视为可疑）
    const gaps: string[] = [];
    for (let i = 1; i < dbDates.length; i++) {
      const diff = (Date.parse(dbDates[i]) - Date.parse(dbDates[i - 1])) / 86_400_000;
      if (diff > 4) gaps.push(`${dbDates[i - 1]}→${dbDates[i]}(${diff}天)`);
    }
    add("B1", "WARN", gaps.length === 0, gaps.length ? `交易日历不可用，本地检出可疑跨度：${fmtList(gaps)}` : "交易日历不可用，已降级为本地连续性检查（无异常跨度）");
  }

  // ---------- C 行数对账 ----------
  const dateFilter = { gte: start, lte: end };
  const [luLatest, zbLatest, dtLatest] = await Promise.all([
    db.limitUp.count({ where: { tradeDate: latestDate } }),
    db.brokenLimit.count({ where: { tradeDate: latestDate } }),
    db.limitDown.count({ where: { tradeDate: latestDate } }),
  ]);
  const market = await db.dailyMarket.findFirst({ where: { tradeDate: latestDate } });
  const sent = await db.sentimentDaily.findFirst({ where: { tradeDate: latestDate } });
  const msg = latestLog?.message ? (JSON.parse(latestLog.message) as { broken?: number }) : {};
  add("C1", !aligned ? "INFO" : luLatest === (latestLog?.limitUpCount ?? -1) ? "INFO" : "ERROR", !aligned || luLatest === (latestLog?.limitUpCount ?? -1), !aligned ? "最新采集日志与库内最新日不一致，C1 跳过（见 A4）" : `最新日 limitUp=${luLatest} vs 日志 ${latestLog?.limitUpCount ?? "无"}`);
  add("C2", !aligned ? "INFO" : zbLatest === (msg.broken ?? -1) ? "INFO" : "ERROR", !aligned || zbLatest === (msg.broken ?? -1), !aligned ? "最新采集日志与库内最新日不一致，C2 跳过（见 A4）" : `最新日 brokenLimit=${zbLatest} vs 日志 ${msg.broken ?? "无"}`);
  add("C3", market?.limitUpCount === luLatest ? "INFO" : "ERROR", market?.limitUpCount === luLatest, `dailyMarket.limitUpCount=${market?.limitUpCount ?? "无"} vs limitUp 表 ${luLatest}`);
  const sr = sealRateOf(luLatest, zbLatest);
  const c4ok = !!sent && sent.limitUpCount === luLatest && sent.brokenLimitCount === zbLatest && Math.abs(sent.sealRate - sr) <= THRESHOLDS.sealRateTolerance;
  add("C4", c4ok ? "INFO" : "ERROR", c4ok, `sentimentDaily 对账：涨停 ${sent?.limitUpCount}/${luLatest} 炸板 ${sent?.brokenLimitCount}/${zbLatest} 封板率 ${sent?.sealRate?.toFixed(4)}/${sr.toFixed(4)} 跌停 ${sent?.limitDownCount}/${dtLatest}`);

  // 每日空窗（三池全 0）
  const poolDaily = await db.$queryRawUnsafe<{ tradeDate: string; c: bigint }[]>(
    `SELECT tradeDate, COUNT(*) c FROM (
       SELECT tradeDate, stockCode FROM LimitUp WHERE tradeDate >= ? AND tradeDate <= ?
       UNION SELECT tradeDate, stockCode FROM BrokenLimit WHERE tradeDate >= ? AND tradeDate <= ?
       UNION SELECT tradeDate, stockCode FROM LimitDown WHERE tradeDate >= ? AND tradeDate <= ?
     ) GROUP BY tradeDate`,
    start, end, start, end, start, end
  );
  const poolMap = new Map(poolDaily.map((r) => [r.tradeDate, n(r.c)]));
  const zeroDays = dbDates.filter((d) => (poolMap.get(d) ?? 0) === 0);
  add("C5", zeroDays.length ? "WARN" : "INFO", zeroDays.length === 0, zeroDays.length ? `三池全 0 的交易日：${fmtList(zeroDays)}` : "各交易日均有三池数据");

  // dailyStock 覆盖不低于池内代码的 95%
  const dsDaily = await db.$queryRawUnsafe<{ tradeDate: string; c: bigint }[]>(
    `SELECT tradeDate, COUNT(*) c FROM DailyStock WHERE tradeDate >= ? AND tradeDate <= ? GROUP BY tradeDate`,
    start, end
  );
  const dsMap = new Map(dsDaily.map((r) => [r.tradeDate, n(r.c)]));
  const lowCover = dbDates.filter((d) => {
    const exp = poolMap.get(d) ?? 0;
    if (exp === 0) return false;
    return (dsMap.get(d) ?? 0) < exp * THRESHOLDS.poolCoverageMin;
  });
  add("C6", lowCover.length ? "ERROR" : "INFO", lowCover.length === 0, lowCover.length ? `dailyStock 覆盖不足 95%：${fmtList(lowCover.map((d) => `${d}(${dsMap.get(d) ?? 0}/${poolMap.get(d) ?? 0})`))}` : `dailyStock 覆盖均 ≥ ${THRESHOLDS.poolCoverageMin * 100}%`);

  // ---------- D K线覆盖 ----------
  const missingRows = await db.$queryRawUnsafe<{ tradeDate: string; stockCode: string }[]>(
    `SELECT p.tradeDate, p.stockCode FROM (
       SELECT tradeDate, stockCode FROM LimitUp WHERE tradeDate >= ? AND tradeDate <= ?
       UNION SELECT tradeDate, stockCode FROM BrokenLimit WHERE tradeDate >= ? AND tradeDate <= ?
       UNION SELECT tradeDate, stockCode FROM LimitDown WHERE tradeDate >= ? AND tradeDate <= ?
     ) p
     LEFT JOIN DailyStock d ON d.tradeDate = p.tradeDate AND d.stockCode = p.stockCode
     WHERE d.stockCode IS NULL
     ORDER BY p.tradeDate DESC, p.stockCode LIMIT 500`,
    start, end, start, end, start, end
  );
  if (missingRows.length === 0) {
    add("D1", "INFO", true, `窗口 ${start}~${end} 池内代码均有 dailyStock 行`);
  } else {
    const byDate = new Map<string, string[]>();
    for (const r of missingRows) {
      const list = byDate.get(r.tradeDate) ?? [];
      list.push(r.stockCode);
      byDate.set(r.tradeDate, list);
    }
    const fatalDays: string[] = [];
    const errDays: string[] = [];
    for (const [d, list] of byDate) {
      const exp = poolMap.get(d) ?? list.length;
      const ratio = exp ? list.length / exp : 1;
      const tag = `${d}(缺${list.length}/${exp}, ${(ratio * 100).toFixed(1)}%)`;
      if (list.length > THRESHOLDS.missingFatalCount || ratio > THRESHOLDS.missingFatalRatio) fatalDays.push(tag);
      else errDays.push(tag);
    }
    if (fatalDays.length) add("D1", "FATAL", false, `K线覆盖大面积缺失：${fmtList(fatalDays)}`);
    if (errDays.length) add("D2", "ERROR", false, `K线覆盖缺失：${fmtList(errDays)}；示例 ${fmtList(missingRows.slice(0, 10).map((r) => `${r.tradeDate}:${r.stockCode}`))}`);
    if (!fatalDays.length && !errDays.length) add("D1", "INFO", true, "K线覆盖正常");
  }

  // 个股断档：最近 N 个交易日，前后都有 bar 而当日没有（停牌置 volume=0 不在此列，仅提示）
  const tail = dbDates.slice(-THRESHOLDS.gapCheckDays);
  const dsTail = await db.dailyStock.findMany({
    where: { tradeDate: { in: tail } },
    select: { tradeDate: true, stockCode: true },
  });
  const poolTail = await db.$queryRawUnsafe<{ tradeDate: string; stockCode: string }[]>(
    `SELECT tradeDate, stockCode FROM (
       SELECT tradeDate, stockCode FROM LimitUp WHERE tradeDate >= ? AND tradeDate <= ?
       UNION SELECT tradeDate, stockCode FROM BrokenLimit WHERE tradeDate >= ? AND tradeDate <= ?
       UNION SELECT tradeDate, stockCode FROM LimitDown WHERE tradeDate >= ? AND tradeDate <= ?
     )`,
    tail[0], tail[tail.length - 1], tail[0], tail[tail.length - 1], tail[0], tail[tail.length - 1]
  );
  const poolSet = new Set(poolTail.map((r) => `${r.tradeDate}:${r.stockCode}`));
  const byStock = new Map<string, Set<string>>();
  for (const r of dsTail) {
    const s = byStock.get(r.stockCode) ?? new Set<string>();
    s.add(r.tradeDate);
    byStock.set(r.stockCode, s);
  }
  const gaps: string[] = [];
  for (const [code, dates] of byStock) {
    for (let i = 1; i < tail.length - 1; i++) {
      // 只盯池内标的：池外股票当日无 bar 多为停牌，不算数据缺口
      if (!dates.has(tail[i]) && dates.has(tail[i - 1]) && dates.has(tail[i + 1]) && poolSet.has(`${tail[i]}:${code}`)) {
        gaps.push(`${code}@${tail[i]}`);
      }
    }
  }
  add("D3", gaps.length ? "ERROR" : "INFO", gaps.length === 0, gaps.length ? `池内标的断档（前后有 bar 当日缺）：${fmtList(gaps)}` : `最近 ${tail.length} 日池内标的无断档`);
}

try {
  await main();
} catch (e) {
  add("Z0", "FATAL", false, `检查执行异常：${(e as Error).message}`);
} finally {
  const fatal = checks.filter((c) => c.level === "FATAL" && !c.ok).length;
  const error = checks.filter((c) => c.level === "ERROR" && !c.ok).length;
  const warn = checks.filter((c) => c.level === "WARN" && !c.ok).length;
  const pass = checks.filter((c) => c.ok).length;
  const elapsed = Date.now() - startedAt;
  const code = fatal > 0 ? 2 : error > 0 ? 1 : 0;

  const stamp = new Date().toLocaleDateString("sv-SE"); // 本地日期 YYYY-MM-DD
  const report = {
    ranAt: new Date().toISOString(),
    elapsedMs: elapsed,
    window: { start: winStart || null, end: winEnd || null },
    summary: { fatal, error, warn, pass, exitCode: code },
    checks,
  };
  try {
    mkdirSync("logs", { recursive: true });
    writeFileSync(`logs/health-${stamp.replace(/-/g, "")}.json`, JSON.stringify(report, null, 2), "utf8");
  } catch (e) {
    console.error(`[WARN] 写日志失败：${(e as Error).message}`);
  }

  for (const c of checks) {
    if (!c.ok || c.level === "WARN") console.log(`[${c.level}] ${c.id} ${c.detail}`);
  }
  console.log(`\n健康检查：FATAL ${fatal} / ERROR ${error} / WARN ${warn} / 通过 ${pass} | 耗时 ${elapsed}ms | 退出码 ${code}`);
  await db.$disconnect();
  process.exit(code);
}
