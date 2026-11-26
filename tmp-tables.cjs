const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const t = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'");
  console.log(t.map(x => x.name).join('\n'));
  await p.$disconnect();
})();
