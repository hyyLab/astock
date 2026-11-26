// 验证：①炒作类型归类（海峡创新→福建概念 / 大亚圣象→PCB概念）②盘中同步启动聚类
import { matchThemes } from "../src/lib/calc/themeRules";
import { buildSyncClusters } from "../src/lib/calc/syncLaunch";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("=== ① 炒作类型归类验证 ===");
  const cases: [string, string | null, string[]][] = [
    ["海峡创新", "IT服务Ⅱ", ["福建概念"]],
    ["大亚圣象", "家居用品", ["PCB概念"]],
    ["平潭发展", "林业Ⅱ", ["福建概念"]],
    ["合富中国", "医疗服务", ["福建概念"]],
    ["鹭燕医药", null, ["福建概念"]],
    ["沪电股份", "元件", ["PCB概念"]], // PCB 真龙头按行业也能命中
    ["生益股份", "元件", ["PCB概念"]],
    ["中芯国际", "半导体", ["半导体"]],
  ];
  let pass = 0;
  for (const [name, ind, expected] of cases) {
    const got = matchThemes(name, ind);
    const ok = expected.every((e) => got.includes(e));
    if (ok) pass++;
    console.log(`${ok ? "✓" : "✗"} ${name}(${ind}) → [${got.join(", ")}] 期望含 [${expected.join(", ")}]`);
  }
  console.log(`${pass}/${cases.length} 通过`);

  console.log("\n=== ② 最新交易日同步启动聚类 ===");
  const lastLU = await db.limitUp.findMany({
    orderBy: { tradeDate: "desc" },
    take: 200,
  });
  const lastDate = lastLU[0]?.tradeDate;
  const dayRows = lastLU.filter((r) => r.tradeDate === lastDate);
  console.log(`交易日 ${lastDate} 涨停 ${dayRows.length} 只`);
  const clusters = buildSyncClusters(
    dayRows.map((r) => ({
      stockCode: r.stockCode,
      stockName: r.stockName,
      boardCount: r.boardCount,
      industry: r.industry,
      themes: r.themes,
      firstLimitTime: r.firstLimitTime,
    }))
  );
  for (const c of clusters) {
    console.log(
      `\n[${c.windowLabel}] ${c.phaseLabel} ${c.stocks.length}股 ${c.isCandidate ? "★候选新题材" : `佐证:${c.sharedThemes.join("/")}`}`
    );
    console.log("   " + c.stocks.map((s) => `${s.firstLimitTime.slice(0, 5)} ${s.stockName}(${s.industry ?? "?"})${s.boardCount > 1 ? `${s.boardCount}板` : ""}`).join(" | "));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
