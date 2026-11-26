// 手动触发一轮盘中采样（外部 cron 兜底 / 调试用）
// 用法：bun scripts/intraday-poll.ts [--force]
//   常规模式仅在交易采样窗口内执行（与调度器同守卫）
//   --force 跳过时段守卫（测试用，数据仍为当前真实行情）
import { runIntradayPoll } from "../src/lib/collector/intradayPoll";
import { pruneIntraday } from "../src/lib/collector/intradayPoll";

async function main() {
  const force = process.argv.includes("--force");
  const r = await runIntradayPoll({ force });
  console.log(
    `[intraday-poll] ${r.tradeDate} ${r.pollTs} 采样完成：宇宙 ${r.universeCount} 只 · ` +
      `回补基线 ${r.backfillCount} 只 · 事件 ${r.eventsCount} 条 · ${r.durationMs}ms`
  );
  console.log("  事件分布:", JSON.stringify(r.eventsByKind));
  console.log("  上证实时:", r.indexPct ?? "—", "%");
  if (process.argv.includes("--prune")) {
    await pruneIntraday(3);
    console.log("  已清理 3 个交易日前的盘中采样");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[intraday-poll] 失败:", (e as Error).message);
  process.exit(1);
});
