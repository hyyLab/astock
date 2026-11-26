## [2026-11-26 01:19:01] buddy

副查结论（应大肥鱼要求，本次现场 checked，未沿用任何既有结论；依据 `F:\astock-src` 当前代码与 `prisma/schema.prisma`）：

一、collect.ts 写入逻辑检查（`src/lib/collector/collect.ts`）
- 幂等性总体成立：7.2 对 8 张表按 `windowDates` 做 `deleteMany` 后重建（L270-277）；`volumeSurge` 仅删最新日、历史保留（L625-627）；`newsItem` 靠 `extId` upsert + 600 条裁剪（L502-518）；`stockBasic`/`concept`/`stockConcept` 均为 upsert（L233-268）。重复执行不会产生重复行。
- 唯一键对齐：`limitUp`/`brokenLimit`/`limitDown`/`boardHistory` 写前按 `(tradeDate, stockCode)` 去重（L524-531），与 schema 中各自的 `@@unique` 一致；`dailyStock` 用 `seenStockDate` 去重（L295-304）；`dailyConcept` 的 `(tradeDate, conceptName, kind)` 靠 industry/theme 双 kind 区分（L667-681），未发现直接冲突。
- 爆量预筛为双通道（快照 ≥1.5 前 120 + 池内 K 线精算），价格/涨跌幅取 K 线日 bar、时点无关（L533-627），与 worklog Task 11 的修复描述一致。
- 风险点 1（较重要）：整个 7.x 写库无 `$transaction`。7.2 先删 8 张表，后续任一步失败（如某条 `createMany` 触发约束、网络异常）会留下「已删未写」的部分数据；重跑可自愈，但失败瞬间前端可能读到空窗。建议网络抓取全部前置后，用一个事务集中做删+写。
- 风险点 2：`poolsByDate.get(ymd(d))!` 在 7.3/7.4 对窗口内每一天做非空断言（L289、L343），前置只校验了 `latestPools`。若某历史交易日东财接口失败/返回空，会抛 `TypeError` 中断全量采集。建议改为显式 `if (!p) throw new Error(...)` 或跳过并记录。
- 风险点 3（口径小偏差）：`summary.brokenCount`/`limitDownCount`/`sealRate` 取 `latestPools.zb.length`/`.dt.length`（L763、L764、L770），而实际入库的 `uniqBroken`/`uniqDown` 经过去重、且 `limitUp` 含规则补录行。池内若有重复代码，汇总数字会与库内明细对不上。建议改为取去重后最新日行数。
- 风险点 4：`stockNewsCount` 统计的是抓取条数，不是 upsert 后实际新增条数（L462 vs L505），日志数字可能偏大，仅影响观测。
- 风险点 5（非阻塞）：`DailyStockRow` 接口未声明 `volumeRatio`，但 push 的对象带了该字段（L280-285、L327）；eslint 不报，疑似属于 worklog Task 11 记录的 tsc 35 处存量类型债务，建议补声明。另 7.1 对 4604 只股票逐条串行 upsert（L233-251），当前实测约 19s 可接受。

二、db.ts 配置检查（`src/lib/db.ts`）
- 单例写法正确：`globalForPrisma.prisma ?? new PrismaClient()`，符合 Next.js + Prisma 官方模板，可避免 dev HMR 反复实例化导致连接耗尽；`if (NODE_ENV !== 'production')` 才挂到 globalThis 也符合模板（L3-13）。
- 问题：`new PrismaClient({ log: ['query'] })` 无条件开启 query 日志（L9-11）。生产环境每条 SQL 都会打到 stdout，量大时影响性能，并可能把个股/持仓等查询内容写进日志。建议按环境分级：`log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error']`。
- SQLite 数据源无需连接池配置，当前无问题（schema L11-14）。

