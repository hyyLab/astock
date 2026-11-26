const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const ds = await p.dailyStock.findMany({ orderBy: [{ stockCode: "asc" }, { tradeDate: "asc" }] });
  const byStock = {};
  ds.forEach(r => { (byStock[r.stockCode] = byStock[r.stockCode] || []).push(r); });

  // 战法B：20日涨幅10-30%，持有10天/20天
  const groups = {
    "10-20%": { t10: 0, w10: 0, s10: 0, t20: 0, w20: 0, s20: 0 },
    "20-30%": { t10: 0, w10: 0, s10: 0, t20: 0, w20: 0, s20: 0 },
  };
  let all = { t10: 0, w10: 0, s10: 0, t20: 0, w20: 0, s20: 0 };
  for (const code of Object.keys(byStock)) {
    const rows = byStock[code];
    if (rows.length < 41) continue;
    for (let i = 20; i < rows.length - 20; i++) {
      const today = rows[i];
      const chg20 = (today.close / rows[i - 20].close - 1) * 100;
      if (chg20 < 10 || chg20 > 30) continue;
      const key = chg20 < 20 ? "10-20%" : "20-30%";
      const r10 = rows[i + 10], r20 = rows[i + 20];
      if (r10) { const ret = (r10.close / today.close - 1) * 100; groups[key].t10++; groups[key].s10 += ret; if (ret > 0) groups[key].w10++; all.t10++; all.s10 += ret; if (ret > 0) all.w10++; }
      if (r20) { const ret = (r20.close / today.close - 1) * 100; groups[key].t20++; groups[key].s20 += ret; if (ret > 0) groups[key].w20++; all.t20++; all.s20 += ret; if (ret > 0) all.w20++; }
    }
  }
  console.log("=== 战法B 20日涨幅10-30%，趋势持有 ===");
  console.log("全部: 10日 样本", all.t10, "红盘", (all.w10 / all.t10 * 100).toFixed(1) + "%", "均", (all.s10 / all.t10).toFixed(2) + "%", "| 20日 样本", all.t20, "红盘", (all.w20 / all.t20 * 100).toFixed(1) + "%", "均", (all.s20 / all.t20).toFixed(2) + "%");
  Object.entries(groups).forEach(([k, v]) => {
    console.log(k + ": 10日 样本", v.t10, "红盘", (v.w10 / v.t10 * 100).toFixed(1) + "%", "均", (v.s10 / v.t10).toFixed(2) + "%", "| 20日 样本", v.t20, "红盘", (v.w20 / v.t20 * 100).toFixed(1) + "%", "均", (v.s20 / v.t20).toFixed(2) + "%");
  });

  // 对照组：20日涨幅其他区间
  const ctrl = { "<0%": { t: 0, w: 0, s: 0 }, "0-10%": { t: 0, w: 0, s: 0 }, "30-50%": { t: 0, w: 0, s: 0 }, ">50%": { t: 0, w: 0, s: 0 } };
  for (const code of Object.keys(byStock)) {
    const rows = byStock[code];
    if (rows.length < 31) continue;
    for (let i = 20; i < rows.length - 11; i++) {
      const today = rows[i];
      const chg20 = (today.close / rows[i - 20].close - 1) * 100;
      const r10 = rows[i + 10];
      if (!r10) continue;
      const ret = (r10.close / today.close - 1) * 100;
      let key = null;
      if (chg20 < 0) key = "<0%";
      else if (chg20 < 10) key = "0-10%";
      else if (chg20 < 30) key = null; // 战法组，上面算过
      else if (chg20 < 50) key = "30-50%";
      else key = ">50%";
      if (!key) continue;
      ctrl[key].t++; ctrl[key].s += ret; if (ret > 0) ctrl[key].w++;
    }
  }
  console.log("\n=== 对照组（同样持有10日） ===");
  Object.entries(ctrl).forEach(([k, v]) => { if (v.t > 0) console.log("20日涨幅" + k, "样本", v.t, "红盘", (v.w / v.t * 100).toFixed(1) + "%", "均", (v.s / v.t).toFixed(2) + "%"); });

  await p.$disconnect();
})();
