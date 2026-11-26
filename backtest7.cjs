const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const bhByDate = {};
  bh.forEach(r => { (bhByDate[r.tradeDate] = bhByDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(bhByDate).sort();
  const ds = await p.dailyStock.findMany({ orderBy: { tradeDate: "asc" } });
  const dsByDate = {};
  ds.forEach(r => { (dsByDate[r.tradeDate] = dsByDate[r.tradeDate] || []).push(r); });

  // 首阴日收盘买入（用当日 close），持有 1 天 / 3 天
  let t1=0,w1=0,s1=0, t3=0,w3=0,s3=0;
  const cases = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const day = dates[i];
    const breaks = (bhByDate[day] || []).filter(r => r.previousBoardCount >= 2 && r.isBreak);
    const dayDs = new Map((dsByDate[day] || []).map(d => [d.stockCode, d]));
    breaks.forEach(b => {
      const td = dayDs.get(b.stockCode);
      if (!td) return;
      const buy = td.close;
      // 次日
      const nd1 = (dsByDate[dates[i+1]] || []).find(d => d.stockCode === b.stockCode);
      if (nd1) { t1++; s1 += (nd1.close/buy-1)*100; if (nd1.close > buy) w1++; }
      // 3日后
      if (i + 3 < dates.length) {
        const nd3 = (dsByDate[dates[i+3]] || []).find(d => d.stockCode === b.stockCode);
        if (nd3) { t3++; s3 += (nd3.close/buy-1)*100; if (nd3.close > buy) w3++; }
      }
      cases.push({ date: day, name: b.stockName, board: b.previousBoardCount, buy, next1: nd1?.close, next3: null });
    });
  }
  console.log("首阴日收盘买入:", t1, "次日红盘", w1, "=", t1 ? (w1/t1*100).toFixed(1)+"%" : "-", "均收益", t1 ? (s1/t1).toFixed(2)+"%" : "-");
  console.log("持有3日:", t3, "红盘", w3, "=", t3 ? (w3/t3*100).toFixed(1)+"%" : "-", "均收益", t3 ? (s3/t3).toFixed(2)+"%" : "-");

  await p.$disconnect();
})();
