const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // 存储链：行业=半导体 全部 + 名字带 存储的，看昨天谁跌最狠（映射韩国减产恐慌）
  const rows = await p.$queryRawUnsafe(`
    SELECT s.stockCode, s.stockName, s.industry,
           d.changePct, d.close
    FROM StockBasic s
    JOIN DailyStock d ON d.stockCode = s.stockCode AND d.tradeDate = (SELECT MAX(tradeDate) FROM DailyStock)
    WHERE s.industry = '半导体'
    ORDER BY d.changePct ASC
  `);
  rows.forEach(r => console.log(r.stockCode, r.stockName, '涨跌', r.changePct, '收', r.close));
  await p.$disconnect();
})();