三、通信协议确认
- 已创建 `F:\astock-src\mailbox\to-fish.md`，本条为第一条消息；后续按 `## [时间] 署名` + 正文格式只追加不覆盖。`to-buddy.md` 由你创建与写入，我不动它。
- 说明：我无法在会话之外自动盯文件；你在对话里让我读 `to-buddy.md` 时，我会只读末尾未读部分并执行其中派活。每完成一项任务我会往本文件追加一条。

## [2026-11-26 01:27:34] buddy

修复清单（应 01:25 催活；只读未动代码，未碰 `scripts/tmp-backtest.cjs`）。写入位置按 01:20 指示为 to-fish.md。行号基于当前 `src/lib/collector/collect.ts` 与 `src/lib/db.ts`。

补充发现（并入风险点 3）：去重动作在 L524-531，但它的**上游** L447（7.4.2 新闻抓取的 `latestLuRows`）和**下游** L652-654（题材/情绪聚合的 lu/zb/dt）、L756（summary 的 latestLu）都还在用未去重的 `limitUpRows`/`brokenRows`。也就是说「入库去重、统计不去重」，这与风险点 3 是同一个根因，修的时候要一起收口，否则只改 summary 三行仍会留下 sentimentDaily/conceptRows 的口径偏差。

---

**风险点 1：写库无事务，删完未写会留空窗**

- 改哪个文件哪一行：`src/lib/collector/collect.ts` L228-794（7.1 upsert L233-268、7.2 deleteMany L270-277、各 createMany L334/L525-531/L627/L750-752、新闻 upsert+裁剪 L502-518、collectLog L779-794）。
- 怎么改：
  1. 网络 I/O 全部留在事务外：L114/127/141/162 的快照/指数/池/K线，以及 L449-457 的 `pmap(fetchStockNews)`，结果先攒在内存（`snapshot`、`poolsByDate`、`klineMeta`、`fetched`）。
  2. 把 L233-268 的三个 upsert、L502-518 的新闻 upsert+裁剪、L779-794 的 collectLog.create 从原位移进事务；它们都只依赖已算好的内存数据，无网络调用。
  3. 在 L228 之后包一层交互式事务：`await db.$transaction(async (tx) => { ... }, { maxWait: 10000, timeout: 60000 })`，事务体内依次做：三个 upsert → L270-277 八表 deleteMany → 各 createMany → 新闻 upsert+裁剪 → volumeSurge 删+写 → collectLog.create；事务体内所有 `db.` 改 `tx.`。
  4. `summary.totalAmountYi` 的修正（L796-799）只依赖内存 `marketRows`，可留在事务外 return 前。
  5. 注意 SQLite 单写者：事务体内不要留任何 await 网络调用或长 CPU 计算，否则会拉长锁库窗口；60s timeout 足够当前约 19s 的采集。
- 怎么验证：
  - 故障注入：临时在事务体内某个 createMany 前抛错（建议用环境变量钩子控制，如 `FAIL_AT=limitUp`，验证后撤掉），跑 `bun scripts/collect-daily.ts`，确认所有表（含 volumeSurge/newsItem/collectLog）完全回滚、库内行数与采集前一致、collectLog 无 success 记录。这条直接堵住你说的「日志成功但数据缺失」路径。
  - 正常跑两次采集，对比各表行数不增长（幂等回归），验收口径与 worklog 一致（涨停53/炸板10/封板率84.1%/情绪52.1 或当前最新日口径）。
  - `bun run lint` 0 错误。

**风险点 2：poolsByDate 非空断言**

- 改哪个文件哪一行：`src/lib/collector/collect.ts` L289、L343（另在 L141 拉完池后加前置校验）。
- 怎么改：
  1. L141 之后加一道写库前的完整性校验：`const missing = windowDates.filter(d => !poolsByDate.has(ymd(d)))`，非空则 `throw new Error(...)` 并列出缺失日期；放在事务开启之前，失败时库完全不动。
  2. 提取 `poolsOf(d)` helper，内部 `const p = poolsByDate.get(ymd(d)); if (!p) throw new Error(...)`；L289 与 L343 的 `poolsByDate.get(ymd(d))!` 改为 `poolsOf(d)`。
  3. 判断「缺失」只针对 key 不存在（返回 undefined）。若 `fetchAllPools` 对当日无涨停返回空数组是正常情况，不能按 `p.zt.length === 0` 判缺失；需先确认 `src/lib/market/em.ts` 的返回语义再定校验条件。
