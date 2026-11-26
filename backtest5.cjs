const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const byDate = {};
  bh.forEach(r => { (byDate[r.tradeDate] = byDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(byDate).sort();

  // 首阴后：次日反包（再涨停）的概率 + 反包后一天的收益
  // isRebound = 前日涨停、昨日断板、今日再涨停
  let first = 0, rebound = 0;
  for (let i = 1; i < dates.length; i++) {
    const today = byDate[dates[i]];
    const prev = byDate[dates[i-1]];
    const prevBreak = new Set(prev.filter(r => r.previousBoardCount >= 2 && r.isBreak).map(r => r.stockCode));
    today.filter(r => prevBreak.has(r.stockCode)).forEach(r => {
      first++;
      if (r.isRebound) rebound++;
    });
  }
  console.log("首阴(>=2板)后次日反包:", rebound + "/" + first, "=", first ? (rebound/first*100).toFixed(1) + "%" : "-");

  // 反包日买入，再下一天的表现
  const ds = await p.dailyStock.findMany({ orderBy: { tradeDate: "asc" } });
  const dsByDate = {};
  ds.forEach(r => { (dsByDate[r.tradeDate] = dsByDate[r.tradeDate] || []).push(r); });
  let t = 0, w = 0, s = 0;
  for (let i = 1; i < dates.length - 1; i++) {
    const prev = byDate[dates[i-1]];
    const today = byDate[dates[i]];
    const nextDs = new Map((dsByDate[dates[i+1]] || []).map(d => [d.stockCode, d]));
    const prevBreak = new Set(prev.filter(r => r.previousBoardCount >= 2 && r.isBreak).map(r => r.stockCode));
    today.filter(r => prevBreak.has(r.stockCode) && r.isRebound).forEach(r => {
      const nd = nextDs.get(r.stockCode);
      if (!nd) return;
      t++; s += nd.changePct;
      if (nd.changePct > 0) w++;
    });
  }
  console.log("反包日买入次日:", t, "红盘", w, "均涨", t ? (s/t).toFixed(2)+"%" : "-");

  await p.$disconnect();
})();
