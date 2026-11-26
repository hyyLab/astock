// 一次性：按最新 themeRules 重打存量快讯(flash)的题材标签
// 背景：福建概念 newsKeywords 曾含裸"海峡"，霍尔木兹海峡等国际新闻误挂；
//       收窄规则后重刷存量快讯（个股新闻 stock 行由证据链生成，不动）
import { db } from "../src/lib/db";
import { matchThemesInText } from "../src/lib/calc/themeRules";

const rows = await db.newsItem.findMany({ where: { kind: "flash" } });
let changed = 0;
for (const r of rows) {
  const themes = matchThemesInText(r.content);
  const next = themes.length ? JSON.stringify(themes) : null;
  if (next !== r.themes) {
    await db.newsItem.update({ where: { id: r.id }, data: { themes: next } });
    changed++;
  }
}
console.log(`快讯重打标签完成：共 ${rows.length} 条，更新 ${changed} 条`);
process.exit(0);
