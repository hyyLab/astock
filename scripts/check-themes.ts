import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const names = ['海峡创新', '大亚圣象', '平潭发展', '合富中国', '鹭燕医药'];
  const stocks = await db.stockBasic.findMany({
    where: { OR: names.map((n) => ({ stockName: { contains: n } })) },
    select: { stockCode: true, stockName: true, industry: true, nameAbbr: true },
  });
  console.log('=== 目标股票基础信息 ===');
  for (const s of stocks) console.log(JSON.stringify(s));

  const lastLU = await db.limitUp.findMany({
    orderBy: { tradeDate: 'desc' },
    take: 80,
    select: {
      tradeDate: true, stockCode: true, stockName: true, industry: true,
      themes: true, firstLimitTime: true, boardCount: true, amount: true,
    },
  });
  const lastDate = lastLU[0]?.tradeDate;
  console.log('\n=== 最新交易日:', lastDate, '===');
  for (const x of lastLU.filter((x) => x.tradeDate === lastDate)) {
    console.log(
      `${x.firstLimitTime ?? '?'} | ${x.boardCount}板 | ${x.stockName}(${x.stockCode}) | 行业:${x.industry} | themes:${x.themes ?? '-'}`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
