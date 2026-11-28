# SQLite → PostgreSQL 数据迁移报告

日期：2026-11-28　|　分支：feat/postgres-shadow-tables　|　执行人：CodeBuddy

## 一、方案

- **工具**：自写 Bun 脚本（项目自带 Bun 1.4，无需额外依赖）
  - 读取：`bun:sqlite` 以只读方式打开 `prisma/dev.db`
  - 写入：`Bun.sql`（内置 PostgreSQL 客户端）连接 `astock-pg`
  - 脚本：`scripts/migrate-sqlite-to-pg.ts`（迁移）、`scripts/verify-migration.ts`（验证）
- **流程**：
  1. 从 PG `information_schema` 读取每张表的列与类型，从 `pg_constraint` 读取 FK 依赖做拓扑排序（本库仅 `StockConcept→Concept` 一条 FK，父表先插）；
  2. 单事务内按 1000 行/批参数化 `INSERT`（共 17 表、1,388,411 行）；
  3. 类型转换：SQLite 中 DateTime 以毫秒时间戳整数存储 → 转 `Date` 后入 `timestamp`；Boolean 以 0/1 存储 → 转 `true/false`；其余 text/int/float 原样透传；
  4. 事务内逐表执行 `setval(pg_get_serial_sequence(...), MAX(id)+1, false)` 重置全部自增序列，保证新插入 id 不冲突；
  5. 整体一个事务提交，任一表失败则全部回滚。

## 二、行数对照（SQLite vs PostgreSQL）

| 表名 | SQLite | PostgreSQL | 结果 |
|---|---|---|---|
| BoardHistory | 3,856 | 3,856 | OK |
| BrokenLimit | 484 | 484 | OK |
| CollectLog | 9 | 9 | OK |
| Concept | 112 | 112 | OK |
| DailyConcept | 1,960 | 1,960 | OK |
| DailyMarket | 63 | 63 | OK |
| DailyStock | 44,733 | 44,733 | OK |
| IntradayEvent | 30,440 | 30,440 | OK |
| IntradayIndexSnap | 1,146 | 1,146 | OK |
| IntradaySnap | 1,295,712 | 1,295,712 | OK |
| LimitDown | 0 | 0 | OK |
| LimitUp | 2,439 | 2,439 | OK |
| NewsItem | 1,100 | 1,100 | OK |
| SentimentDaily | 63 | 63 | OK |
| StockBasic | 4,605 | 4,605 | OK |
| StockConcept | 1,053 | 1,053 | OK |
| VolumeSurge | 636 | 636 | OK |
| **合计** | **1,388,411** | **1,388,411** | **全部一致** |

## 三、抽查结果

- **内容抽查**：对数据量最大的 3 张表按 id 均匀取样各 5 行（首行/25%/50%/75%/末行），逐字段与 SQLite 原值比对（浮点精确相等、时间戳按毫秒、布尔按 0/1 归一）：
  - IntradaySnap：5 行 × 15 列 全部一致
  - DailyStock：5 行 × 17 列 全部一致
  - IntradayEvent：5 行 × 16 列 全部一致
- **外键完整性**：`StockConcept→Concept` 孤儿行 0 条。
- **自增序列**：17 张表的序列 next 值均 = `MAX(id)+1`（含空表 LimitDown → 1），迁移后新插入不会与旧 id 冲突。
- **Prisma**：`npx prisma validate` 通过；Prisma Client 查询正常（StockBasic 4,605 行、IntradaySnap 1,295,712 行、LimitUp 连板数据可查）。另做了一次临时插入验证序列：`CollectLog` 新行获得 id=10（旧最大 9），验证后已删除。

## 四、遇到的问题

1. **Docker Desktop 未运行**：按上会话方式启动（`E:\Tools\Docker\Docker\Docker Desktop.exe`），daemon ~5 秒就绪；`astock-pg` 容器从 Exited(255) 状态拉起后正常，PostgreSQL 就绪、17 张空表确认。
2. **Bun SQL 模板插值不支持标识符**：表名放入 `${}` 会被当参数，报 `relation "$1" does not exist`。表名/列名改用 `sql.unsafe()` 拼接（均来自系统目录，无注入风险），值仍走参数化。
3. **COUNT 返回类型**：Bun SQL 返回 PG 的 `bigint` 计数为字符串，行数对比需先 `Number()`，否则恒报 MISMATCH（实际数据一直一致）。
4. **序列状态显示**：`pg_sequences.last_value` 在未被 `nextval` 读取前显示 NULL，改为直接查序列对象的 `last_value/is_called` 验证（`is_called=false` 时 nextval 返回 last_value 本身）。
5. **dev.db 附属文件**：只读打开会在 SQLite WAL 模式下产生/更新 `dev.db-shm` 附属文件；主库文件 `dev.db`（269MB）与 `dev.db-wal` 均未改动，保留作为回滚备份。

## 五、结论

迁移完成并验证通过。回滚方式：将 `.env` 的 `DATABASE_URL` 切回 SQLite 连接串并恢复 `schema.prisma` 的 provider 即可，`dev.db` 原样保留。
