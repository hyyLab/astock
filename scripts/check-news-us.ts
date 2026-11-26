// 验证新闻服务 + 美股映射服务
import { getLatestNews } from "@/lib/services/news";
import { getUsMarket } from "@/lib/services/usmarket";

async function main() {
  const n = await getLatestNews(8);
  console.log("=== 新闻 sourceOnline:", n.sourceOnline, "| count:", n.rows.length);
  for (const row of n.rows.slice(0, 8)) {
    const title = row.title ?? row.content.slice(0, 40);
    console.log(`  [${row.impact}] [${row.themes.join(",") || "—"}] ${title.slice(0, 46)} | 提及: ${row.stocks.map((s) => s.key).join(",") || "—"}`);
  }

  const us = await getUsMarket();
  console.log("=== 美股指数 ===");
  for (const i of us.indices) console.log(`  ${i.name} ${i.close} ${i.changePct > 0 ? "+" : ""}${i.changePct}%`);
  console.log("=== 分组（前6） ===");
  for (const g of us.groups.slice(0, 6)) {
    console.log(`  ${g.theme} 均${g.avgChangePct}% (${g.direction}) 受益:${g.beneficiaries.slice(0, 3).map((b) => b.stockName).join(",") || "今日无涨停"}`);
    for (const s of g.stocks.slice(0, 3)) console.log(`    ${s.cname}(${s.symbol}) ${s.changePct > 0 ? "+" : ""}${s.changePct}%`);
  }
  console.log(us.tradeNote);
  process.exit(0);
}
main();
