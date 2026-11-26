// 查看行业板块名与样本（用于主线题材规则表的白名单对齐）
import { db } from "@/lib/db";
import { PrismaClient } from "@prisma/client";

async function main() {
  const concepts = await (db ?? new PrismaClient()).concept.findMany({
    include: { stocks: true },
  });
  const sorted = concepts
    .map((c) => ({ name: c.conceptName, n: c.stocks.length }))
    .sort((a, b) => b.n - a.n);
  console.log("行业板块总数:", sorted.length);
  for (const c of sorted) console.log(`${c.name}  (${c.n})`);
  process.exit(0);
}
main();