- 怎么验证：
  - 临时 mock `fetchAllPools`，删掉某个历史交易日的 key 后跑 `runCollection`：应抛出含具体日期的明确 Error，而不是 `Cannot read properties of undefined`；结合风险点 1 的事务，确认库内数据零变动。
  - 正常跑一次采集回归。`bun run lint` 0 错误。

**风险点 3：汇总口径与入库行不一致（含新发现的去重未收口）**

- 改哪个文件哪一行：`src/lib/collector/collect.ts` L447、L524-531、L652-654、L756、L762-764、L770。
- 怎么改：
  1. 把 L524-531 的四行 `uniq*` 计算整体上移到 L432 之后（7.4 循环结束、7.4.2 新闻抓取之前），之后全部下游统一消费 `uniqLimitUp`/`uniqBroken`/`uniqDown`/`uniqBoard`。
  2. L447 `limitUpRows.filter(...)` → `uniqLimitUp.filter(...)`，避免对同股重复抓新闻。
  3. L652-654 的 `lu`/`zb`/`dt` → 分别取 `uniqLimitUp`/`uniqBroken`/`uniqDown` 按日期过滤（题材统计与情绪计算这才与入库明细同源）。
  4. L756 `latestLu` → `uniqLimitUp.filter(...)`；L762 `limitUpCount` 同源于此。
  5. L763 `brokenCount: latestPools.zb.length` → `uniqBroken` 最新日行数；L764 `limitDownCount` → `uniqDown` 最新日行数；L770 `sealRateOf(latestLu.length, latestPools.zb.length)` → 用上面两个去重后的数。
  6. L525-531/L627/L750-752 的写入本身保持用 `uniq*`，不动。
- 怎么验证：
  - 对比 `summary` 与库内：按 latestDate 查三表 count，应与 `summary.limitUpCount/brokenCount/limitDownCount`、`sealRate` 完全相等；`sentimentDaily` 的 `limitUpCount/sealRate/sentimentTemperature` 应等于基于 `limitUp` 表重算的值。
  - 构造重复行的回归用例（mock 池里塞一条同 code 重复行），确认入库行数与汇总数字都不重复、`collectLog.message` 一致。
  - 正常采集回归验收口径不变，`bun run lint` 0 错误。

**风险点 4：stockNewsCount 是抓取数不是入库数**

- 改哪个文件哪一行：`src/lib/collector/collect.ts` L46-67（CollectSummary 类型）、L462、L502-507、L519-521。
- 怎么改：
  1. 把 L462 的 `stockNewsCount += news.length` 去掉；在 L503-507 upsert 前按 batch 查一次已存在的 extId（`findMany({ where: { extId: { in: ... } }, select: { extId: true } })`），`inserted += batch.length - existing.length`；单进程采集无并发竞态。
  2. CollectSummary 保留 `stockNewsCount` 语义为「实际新增」，另加可选 `stockNewsFetched` 记录抓取条数（L462 累加到新变量），L519-521 的日志两个都打。
  3. `evidenceStocks`/`themeMerged` 保持不变（它们本身就是处理口径）。
- 怎么验证：
  - 连续跑两次采集：第二次 `stockNewsFetched` 仍 > 0，`stockNewsCount`（新增）应为 0 或仅含真正新发布的新闻；库内 `kind='stock'` 总数不因重复采集虚增。
  - 对比 `db.newsItem.count({ where: { kind: 'stock' } })` 与两次采集新增之和。`bun run lint` 0 错误。

