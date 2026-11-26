const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // 昨天涨停/跌停里的半导体+存储相关，以及江化微的完整数据
  const rows = await p.$queryRawUnsafe(`
    SELECT s.stockCode, s.stockName, s.industry,
           d.changePct, d.close, d.volumeRatio
    FROM StockBasic s
    JOIN DailyStock d ON d.stockCode = s.stockCode AND d.tradeDate = (SELECT MAX(tradeDate) FROM DailyStock)
    WHERE s.stockCode IN ('603078','002983','301348','600520','002156','600360','002077','603893')
    ORDER BY d.changePct ASC
  `);
  rows.forEach(r => console.log(r.stockCode, r.stockName, r.industry, '涨跌', r.changePct, '收', r.close, '量比', r.volumeRatio));
  await p.$disconnect();
})();
