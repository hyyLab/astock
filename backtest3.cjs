const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  // BoardHistory: isBreak = 昨日涨停今日未涨停 => 断板
  // 首阴 = 连板股（boardCount>=2）断板那天
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const byDate = {};
  bh.forEach(r => { (byDate[r.tradeDate] = byDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(byDate).sort();

  // 需要每日收盘价判断阴线：用 DailyStock（只有涨停股 493 条/天，够用）
  const ds = await p.dailyStock.findMany({ orderBy: { tradeDate: "asc" } });
  const dsByDate = {};
  ds.forEach(r => { (dsByDate[r.tradeDate] = dsByDate[r.tradeDate] || []).push(r); });

  console.log("=== 首阴战法：连板股(>=2板)首次断板（收阴），次日表现 ===");
  let total = 0, win = 0, sumNext = 0, sumNext2 = 0, n2 = 0;
  const cases = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const today = byDate[dates[i]];
    const nextDate = dates[i+1];
    const nextDs = new Map((dsByDate[nextDate] || []).map(d => [d.stockCode, d]));
    // 再下一天
    const next2Date = dates[i+2];
    const next2Ds = next2Date ? new Map((dsByDate[next2Date] || []).map(d => [d.stockCode, d])) : null;
    today.filter(r => r.boardCount >= 2 && r.isBreak).forEach(r => {
      const nd = nextDs.get(r.stockCode);
      if (!nd) return;
      total++;
      sumNext += nd.changePct;
      if (nd.changePct > 0) win++;
      let n2pct = null;
      if (next2Ds) {
        const nd2 = next2Ds.get(r.stockCode);
        if (nd2) { n2pct = nd2.changePct; sumNext2 += nd2.changePct; n2++; }
      }
      cases.push({ date: dates[i], code: r.stockCode, name: r.stockName, board: r.boardCount, nextPct: nd.changePct, next2Pct: n2pct });
    });
  }
  console.log("样本:", total, "次日红盘率:", total ? (win/total*100).toFixed(1)+"%" : "-", "次日均涨:", total ? (sumNext/total).toFixed(2)+"%" : "-", "后日均涨:", n2 ? (sumNext2/n2).toFixed(2)+"%" : "-");
  cases.forEach(c => console.log(c.date, c.name, c.board+"板断板", "次日", c.nextPct.toFixed(2)+"%", c.next2Pct !== null ? "后日 "+c.next2Pct.toFixed(2)+"%" : ""));

  // 变体：断板当天收阴（跌>2%）的更弱还是更强？
  console.log("\n=== 首阴当天跌幅分层 ===");
  const deep = cases.filter(c => c.nextPct !== null); // 用断板日跌幅需要当日数据
  // 用 DailyStock 当日数据
  let t1=0,w1=0,s1=0, t2=0,w2=0,s2=0;
  for (let i = 0; i < dates.length - 1; i++) {
    const today = byDate[dates[i]];
    const todayDs = new Map((dsByDate[dates[i]] || []).map(d => [d.stockCode, d]));
    const nextDs = new Map((dsByDate[dates[i+1]] || []).map(d => [d.stockCode, d]));
    today.filter(r => r.boardCount >= 2 && r.isBreak).forEach(r => {
      const td = todayDs.get(r.stockCode);
      const nd = nextDs.get(r.stockCode);
      if (!td || !nd) return;
      if (td.changePct <= -5) { t1++; s1 += nd.changePct; if (nd.changePct > 0) w1++; }
      else { t2++; s2 += nd.changePct; if (nd.changePct > 0) w2++; }
    });
  }
  console.log("断板日跌>5%:", t1, "次日红盘", w1, "均涨", t1 ? (s1/t1).toFixed(2)+"%" : "-");
  console.log("断板日跌<=5%:", t2, "次日红盘", w2, "均涨", t2 ? (s2/t2).toFixed(2)+"%" : "-");

  await p.$disconnect();
})();