**风险点 5：类型债务 + 串行 upsert**

- 改哪个文件哪一行：`src/lib/collector/collect.ts` L280-285（`DailyStockRow` 接口）、L233-251（串行 upsert）；另 `src/lib/db.ts` L9-11 的 query 日志（副查里提过，一并审）。
- 怎么改：
  1. `DailyStockRow` 接口补 `volumeRatio: number | null;`（L327 已在传该字段），消除对象字面量多余属性告警。
  2. L233-251 的串行 upsert 最小改动是保持串行并纳入风险点 1 的事务即可（当前约 19s 可接受）。若审完要优化，再改为按 `stockCode` 预查存在性、新行 `createMany` + 存量逐行 `update`（SQLite 不支持 `skipDuplicates`，不要直接换成 `createMany`）；不要为了省这点时间引入并发写。
  3. `db.ts`：`log` 按环境分级——`log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error']`，避免生产把每条 SQL 和个股数据打进 stdout。
- 怎么验证：
  - `bunx tsc --noEmit` 中该处多余属性报错消失（worklog 记录的 35 处存量错误，目标是这一项不再出现，不强求一次清完）；`bun run lint` 0 错误。
  - 采集耗时不劣化（与当前 ~19s 同量级）；生产构建下日志只有 error 级、无 query 输出。

---

执行顺序建议：风险点 2（前置校验）→ 风险点 3（去重收口）→ 风险点 1（事务包裹）→ 风险点 4（计数）→ 风险点 5（类型/日志）。前两项能把失败拦在写库之前，事务兜住剩余路径。

交叉知会 @SCNet：方案 1/2 会改变 `collect.ts` 的写库时序与失败行为（失败时整批回滚、不再留空窗），若你有任务直接读采集产物或依赖 collect_log 判断成功，请按事务后的语义对齐；我这边等你和大肥鱼审完再动手。

## [2026-11-26 01:36:02] buddy

风险点 2、3 已按 01:32 派活动手改完并自测（风险点 1/4/5 未动，`scripts/tmp-backtest.cjs` 未碰）。

一、em.ts 空日语义（先确认再定校验条件）
- `fetchAllPools`（`src/lib/market/em.ts` L126-133）对 `datesYYYYMMDD` 每个日期无条件 `out.set(d, {zt,zb,dt})`；`fetchPool` 在接口失败/非交易日时 catch 返回 `[]`，但 key 仍在。
- 实测 `fetchAllPools(["20260101"])` → `{has:true, zt:0, zb:0, dt:0}`。
- 结论：空日 = key 存在 + 三空数组，不能按数组长度判缺失。校验只用 key 存在性。

二、实际改动（仅 `src/lib/collector/collect.ts`）
- 风险点 2：L141 拉池后新增 `missingPoolDates` 校验，缺 key 则抛明确 Error（列出日期）且发生在任何写库之前；在 `ymd` 定义后新增 `poolsOf(d)` helper，原两处 `poolsByDate.get(ymd(d))!` 改为 `poolsOf(d)`。其余 `?.` 可选链调用本就安全，未动。
- 风险点 3：四行 `uniq*` 去重计算从原 L524-531 上移到 7.4 循环结束处（新闻证据之前）；新闻抓取的 `latestLuRows`、题材/情绪聚合的 `lu`/`zb`/`dt`、summary 的 `latestLu` 全部改为消费 `uniq*`；新增 `latestBroken`/`latestDown`，`brokenCount`/`limitDownCount`/`sealRate` 由 `latestPools.zb.length`/`.dt.length` 改为去重后行数。写入循环保持用 `uniq*`，行为不变。
- 未引入事务（风险点 1 等审），未改 news 计数（风险点 4），未改类型/日志（风险点 5）。

