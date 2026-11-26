// 一次性回填 StockBasic.nameAbbr（拼音首字母），并抽样自检
// 运行：bun scripts/backfill-abbr.ts
import { db } from "@/lib/db";
import { nameAbbrOf } from "@/lib/calc/pinyin";

async function main() {
  const rows = await db.stockBasic.findMany({
    where: { nameAbbr: null },
    select: { stockCode: true, stockName: true },
  });
  console.log(`待回填 ${rows.length} 只`);
  let ok = 0;
  for (const r of rows) {
    const abbr = nameAbbrOf(r.stockName);
    if (!abbr) continue;
    await db.stockBasic.update({ where: { stockCode: r.stockCode }, data: { nameAbbr: abbr } });
    ok++;
  }
  console.log(`回填完成 ${ok} 只`);

  // 抽样自检：用户样例 + 随机 5 只
  const samples = ["平潭发展", "合富中国", "鹭燕医药", "新华文轩", "宁德时代", "东方财富", "贵州茅台"];
  const check = await db.stockBasic.findMany({
    where: { stockName: { in: samples } },
    select: { stockCode: true, stockName: true, nameAbbr: true },
  });
  for (const c of check) console.log(`  ${c.stockName} → ${c.nameAbbr} (${c.stockCode})`);
  process.exit(0);
}
main();
