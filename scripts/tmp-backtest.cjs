const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const sd = await p.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" } });
  const bh = await p.boardHistory.findMany();
  const ds = await p.dailyStock.findMany({ select: { tradeDate: true, stockCode: true, changePct: true } });
  const dsMap = new Map();
  for (const r of ds) dsMap.set(r.tradeDate + ":" + r.stockCode, r.changePct);
  const dates = sd.map((d) => d.tradeDate);
  const tempBy = new Map(sd.map((d) => [d.tradeDate, d.sentimentTemperature]));
  let trades = 0, wins = 0, totalPct = 0;
  const byDay = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const d = dates[i], next = dates[i + 1];
    const t = tempBy.get(d) ?? 0;
    if (t < 60) continue;
    const highs = bh.filter((r) => r.tradeDate === d && r.boardCount >= 3 && !r.isBreak);
    if (!highs.length) continue;
    let dayPct = 0, n = 0, w = 0;
    for (const h of highs) {
      const pct = dsMap.get(next + ":" + h.stockCode);
      if (pct == null) continue;
      dayPct += pct; n++;
      if (pct > 0) w++;
    }
    if (!n) continue;
    trades += n; wins += w; totalPct += dayPct;
    byDay.push({ d, t, n, avg: (dayPct / n).toFixed(2), win: w + "/" + n });
  }
  console.log("=== 战法回测：情绪>=60° 买 3 板以上高位票，次日表现 ===");
  console.log("样本: " + trades + " 笔, 胜率 " + (wins / trades * 100).toFixed(1) + "%, 平均次日收益 " + (totalPct / trades).toFixed(2) + "%");
  console.log("逐日明细:");
  byDay.forEach((r) => console.log(r.d + " 情绪" + r.t + "° " + r.win + " 平均 " + r.avg + "%"));
  let t2 = 0, w2 = 0, s2 = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const d = dates[i], next = dates[i + 1];
    const t = tempBy.get(d) ?? 0;
    if (t >= 60) continue;
    const highs = bh.filter((r) => r.tradeDate === d && r.boardCount >= 3 && !r.isBreak);
    for (const h of highs) {
      const pct = dsMap.get(next + ":" + h.stockCode);
      if (pct == null) continue;
      t2++; if (pct > 0) w2++; s2 += pct;
    }
  }
  if (t2) console.log("对照（情绪<60° 买高位票）: " + t2 + " 笔, 胜率 " + (w2 / t2 * 100).toFixed(1) + "%, 平均 " + (s2 / t2).toFixed(2) + "%");
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
