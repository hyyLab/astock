const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const rows = await p.$queryRawUnsafe(`
    SELECT tradeDate, indexCode, close, changePct
    FROM IntradayIndexSnap
    WHERE tradeDate >= '2026-11-20'
    ORDER BY tradeDate, indexCode
  `);
  rows.forEach(r => console.log(r.tradeDate, r.indexCode, r.close, r.changePct));
  await p.$disconnect();
})();
