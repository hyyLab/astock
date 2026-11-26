const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRawUnsafe(`
    SELECT tradeDate, indexCode, MAX(close) close, MIN(changePct) lowPct, MAX(changePct) highPct
    FROM IntradayIndexSnap
    WHERE tradeDate >= '2026-11-20'
    GROUP BY tradeDate, indexCode
    ORDER BY tradeDate, indexCode
  `);
  rows.forEach(r => console.log(r.tradeDate, r.indexCode, '收', r.close, '最低', r.lowPct, '最高', r.highPct));
  await p.$disconnect();
})();
