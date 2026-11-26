const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const sd = await p.sentimentDaily.findMany({ orderBy: { tradeDate: "desc" }, take: 5 });
  console.log("sentimentDaily latest:", JSON.stringify(sd.map((x) => ({ d: x.tradeDate, t: x.sentimentTemperature, s: x.sentimentStage }))));
  const cnt = await p.sentimentDaily.count();
  console.log("sentimentDaily count:", cnt);
  const dm = await p.dailyMarket.findMany({ orderBy: { tradeDate: "desc" }, take: 3 });
  console.log("dailyMarket latest:", JSON.stringify(dm.map((x) => x.tradeDate)));
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "desc" }, take: 1 });
  console.log("boardHistory latest:", JSON.stringify(bh.map((x) => x.tradeDate)));
  const lu = await p.limitUp.findMany({ orderBy: { tradeDate: "desc" }, take: 1 });
  console.log("limitUp latest:", JSON.stringify(lu.map((x) => x.tradeDate)));
  const log = await p.collectLog.findMany({ orderBy: { id: "desc" }, take: 3 });
  console.log("collectLog:", JSON.stringify(log.map((x) => ({ id: x.id, d: x.tradeDates, status: x.status, at: x.createdAt }))));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