三、自测结果
- `bunx eslint src/lib/collector/collect.ts`：0 错误；IDE 诊断 0。
- `bun run lint` 全量：17 错误，全部为存量（14 个 `.cjs` 的 require-imports，含 `scripts/tmp-backtest.cjs`；`BriefingView.tsx`/`StrategyView.tsx` 各 1 个 set-state-in-effect），本次改动文件 0 错。
- `bun run collect` 回归成功，耗时 71.8s，最新交易日 2026-11-25：涨停 51 / 炸板 30 / 跌停 0 / 最高 5 板 / 连板 14 / 首板 37 / 成交额 13830.98 亿 / 封板率 63.0% / 情绪 43.8 升温 / 交叉验证不一致 1（以自主为准）/ 个股新闻覆盖 28 只、入库 215 条。
- 口径对账（11-25）：库内 `limitUp=51, brokenLimit=30, limitDown=0`；`sentimentDaily.limitUpCount=51, brokenLimitCount=30, sealRate=0.6296, temperature=43.8`；`collectLog.message.broken=30` —— 与采集摘要完全一致，收口生效。
- 空日校验回归：`fetchAllPools(["20260101"])` 返回 `has=true` 且三池空数组，新校验不会误判正常空日。
- 自测临时脚本 `scripts/tmp-verify-uniq.ts` 已删除，无残留。

## [2026-11-26 01:45:48] buddy

风险点 1 已按 01:42 派活 + SCNet 01:36/01:41 审后方案改完；行数校验按指示留明天。

一、实际改动
- `src/lib/db.ts`：`db` 改为代理（内部 `lbClientRef.current`），重建 client 时导入方无需换引用；日志分级 `dev=['query','warn','error']` / 其余 `['error']`（dev 排查能力保留）；新增 `ensureSqlitePragmas()` 用 `$queryRawUnsafe` 设 `journal_mode=WAL` + `synchronous=NORMAL` + `busy_timeout=20000` + `wal_autocheckpoint=1000`（幂等缓存）；新增 `recreatePrismaClient()`（disconnect 旧连接、换 client、重设 pragma）。
- `.env`：`DATABASE_URL="file:./dev.db?socket_timeout=20"`，不叠加 busy_timeout（SCNet 实测 socket_timeout 会覆盖它）。
- `src/lib/collector/collect.ts`：写库操作统一入 `dbOps` 队列；7.1 三个 upsert（stockBasic/concept/stockConcept）留在事务外；8 表 deleteMany → dailyStock/四明细/createMany → newsItem upsert+裁剪 → volumeSurge 删+写 → dailyConcept/sentimentDaily/dailyMarket → collectLog(success) 全部在单个 `db.$transaction(..., {timeout:60000})` 内顺序执行。新闻 fetch 与 `themes`/`themeEvidence` 内存回写仍在事务外（严格按 SCNet「只把 upsert/裁剪放事务内」）；事务体内零网络 await。
- `scripts/collect-daily.ts`：采集前 `ensureSqlitePragmas()`；有界重试只拦 `P1008` / `database is locked` / `Socket timeout`，最多 2 次，间隔 3s/8s，每次重建 client；`finally` 里 `PRAGMA wal_checkpoint(TRUNCATE)`；失败置退出码 1。

二、自测
- 改动文件 `bunx eslint` 0 错误，IDE 诊断 0。全量 lint 的 17 个存量错误未变化（`.cjs` require + 两个 View 的 set-state-in-effect）。
- `bun run collect` 回归成功，耗时 21.2s（改前 71.8s，日志分级 + WAL 后大幅下降，无 `prisma:query` 刷屏）；11-25 验收：涨停51/炸板30/跌停0/最高5板/封板率63.0%/情绪44.2 升温（数据源实时波动导致与上一轮 43.8 略有差异）。
- WAL 验证：`PRAGMA journal_mode` = `wal`；`dev.db-wal`/`dev.db-shm` 已生成，`wal_checkpoint(TRUNCATE)` 后 wal 大小 0。
- 事务回滚验证（临时脚本，已删）：事务内删 11-25 的 limitUp 后抛错，行数 51→51 完整回滚，collectLog 无新增 success 记录。
- 临时脚本 `scripts/tmp-verify-tx.ts` 已删除，无残留。

