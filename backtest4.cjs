const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const byDate = {};
  bh.forEach(r => { (byDate[r.tradeDate] = byDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(byDate).sort();
  const ds = await p.dailyStock.findMany({ orderBy: { tradeDate: "asc" } });
  const dsByDate = {};
  ds.forEach(r => { (dsByDate[r.tradeDate] = dsByDate[r.tradeDate] || []).push(r); });

  console.log("=== 首阴战法：>=2板龙头首次断板，次日表现 ===");
  let total = 0, win = 0, sumNext = 0;
  const cases = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const today = byDate[dates[i]];
    const nextDs = new Map((dsByDate[dates[i+1]] || []).map(d => [d.stockCode, d]));
    today.filter(r => r.previousBoardCount >= 2 && r.isBreak).forEach(r => {
      const nd = nextDs.get(r.stockCode);
      if (!nd) return;
      total++;
      sumNext += nd.changePct;
      if (nd.changePct > 0) win++;
      cases.push({ date: dates[i], name: r.stockName, board: r.previousBoardCount, nextPct: nd.changePct });
    });
  }
  console.log("样本:", total, "次日红盘率:", total ? (win/total*100).toFixed(1)+"%" : "-", "次日均涨:", total ? (sumNext/total).toFixed(2)+"%" : "-");
  cases.forEach(c => console.log(c.date, c.name, c.board+"板首阴", "次日", c.nextPct.toFixed(2)+"%"));

  // 变体：首阴当天跌幅分层（用当日 DailyStock）
  console.log("\n=== 首阴当日跌幅分层 ===");
  let t1=0,w1=0,s1=0, t2=0,w2=0,s2=0;
  for (let i = 0; i < dates.length - 1; i++) {
    const today = byDate[dates[i]];
    const todayDs = new Map((dsByDate[dates[i]] || []).map(d => [d.stockCode, d]));
    const nextDs = new Map((dsByDate[dates[i+1]] || []).map(d => [d.stockCode, d]));
    today.filter(r => r.previousBoardCount >= 2 && r.isBreak).forEach(r => {
      const td = todayDs.get(r.stockCode);
      const nd = nextDs.get(r.stockCode);
      if (!td || !nd) return;
      if (td.changePct <= -5) { t1++; s1 += nd.changePct; if (nd.changePct > 0) w1++; }
      else { t2++; s2 += nd.changePct; if (nd.changePct > 0) w2++; }
    });
  }
  console.log("首阴日跌>5%:", t1, "次日红盘", w1, "均涨", t1 ? (s1/t1).toFixed(2)+"%" : "-");
  console.log("首阴日跌<=5%:", t2, "次日红盘", w2, "均涨", t2 ? (s2/t2).toFixed(2)+"%" : "-");

  await p.$disconnect();
})();
