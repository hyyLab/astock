const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const ds = await p.dailyStock.findMany({ orderBy: [{ stockCode: "asc" }, { tradeDate: "asc" }] });
  const byStock = {};
  ds.forEach(r => { (byStock[r.stockCode] = byStock[r.stockCode] || []).push(r); });
  const dates = [...new Set(ds.map(r => r.tradeDate))].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  // ============ 战法A：资金回流转强 ============
  // 条件：近20日内有过放量日(volumeRatio>=2)；随后回调（从20日高点回撤5%~18%）；
  //       回调期间缩量；今日再次放量(volumeRatio>=1.6)且收涨
  let aTotal = 0, aWin1 = 0, aSum1 = 0, aWin5 = 0, aSum5 = 0, n5 = 0;
  const aCases = [];
  for (const code of Object.keys(byStock)) {
    const rows = byStock[code];
    if (rows.length < 25) continue;
    for (let i = 20; i < rows.length - 1; i++) {
      const today = rows[i];
      const win = rows.slice(i - 20, i + 1);
      const hi = Math.max(...win.map(r => r.high));
      const activeDays = win.filter(r => (r.volumeRatio || 0) >= 2).length;
      if (activeDays < 2) continue;                    // 前期有过资金活跃
      const drawdown = (today.close / hi - 1) * 100;
      if (drawdown > -4 || drawdown < -18) continue;   // 回调 4%~18%，没跌破位
      const mid = rows.slice(Math.max(0, i - 6), i);   // 回调段
      if (mid.length >= 3 && mid.some(r => (r.volumeRatio || 0) >= 2)) continue; // 回调段不该再爆量
      if ((today.volumeRatio || 0) < 1.6) continue;    // 今日再次放量
      if (today.changePct <= 0) continue;              // 今日收涨
      const next = rows[i + 1];
      aTotal++; aSum1 += next.changePct; if (next.changePct > 0) aWin1++;
      const n5r = rows[i + 5];
      if (n5r) { n5++; aSum5 += (n5r.close / today.close - 1) * 100; if (n5r.close > today.close) aWin5++; }
      aCases.push({ date: today.tradeDate, name: rows[0].stockName, code, dd: drawdown.toFixed(1), vr: today.volumeRatio?.toFixed(1), next: next.changePct });
    }
  }
  console.log("=== 战法A 资金回流转强 ===");
  console.log("样本:", aTotal, "次日红盘:", aTotal ? (aWin1 / aTotal * 100).toFixed(1) + "%" : "-", "次日均涨:", (aTotal ? (aSum1 / aTotal).toFixed(2) : "-") + "%", "5日均:", (n5 ? (aSum5 / n5).toFixed(2) : "-") + "%", "5日红盘:", (n5 ? (aWin5 / n5 * 100).toFixed(1) : "-") + "%");
  aCases.slice(-12).forEach(c => console.log(c.date, c.name, "回撤" + c.dd + "%", "量比" + c.vr, "次日", c.next.toFixed(2) + "%"));

  // ============ 战法B：20日涨幅 10%~30% 选股 ============
  let bTotal = 0, bWin5 = 0, bSum5 = 0, bWin10 = 0, bSum10 = 0, n10 = 0;
  const buckets = {};
  for (const code of Object.keys(byStock)) {
    const rows = byStock[code];
    if (rows.length < 31) continue;
    for (let i = 20; i < rows.length - 1; i++) {
      const today = rows[i];
      const chg20 = (today.close / rows[i - 20].close - 1) * 100;
      if (chg20 < 10 || chg20 > 30) continue;
      const key = chg20 < 20 ? "10-20%" : "20-30%";
      const n5r = rows[i + 5], n10r = rows[i + 10];
      if (!n5r) continue;
      const ret5 = (n5r.close / today.close - 1) * 100;
      bTotal++; bSum5 += ret5; if (ret5 > 0) bWin5++;
      buckets[key] = buckets[key] || { t: 0, w: 0, s: 0 };
      buckets[key].t++; buckets[key].s += ret5; if (ret5 > 0) buckets[key].w++;
      if (n10r) { n10++; const ret10 = (n10r.close / today.close - 1) * 100; bSum10 += ret10; if (ret10 > 0) bWin10++; }
    }
  }
  console.log("\n=== 战法B 20日涨幅10-30% ===");
  console.log("样本:", bTotal, "5日红盘:", (bWin5 / bTotal * 100).toFixed(1) + "%", "5日均:", (bSum5 / bTotal).toFixed(2) + "%", "10日均:", (n10 ? (bSum10 / n10).toFixed(2) : "-") + "%", "10日红盘:", (n10 ? (bWin10 / n10 * 100).toFixed(1) : "-") + "%");
  Object.entries(buckets).forEach(([k, v]) => console.log(k, "样本", v.t, "5日红盘", (v.w / v.t * 100).toFixed(1) + "%", "均", (v.s / v.t).toFixed(2) + "%"));

  await p.$disconnect();
})();
