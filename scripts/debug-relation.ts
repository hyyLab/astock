// 验证 StockConcept 关系查询
import { db } from "../src/lib/db";

const links = await db.stockConcept.findMany({
  where: { stockCode: "601811" },
  include: { concept: true },
  take: 5,
});
console.log("601811 题材关联:", links.map((l) => l.concept.conceptName));
await db.$disconnect();
process.exit(0);
