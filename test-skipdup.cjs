const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.dailyStock.createMany({
  data: [{ tradeDate: '2026-11-24', stockCode: 'TEST001', open: 1, high: 1, low: 1, close: 1, changePct: 0, volume: 1 }],
  skipDuplicates: true,
}).then(r => {
  console.log('OK count=', r.count);
  return db.$disconnect();
}).catch(e => {
  // 打印完整错误
  console.log('FULL ERR:');
  console.log(e.message);
  process.exit(1);
});
