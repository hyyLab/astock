const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const cols = await p.$queryRawUnsafe("SELECT name FROM pragma_table_info('StockBasic')");
  console.log(cols.map(c => c.name).join('\n'));
  await p.$disconnect();
})();
