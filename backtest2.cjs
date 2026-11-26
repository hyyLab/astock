const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const byDate = {};
  bh.forEach(r => { (byDate[r.tradeDate] = byDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(byDate).sort();

  // 战法1：首板按封板时间分层（早盘 10:30 前 vs 尾盘 14:30 后），次日晋级率
  const lu = await p.limitUp.findMany({ orderBy: { tradeDate: "asc" } });
  const luByDate = {};
  lu.forEach(r => { (luByDate[r.tradeDate] = luByDate[r.tradeDate] || []).push(r); });

  console.log("=== 首板封板时间 vs 次日晋级 ===");
  const buckets = { early: [0,0], mid: [0,0], late: [0,0] };
  for (let i = 0; i < dates.length - 1; i++) {
    const today = luByDate[dates[i]] || [];
    const tMap = new Map((byDate[dates[i+1]] || []).map(r => [r.stockCode, r]));
    today.filter(r => r.boardCount === 1).forEach(r => {
      const t = tMap.get(r.stockCode);
      const promoted = t && t.boardCount === 2;
      const time = (r.firstLimitTime || "").slice(0,5);
      if (!time) return;
      const key = time <= "10:30" ? "early" : time <= "14:30" ? "mid" : "late";
      buckets[key][0] += promoted ? 1 : 0;
      buckets[key][1]++;
    });
  }
  console.log("10:30前:", buckets.early[0] + "/" + buckets.early[1], "=", (buckets.early[0]/buckets.early[1]*100).toFixed(1) + "%");
  console.log("10:30-14:30:", buckets.mid[0] + "/" + buckets.mid[1], "=", (buckets.mid[0]/buckets.mid[1]*100).toFixed(1) + "%");
  console.log("14:30后:", buckets.late[0] + "/" + buckets.late[1], "=", (buckets.late[0]/buckets.late[1]*100).toFixed(1) + "%");

  // 战法2：反包（断板后再涨停）次日表现
  console.log("\n=== 反包股（isRebound）次日表现 ===");
  let rbTotal = 0, rbWin = 0, rbAvg = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const today = luByDate[dates[i]] || [];
    const nextDate = dates[i+1];
    const nextLu = new Set((luByDate[nextDate] || []).map(r => r.stockCode));
    today.filter(r => r.isRebound).forEach(r => {
      rbTotal++;
      if (nextLu.has(r.stockCode)) rbWin++;
    });
  }
  console.log("反包股次日再涨停:", rbWin + "/" + rbTotal, "=", rbTotal ? (rbWin/rbTotal*100).toFixed(1) + "%" : "-");

  // 战法3：爆量（volumeRatio>=2 非涨停）次日表现
  console.log("\n=== 爆量股（量比>=2，非涨停）次日涨跌 ===");
  const vs = await p.volumeSurge.findMany({ orderBy: { tradeDate: "asc" } });
  const vsByDate = {};
  vs.forEach(r => { (vsByDate[r.tradeDate] = vsByDate[r.tradeDate] || []).push(r); });
  let vTotal = 0, vUp = 0, vSum = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const today = (vsByDate[dates[i]] || []).filter(r => !r.isLimitUp);
    const nextDs = await p.dailyStock.findMany({ where: { tradeDate: dates[i+1] } });
    const dsMap = new Map(nextDs.map(d => [d.stockCode, d]));
    today.forEach(r => {
      const d = dsMap.get(r.stockCode);
      if (!d) return;
      vTotal++; vSum += d.changePct;
      if (d.changePct > 0) vUp++;
    });
  }
  console.log("样本:", vTotal, "次日红盘率:", (vUp/vTotal*100).toFixed(1) + "%", "平均涨幅:", (vSum/vTotal).toFixed(2) + "%");

  // 战法4：情绪温度与次日打板收益
  console.log("\n=== 情绪温度分层 vs 昨日涨停今日均涨 ===");
  const sd = await p.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" } });
  const groups = { cold: [], warm: [], hot: [] };
  for (let i = 0; i < sd.length - 1; i++) {
    const t = sd[i].sentimentTemperature;
    const nextAvg = sd[i+1].yesterdayLimitAvg;
    if (nextAvg === null) continue;
    if (t < 40) groups.cold.push(nextAvg);
    else if (t < 60) groups.warm.push(nextAvg);
    else groups.hot.push(nextAvg);
  }
  const avg = a => a.length ? (a.reduce((s,x)=>s+x,0)/a.length).toFixed(2) + "%" : "-";
  console.log("低温(<40)次日打板收益:", avg(groups.cold), "n=" + groups.cold.length);
  console.log("中温(40-60):", avg(groups.warm), "n=" + groups.warm.length);
  console.log("高温(>60):", avg(groups.hot), "n=" + groups.hot.length);

  await p.$disconnect();
})();
