const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const ds = await p.dailyStock.findMany({ orderBy: [{ stockCode: "asc" }, { tradeDate: "asc" }] });
  const byStock = {};
  ds.forEach(r => { (byStock[r.stockCode] = byStock[r.stockCode] || []).push(r); });
  const dates = [...new Set(ds.map(r => r.tradeDate))].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  // ============ 战法A：资金回流转强（严格版） ============
  // 1) 近20日内有>=2天放量(volumeRatio>=2)  2) 从20日高点回撤4%~18%（没跌破位）
  // 3) 回调段（最近5日）无爆量日  4) 今日量比>=1.8 且收阳（close>open）
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
      if (activeDays < 2) continue;
      const drawdown = (today.close / hi - 1) * 100;
      if (drawdown > -4 || drawdown < -18) continue;
      const mid = rows.slice(Math.max(0, i - 4), i);
      if (mid.length >= 3 && mid.some(r => (r.volumeRatio || 0) >= 2)) continue;
      if ((today.volumeRatio || 0) < 1.8) continue;
      if (today.close <= today.open) continue;
      const next = rows[i + 1];
      aTotal++; aSum1 += next.changePct; if (next.changePct > 0) aWin1++;
      const n5r = rows[i + 5];
      if (n5r) { n5++; aSum5 += (n5r.close / today.close - 1) * 100; if (n5r.close > today.close) aWin5++; }
      aCases.push({ date: today.tradeDate, name: rows[0].stockName, code, dd: drawdown.toFixed(1), vr: today.volumeRatio?.toFixed(1), next: next.changePct });
    }
  }
  console.log("=== 战法A 资金回流转强（严格版） ===");
  console.log("样本:", aTotal, "次日红盘:", aTotal ? (aWin1 / aTotal * 100).toFixed(1) + "%" : "-", "次日均涨:", (aTotal ? (aSum1 / aTotal).toFixed(2) : "-") + "%", "5日均:", (n5 ? (aSum5 / n5).toFixed(2) : "-") + "%", "5日红盘:", (n5 ? (aWin5 / n5 * 100).toFixed(1) : "-") + "%");
  aCases.slice(-15).forEach(c => console.log(c.date, c.name, "回撤" + c.dd + "%", "量比" + c.vr, "次日", c.next.toFixed(2) + "%"));

  // ============ 战法B：20日涨幅 10%~30% + 题材加持 ============
  const sc = await p.stockConcept.findMany({ include: { concept: true } });
  const conceptsByStock = {};
  sc.forEach(r => { (conceptsByStock[r.stockCode] = conceptsByStock[r.stockCode] || []).push(r.concept.conceptName); });

  let bTotal = 0, bWin5 = 0, bSum5 = 0, bWin10 = 0, bSum10 = 0, n10 = 0;
  const buckets = {};
  const bCases = [];
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
      // 题材加持：有 >=2 个概念
      const nc = (conceptsByStock[code] || []).length;
      const themeKey = nc >= 2 ? "有题材" : "无题材";
      buckets[themeKey] = buckets[themeKey] || { t: 0, w: 0, s: 0 };
      buckets[themeKey].t++; buckets[themeKey].s += ret5; if (ret5 > 0) buckets[themeKey].w++;
      if (i === rows.length - 2) bCases.push({ code, name: rows[0].stockName, chg20: chg20.toFixed(1), themes: (conceptsByStock[code] || []).slice(0, 3).join("/") });
    }
  }
  console.log("\n=== 战法B 20日涨幅10-30% ===");
  console.log("样本:", bTotal, "5日红盘:", (bWin5 / bTotal * 100).toFixed(1) + "%", "5日均:", (bSum5 / bTotal).toFixed(2) + "%", "10日均:", (n10 ? (bSum10 / n10).toFixed(2) : "-") + "%", "10日红盘:", (n10 ? (bWin10 / n10 * 100).toFixed(1) : "-") + "%");
  Object.entries(buckets).forEach(([k, v]) => console.log(k, "样本", v.t, "5日红盘", (v.w / v.t * 100).toFixed(1) + "%", "均", (v.s / v.t).toFixed(2) + "%"));

  // ============ 今日最新信号（两个战法的当前标的） ============
  console.log("\n=== 今日（2026-11-24）战法A信号 ===");
  const today = "2026-11-24";
  const todayRows = ds.filter(r => r.tradeDate === today);
  const signals = [];
  for (const r of todayRows) {
    const rows = byStock[r.stockCode];
    if (rows.length < 25) continue;
    const idx = rows.findIndex(x => x.tradeDate === today);
    if (idx < 20) continue;
    const win = rows.slice(idx - 20, idx + 1);
    const hi = Math.max(...win.map(x => x.high));
    const activeDays = win.filter(x => (x.volumeRatio || 0) >= 2).length;
    if (activeDays < 2) continue;
    const drawdown = (r.close / hi - 1) * 100;
    if (drawdown > -4 || drawdown < -18) continue;
    const mid = rows.slice(Math.max(0, idx - 4), idx);
    if (mid.length >= 3 && mid.some(x => (x.volumeRatio || 0) >= 2)) continue;
    if ((r.volumeRatio || 0) < 1.8) continue;
    if (r.close <= r.open) continue;
    signals.push({ name: r.stockName, code: r.stockCode, dd: drawdown.toFixed(1), vr: r.volumeRatio?.toFixed(1), chg: r.changePct.toFixed(2) });
  }
  signals.forEach(s => console.log(s.name, s.code, "回撤" + s.dd + "%", "量比" + s.vr, "今日" + s.chg + "%"));
  if (!signals.length) console.log("（今日无信号）");

  console.log("\n=== 今日（2026-11-24）战法B信号（20日涨幅10-30%） ===");
  const bSignals = [];
  for (const r of todayRows) {
    const rows = byStock[r.stockCode];
    if (rows.length < 31) continue;
    const idx = rows.findIndex(x => x.tradeDate === today);
    if (idx < 20) continue;
    const chg20 = (r.close / rows[idx - 20].close - 1) * 100;
    if (chg20 < 10 || chg20 > 30) continue;
    bSignals.push({ name: r.stockName, code: r.stockCode, chg20: chg20.toFixed(1), chg: r.changePct.toFixed(2), themes: (conceptsByStock[r.stockCode] || []).slice(0, 3).join("/") });
  }
  bSignals.sort((a, b) => b.chg20 - a.chg20).forEach(s => console.log(s.name, s.code, "20日涨幅" + s.chg20 + "%", "今日" + s.chg + "%", s.themes));
  if (!bSignals.length) console.log("（今日无信号）");

  await p.$disconnect();
})();
