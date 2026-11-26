const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const days = await p.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" } });
  console.log("=== 每日情绪与晋级 ===");
  days.forEach(d => {
    let promos = [];
    try { promos = JSON.parse(d.promotionDetails || "[]"); } catch {}
    const p2 = promos.find(x => x.level === "2板" || x.level === "2连板");
    console.log(d.tradeDate, "温度", d.temperature, "涨停", d.limitUpCount, "最高板", d.highestBoard, "晋级率2板", p2 ? (p2.rate*100).toFixed(0)+"%" : "-");
  });

  // 连板晋级率回测：今天 N 板，明天晋级 N+1 的比例
  const bh = await p.boardHistory.findMany({ orderBy: { tradeDate: "asc" } });
  const byDate = {};
  bh.forEach(r => { (byDate[r.tradeDate] = byDate[r.tradeDate] || []).push(r); });
  const dates = Object.keys(byDate).sort();
  console.log("\n=== 连板晋级率（按板数） ===");
  for (let b = 1; b <= 4; b++) {
    let total = 0, promoted = 0;
    for (let i = 0; i < dates.length - 1; i++) {
      const today = byDate[dates[i]], tomorrow = byDate[dates[i+1]];
      const tMap = new Map(tomorrow.map(r => [r.stockCode, r]));
      today.filter(r => r.boardCount === b).forEach(r => {
        total++;
        const t = tMap.get(r.stockCode);
        if (t && t.boardCount === b + 1) promoted++;
      });
    }
    console.log(`${b}板->${b+1}板: ${promoted}/${total} = ${total ? (promoted/total*100).toFixed(1) : 0}%`);
  }

  // 昨日涨停今日表现
  console.log("\n=== 昨日涨停今日平均涨幅 ===");
  for (let i = 0; i < dates.length - 1; i++) {
    const d = days.find(x => x.tradeDate === dates[i+1]);
    if (d && d.yesterdayLimitAvg !== null) console.log(dates[i+1], "昨涨停今均涨", d.yesterdayLimitAvg.toFixed(2) + "%", "红盘", d.yesterdayRedCount + "/" + d.yesterdayCount);
  }
  await p.$disconnect();
})();
