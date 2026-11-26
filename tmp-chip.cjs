const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // 半导体/芯片/算力相关：行业=半导体，或名字带 芯/微/半导体
  const rows = await p.$queryRawUnsafe(`
    SELECT s.stockCode, s.stockName, s.industry,
           d.changePct, d.close, d.volumeRatio
    FROM StockBasic s
    JOIN DailyStock d ON d.stockCode = s.stockCode AND d.tradeDate = (SELECT MAX(tradeDate) FROM DailyStock)
    WHERE s.industry = '半导体'
       OR s.stockName LIKE '%芯%'
       OR s.stockName LIKE '%微%'
    ORDER BY d.changePct DESC
  `);
  rows.forEach(r => console.log(r.stockCode, r.stockName, r.industry || '-', '涨跌', r.changePct, '收', r.close, '量比', r.volumeRatio));
  await p.$disconnect();
})();
