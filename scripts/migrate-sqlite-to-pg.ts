// 一次性迁移脚本：SQLite (prisma/dev.db) -> PostgreSQL (astock)
// 运行：bun scripts/migrate-sqlite-to-pg.ts
// 迁移后重置自增序列，保证后续新插入 id 不冲突。
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const PG_URL = "postgresql://postgres:astock_dev@localhost:5432/astock";
const SQLITE_PATH = "prisma/dev.db";
const BATCH = 1000;

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pg = new SQL(PG_URL);

const tables = (
  sqlite.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name`
  ).all() as { name: string }[]
).map((t) => t.name);

// 每张表在 PG 侧的列与类型
type Col = { name: string; type: string };
const pgCols: Record<string, Col[]> = {};
for (const t of tables) {
  pgCols[t] = (await pg`
    SELECT column_name AS name, data_type AS type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${t}
    ORDER BY ordinal_position`) as Col[];
  if (!pgCols[t].length) throw new Error(`PG 缺少表 ${t}`);
}

// FK 依赖拓扑排序（父表在前）
const fkRows = (await pg`
  SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
  FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`) as {
  child: string;
  parent: string;
}[];
const fkMap: Record<string, string[]> = {};
for (const r of fkRows) (fkMap[r.child] ??= []).push(r.parent);
const ordered: string[] = [];
const visited = new Set<string>();
function visit(t: string) {
  if (visited.has(t)) return;
  for (const p of fkMap[t] ?? []) if (p !== t) visit(p);
  visited.add(t);
  ordered.push(t);
}
for (const t of tables) visit(t);

// SQLite -> PG 值转换
function convert(val: unknown, type: string): unknown {
  if (val === null || val === undefined) return null;
  if (type === "timestamp without time zone" || type === "timestamp with time zone") {
    return typeof val === "number" ? new Date(val) : new Date(String(val));
  }
  if (type === "boolean") return val === 1 || val === true || val === "1";
  if (type === "json" || type === "jsonb") {
    return typeof val === "string" ? JSON.parse(val) : val;
  }
  return val;
}

let total = 0;
await pg.begin(async (tx) => {
  for (const t of ordered) {
    const cols = pgCols[t];
    const colList = cols.map((c) => `"${c.name}"`).join(",");
    const stmt = sqlite.prepare(`SELECT ${colList} FROM "${t}"`);
    let count = 0;
    let params: unknown[] = [];
    let tuples: string[] = [];
    const flush = async () => {
      if (!tuples.length) return;
      await tx.unsafe(`INSERT INTO "${t}" (${colList}) VALUES ${tuples.join(",")}`, params);
      params = [];
      tuples = [];
    };
    for (const r of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
      tuples.push(
        `(${cols
          .map((c) => {
            params.push(convert(r[c.name], c.type));
            return `$${params.length}`;
          })
          .join(",")})`
      );
      count++;
      if (tuples.length >= BATCH) await flush();
    }
    await flush();
    total += count;
    console.log(`${t}: ${count} rows`);
  }

  // 重置自增序列：setval(seq, max+1, false) => 下次 nextval 返回 max+1
  for (const t of tables) {
    const hasId = pgCols[t].some((c) => c.name === "id");
    if (!hasId) continue;
    await tx.unsafe(
      `SELECT setval(pg_get_serial_sequence('"${t}"','id'), COALESCE((SELECT MAX("id") FROM "${t}"), 0) + 1, false)`
    );
  }
  console.log("sequences reset");
});

console.log("total rows migrated:", total);
await pg.close();
