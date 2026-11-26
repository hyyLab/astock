// 数据质量抽查
import { db } from "../src/lib/db";

const d = "2026-09-24";

const top = await db.limitUp.findMany({
  where: { tradeDate: d },
  orderBy: { boardCount: "desc" },
  take: 8,
});
console.log("=== 连板天梯 TOP8 ===");
for (const r of top) {
  console.log(
    `${r.boardCount}板 | ${r.stockName} ${r.stockCode} | ${r.industry} | 首封 ${r.firstLimitTime} | 几天几板 ${r.daysAndBoards} | 成交额 ${(Number(r.amount) / 1e8).toFixed(1)}亿 | 晋级=${r.isPromotion} 反包=${r.isRebound}`
  );
}

const star = top[0]?.stockCode;
if (star) {
  const chain = await db.boardHistory.findMany({
    where: { stockCode: star },
    orderBy: { tradeDate: "asc" },
  });
  console.log(`\n=== ${top[0].stockName} 连板链路（可追溯）===`);
  for (const c of chain) console.log(`${c.tradeDate} | ${c.boardCount}板 (昨日${c.previousBoardCount}) 晋级=${c.isPromotion} 断板=${c.isBreak}`);
}

const concepts = await db.dailyConcept.findMany({
  where: { tradeDate: d },
  orderBy: { strengthScore: "desc" },
  take: 6,
});
console.log("\n=== 主线题材 TOP6 ===");
for (const c of concepts)
  console.log(
    `${c.conceptName} | 涨停${c.limitUpCount} 连板${c.boardCount} 最高${c.highestBoard}板 | 龙头:${c.leaderName} | 强度${c.strengthScore}`
  );

const sent = await db.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" } });
console.log("\n=== 情绪序列 ===");
for (const s of sent)
  console.log(
    `${s.tradeDate} | 涨停${s.limitUpCount} 炸板${s.brokenLimitCount} 封板率${(s.sealRate * 100).toFixed(0)}% 最高${s.highestBoard}板 | 温度${s.sentimentTemperature}(${s.sentimentStage}) | 昨涨停均涨${s.yesterdayLimitAvg ?? "—"}`
  );

const promos = sent.find((s) => s.tradeDate === d)?.promotionDetails;
console.log("\n=== 晋级率明细（当日）===");
console.log(
  (promos ? JSON.parse(promos) : []).map((p: { level: string; rate: number; promoted: number; total: number }) => `${p.level}: ${p.promoted}/${p.total} = ${(p.rate * 100).toFixed(0)}%`).join(" | ")
);

await db.$disconnect();
process.exit(0);
