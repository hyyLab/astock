const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // 韩国相关：名字带 韩/三星/LG/SK/现代/半导体设备，或行业半导体里昨天跌最狠的（映射恐慌）
  const rows = await p.$queryRawUnsafe(`
    SELECT s.stockCode, s.stockName, s.industry,
           d.changePct, d.close, d.volumeRatio
    FROM StockBasic s
    JOIN DailyStock d ON d.stockCode = s.stockCode AND d.tradeDate = (SELECT MAX(tradeDate) FROM DailyStock)
    WHERE s.stockName LIKE '%韩%'
       OR s.stockName LIKE '%三星%'
       OR s.stockName LIKE '%现代%'
       OR s.stockName LIKE '%SK%'
    ORDER BY d.changePct DESC
  `);
  rows.forEach(r => console.log(r.stockCode, r.stockName, r.industry || '-', '涨跌', r.changePct, '收', r.close, '量比', r.volumeRatio));
  console.log('--- 半导体设备/材料（韩储减产映射） ---');
  const rows2 = await p.$queryRawUnsafe(`
    SELECT s.stockCode, s.stockName, s.industry,
           d.changePct, d.close
    FROM StockBasic s
    JOIN DailyStock d ON d.stockCode = s.stockCode AND d.tradeDate = (SELECT MAX(tradeDate) FROM DailyStock)
    WHERE s.stockName LIKE '%设备%'
       OR s.stockName LIKE '%材料%'
       OR s.stockName LIKE '%存储%'
       OR s.stockName LIKE '%内存%'
    ORDER BY d.changePct DESC
  `);
  rows2.forEach(r => console.log(r.stockCode, r.stockName, r.industry || '-', '涨跌', r.changePct, '收', r.close));
  await p.$disconnect();
})();