三、4/5 改动摘要核实（重要）
- 我逐项核对了当前工作区：另一会话派去的风险点 4/5 **未落地**——`CollectSummary` 仍无 `stockNewsFetched`、`stockNewsCount += news.length` 仍在、`DailyStockRow` 仍缺 `volumeRatio` 声明。本轮只有风险点 5 的第 3 条（db.ts 日志分级）作为事务前置由我落地。
- 因此我无法据实写出「另一个会话的 4/5 改动摘要」，不编造。请确认那一会话是否改在别处/尚未写入；确认后我再补记，或直接由我接着做（你说了算）。
- 运维提醒：切 WAL 后 dev server 需重启才会用新模式；`dev.db-wal/-shm` 需与主库一起备份（或先 checkpoint）。

## [2026-11-26 01:53:40] buddy

风险点 4、5 已按 01:51 派活做完（db.ts 日志分级上轮已做，未重复）。

一、改动（`src/lib/collector/collect.ts`、`scripts/collect-daily.ts`）
- 风险点 4：`stockNewsCount` 语义改为「实际新增入库」——在事务外按 batch 查已存在 `extId`（单进程采集无并发竞态），用 `newsRowsToInsert` 减去已知数得出新增；抓取条数累加到新变量 `stockNewsFetched`。`CollectSummary` 新增 `stockNewsFetched` 字段；采集日志、验收清单、`collectLog.message` 同步同时输出「抓取 X / 新增 Y」。
- 注意计数必须在 summary 构建前算好——事务在 summary 之后才执行，若放在事务回调里累加会永远读到 0。
- 风险点 5：`DailyStockRow` 接口补 `volumeRatio: number | null;`（原代码已在 push 时传该字段）。

二、自测
- 改动文件 `bunx eslint` 0 错误，IDE 诊断 0。
- `bun run collect` 回归成功，21.1s；11-25 验收口径不变（涨停51/炸板30/封板率63.0%/情绪43.8），日志显示「抓取 215 条 / 新增入库 0 条」——库内已有同批新闻，正好验证幂等计数。
- `collectLog` 最新记录：`message={"broken":30,...,"stockNews":0,"stockNewsFetched":215,...}`，`status=success`；库内 `kind='stock'` 总数 446，与改造前一致，未因重复采集虚增。
- `bunx tsc --noEmit`：`volumeRatio`/`DailyStockRow` 相关报错已消失；collect.ts 仍有 `Parameters<>`/`chunk` 泛型类报错，属 worklog Task 11 已记录的存量类型债务（不影响运行时），本轮未扩大范围重构。
- 临时核对脚本 `scripts/tmp-verify-news.ts` 已删除，无残留。

风险点 1~5 全部收口，今晚收工。


## [2026-11-26 12:34:41] CodeBuddy

面板 v0.3 DPI 修复实机验收完成，报告在 `F:\tools\panel\agent-mailbox\tasks\verify-panel-v0.3-dpi.md`。5 条矩阵：②③④⑤通过，①失败——200% 启动面板 `GetWindowRect=(287,40,2273,1631)`，底部超出主屏工作区 `(0,0,2560,1600)` 31px（DWM 可见边框超 20px），根因是 `place_on_primary_screen()` 把含框架的 `frameGeometry()` 高度当作 `resize()` 客户区高度，边框被二次计入。DPI awareness 实测 Per-Monitor V2；四格可见边框对齐误差 0px，GetWindowRect 偏差 11px 系 DWM 不可见边框、代码已补偿（若按字面口径需你定夺）；双开不崩（双窗口属已知 P3-05）。100% 缩放回归未做（可选，需改系统缩放，避免打断桌面）。配置与显示器布局均已还原，未改代码。


