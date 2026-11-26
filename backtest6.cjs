const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  // LimitUp.isRebound: 断板后再涨停（当天在涨停池里且是反包）
  const lu = await p.limitUp.findMany({ orderBy: { tradeDate: "asc" } });
  const luByDate = {};
  lu.forEach(r => { (luByDate[r.tradeDate] = luByDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(luByDate).sort();

  // 首阴（>=2板断板）后 1~3 天内反包的概率
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const bhByDate = {};
  bh.forEach(r => { (bhByDate[r.tradeDate] = bhByDate[r.tradeDate] || []).push(r); });

  let total = 0, reboundIn1 = 0, reboundIn3 = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const breakDay = dates[i];
    const breaks = (bhByDate[breakDay] || []).filter(r => r.previousBoardCount >= 2 && r.isBreak);
    breaks.forEach(b => {
      total++;
      // 次日是否涨停（反包）
      const next1 = (luByDate[dates[i+1]] || []).find(x => x.stockCode === b.stockCode);
      if (next1) reboundIn1++;
      // 3天内
      for (let j = 1; j <= 3 && i + j < dates.length; j++) {
        const nx = (luByDate[dates[i+j]] || []).find(x => x.stockCode === b.stockCode);
        if (nx) { reboundIn3++; break; }
      }
    });
  }
  console.log("首阴样本:", total);
  console.log("次日反包:", reboundIn1, "=", total ? (reboundIn1/total*100).toFixed(1)+"%" : "-");
  console.log("3日内反包:", reboundIn3, "=", total ? (reboundIn3/total*100).toFixed(1)+"%" : "-");

  await p.$disconnect();
})();
