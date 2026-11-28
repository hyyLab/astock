// 迁移验证：行数对照 + 抽样内容比对 + FK 完整性 + 序列状态
// 运行：bun scripts/verify-migration.ts
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const sqlite = new Database("prisma/dev.db", { readonly: true });
const pg = new SQL("postgresql://postgres:astock_dev@localhost:5432/astock");

const tables = (
  sqlite.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name`
  ).all() as { name: string }[]
).map((t) => t.name);

// 1. 行数对照
console.log("=== 行数对照 ===");
let allOk = true;
for (const t of tables) {
  const s = (sqlite.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
  const p = Number((await pg.unsafe(`SELECT COUNT(*) AS n FROM "${t}"`) as { n: string }[])[0].n);
  const ok = s === p;
  if (!ok) allOk = false;
  console.log(`${t}\tsqlite=${s}\tpg=${p}\t${ok ? "OK" : "MISMATCH"}`);
}

// 2. 抽样比对：3 张最大表各 5 行（按 id 均匀取样）
console.log("\n=== 抽样比对 ===");
function normPg(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}
function normSq(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  return v;
}
for (const t of ["IntradaySnap", "DailyStock", "IntradayEvent"]) {
  const n = (sqlite.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
  const offsets = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
  const cols = (
    sqlite.query(`PRAGMA table_info("${t}")`).all() as { name: string }[]
  ).map((c) => c.name);
  let mismatches = 0;
  for (const off of offsets) {
    const sq = sqlite.query(`SELECT * FROM "${t}" ORDER BY id LIMIT 1 OFFSET ${off}`).get() as Record<string, unknown>;
    const pgRow = (await pg.unsafe(`SELECT * FROM "${t}" WHERE id = ${sq.id}`))[0] as Record<string, unknown>;
    for (const c of cols) {
      const a = normSq(sq[c]);
      const b = normPg(pgRow[c]);
      // 浮点用精确相等（两端均为 float64 原值）
      if (a !== b) {
        mismatches++;
        console.log(`MISMATCH ${t} id=${sq.id} col=${c}: sqlite=${JSON.stringify(a)} pg=${JSON.stringify(b)}`);
      }
    }
  }
  console.log(`${t}: 抽样 5 行 x ${cols} 列 -> ${mismatches === 0 ? "全部一致" : mismatches + " 处不一致"}`);
}

// 3. FK 完整性（孤儿行检查）
console.log("\n=== FK 完整性 ===");
const orphans = (await pg.unsafe(
  `SELECT COUNT(*) AS n FROM "StockConcept" sc LEFT JOIN "Concept" c ON sc."conceptId" = c.id WHERE c.id IS NULL`
) as { n: number }[])[0].n;
console.log(`StockConcept->Concept 孤儿行: ${orphans}`);

// 4. 序列状态（nextval 应为 max(id)+1）
console.log("\n=== 序列状态 ===");
for (const t of tables) {
  const r = (await pg.unsafe(
    `SELECT last_value AS lv, is_called AS ic FROM "${t}_id_seq"`
  ))[0] as { lv: number; ic: boolean };
  const maxId = Number((await pg.unsafe(`SELECT COALESCE(MAX(id),0) AS m FROM "${t}"`) as { m: number }[])[0].m);
  // is_called=false 时 nextval 返回 last_value；true 时返回 last_value+1
  const next = r.ic ? r.lv + 1 : r.lv;
  const expect = maxId + 1;
  console.log(`${t}_id_seq: next=${next} max(id)+1=${expect} ${next === expect ? "OK" : "CHECK"}`);
}

console.log(`\n总体: ${allOk ? "行数全部一致" : "存在行数不一致"}`);
await pg.close();
