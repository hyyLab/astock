const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRawUnsafe("SELECT stockCode, stockName, market, industry FROM StockBasic WHERE stockName LIKE '%半导体%' OR stockName LIKE '%芯%' OR stockName LIKE '%科技%' LIMIT 40");
  rows.forEach(r => console.log(r.stockCode, r.stockName, r.market, r.industry));
  console.log('---');
  const ind = await p.$queryRawUnsafe("SELECT industry, COUNT(*) n FROM StockBasic GROUP BY industry ORDER BY n DESC LIMIT 30");
  ind.forEach(r => console.log(r.industry, r.n));
  await p.$disconnect();
})();
