// ============================================================
// 每日采集入口（对应方案中的 python collect_daily.py）
// 用法：bun scripts/collect-daily.ts [--days 10]
// 完成后输出方案第三十步要求的验收清单
// ============================================================

import { runCollection } from "../src/lib/collector/collect";
import { db, ensureSqlitePragmas, recreatePrismaClient } from "../src/lib/db";

const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 10 : 10;

const RETRY_DELAYS = [3000, 8000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryable(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "P1008" || /database is locked|Socket timeout/i.test(err?.message ?? "");
}

console.log(`=== 连板复盘 · 每日采集（回补 ${days} 个交易日）===\n`);

let exitCode = 0;
try {
  await ensureSqlitePragmas();
  let s!: Awaited<ReturnType<typeof runCollection>>;
  for (let attempt = 0; ; attempt++) {
    try {
      s = await runCollection({ backfillDays: days });
      break;
    } catch (e) {
      if (attempt >= 2 || !isRetryable(e)) throw e;
      console.warn(
        `\n[采集重试] 第 ${attempt + 1} 次失败（${(e as Error).message}），${RETRY_DELAYS[attempt] / 1000}s 后重建 client 重试 ...`
      );
      await sleep(RETRY_DELAYS[attempt]);
      await recreatePrismaClient();
    }
  }
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n=== 采集完成，耗时 ${(s.durationMs / 1000).toFixed(1)}s ===`);
  console.log(`
───── 验收清单（${s.latestDate}）─────
涨停：${s.limitUpCount} 只
炸板：${s.brokenCount} 只
跌停：${s.limitDownCount} 只
最高板：${s.highestBoard} 板
连板：${s.lianbanCount} 只
首板：${s.firstBoardCount} 只
成交额：${s.totalAmountYi} 亿元
上涨：${s.upCount} 只
下跌：${s.downCount} 只
封板率：${pct(s.sealRate)}
情绪温度：${s.temperature}（${s.stage}）
连板数交叉验证不一致：${s.boardMismatch} 条（以自主计算为准）
个股新闻证据：覆盖 ${s.evidenceStocks} 只 · 抓取 ${s.stockNewsFetched} 条 / 新增入库 ${s.stockNewsCount} 条 · 新增归属 ${s.themeMerged} 处
覆盖交易日：${s.tradeDates.join(", ")}
`);
} catch (e) {
  console.error("\n[采集失败]", (e as Error).message, "\n", (e as Error).stack);
  exitCode = 1;
} finally {
  try {
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (e) {
    console.warn("[WAL checkpoint 失败]", (e as Error).message);
  }
}
process.exit(exitCode);
