# UI 接入 PostgreSQL 数据源 · 本地运行验证报告

日期：2026-11-28　分支：main（HEAD 62f543a，未提交/未推送）

## 一、执行了什么

1. 启动 Docker Desktop（E:\Tools\Docker\Docker\Docker Desktop.exe），`astock-pg` 容器由 Exited(255) 启动为 Up，`pg_isready` 就绪。
2. 确认数据：`StockBasic` 4605 行、`DailyStock` 44733 行、`CollectLog` 9 行，17 张表齐全。
3. `.env` 的 `DATABASE_URL` 已指向 `postgresql://postgres:astock_dev@localhost:5432/astock`，`schema.prisma` 已是 `postgresql` provider；执行 `npx prisma generate` 重新生成客户端（原 node_modules 内为旧引擎产物）。
4. `npm run dev`（next dev -p 3000）启动，进程内调度器正常拉起。

## 二、验证了什么（真实数据）

- `GET /api/strategies` → 200，真实数据：`asOf=2026-11-27`，63 个交易日，2439 条涨停记录，晋级率/封板强度/题材首封各档均有值。
- 全部主要路由均 200：`/api/review/latest`、`/api/boards`、`/api/concepts`、`/api/limit-up`、`/api/sentiment`、`/api/market/today`、`/api/anomaly`、`/api/review/calendar`、`/api/news`、`/api/intraday`、`/api/stocks`、`/api/us-market`、`/api/volume-hold`、`/api/briefing`。
- UI（Chromium 无头浏览器实际渲染）：
  - `http://localhost:3000/#/strategy` 战法页正常渲染真实数据：页面显示「样本：2026-11-27 前 63 个交易日 · 2439 条涨停记录」，贝叶斯战法验证各档胜率/HDI 均有值（截图：`mailbox/strategy-ui.png`）。
  - 首页（今日复盘）正常渲染，无「加载失败」，无 5xx 响应，无 console 错误。

## 三、修了什么（N3 / N4，最小改动）

### N3：调度/异常兜底（src/lib/scheduler.ts）

问题：`tick()` 在每日 09:05 以 `void gapCheck("盘前巡检")` 调用缺口巡检，而 `gapCheck` 内部的 `db.dailyMarket.findFirst` 无 try/catch——数据库不可用时产生未处理的 Promise 拒绝（Node 下可直接崩溃进程）。

修复（scheduler.ts:135-158）：`gapCheck` 的数据库查询段包入 try/catch，失败时记录到 collect 任务状态（`lastOk=false`、`lastError="收盘缺口巡检失败（原因）：..."`）并打日志，返回 false 不再上抛。已有机制（news/collect/intraday 三个任务的 catch 记录 + `/api/admin/scheduler` 暴露 lastOk/lastError）保持不变，构成「失败可见、不崩溃」的兜底。

### N4：空库 API 500 → 明确 404

问题：空库时 `getReviewBundle` / `getAnomaly` 抛「数据库为空…」，各路由统一 catch 后返回 500，看起来像未处理错误。

修复：
- 新增 `src/lib/services/errors.ts`：`export class EmptyDataError extends Error {}`。
- 标记空数据抛点：`src/lib/services/review.ts:296`（数据库为空）、`review.ts:325`（交易日数据不完整）、`src/lib/services/anomaly.ts:205`（数据库为空）。
- 7 个消费路由的 catch 增加 `if (e instanceof EmptyDataError) return 404 + { error: 原信息 }`：
  - `src/app/api/boards/route.ts:19`
  - `src/app/api/concepts/route.ts:19`
  - `src/app/api/limit-up/route.ts:19`
  - `src/app/api/sentiment/route.ts:19`
  - `src/app/api/market/today/route.ts:19`
  - `src/app/api/review/latest/route.ts:19`
  - `src/app/api/anomaly/route.ts:15`

（`/api/review/[date]`、`/api/stock/[code]` 原本就对所有错误返回 404，未改；`/api/briefing` 原本就 404；`volumeHold.ts` 的「快照为空」在 try/catch 内回退日 K，不外抛，未改。）

## 四、空库行为验证

方法：临时创建空库 `astock_empty`（同 schema，prisma db push），以 `DATABASE_URL` 覆盖启动 dev server（进程环境变量优先于 .env），逐个路由验证后删库还原。

结果：**全部路由无 500**。
- 404 + 明确中文提示：`/api/review/latest`、`/api/boards`、`/api/concepts`、`/api/limit-up`、`/api/sentiment`、`/api/market/today`、`/api/anomaly`、`/api/briefing`、`/api/review/2026-11-27`、`/api/stock/600519`。
- 200 零状态：`/api/strategies`（asOf=""、dayCount=0、空数组，bayes 管线不崩）、`/api/review/calendar`（{dates:[],latest:""}）、`/api/intraday`（hasData:false）、`/api/news`、`/api/stocks`、`/api/volume-hold`、`/api/us-market`。

N3 实测：停掉 PG 容器后重启 dev server，启动自检的缺口巡检失败被捕获（日志出现「收盘缺口巡检失败（启动自检）」一次），进程未崩溃（端口持续监听）；PG 恢复后服务器继续正常响应 200。

## 五、遇到的问题

1. Next 16 dev 有 `.next/dev/lock` 单实例锁，无法同时跑两个端口做空库对照——改为停掉正式 server、切换 DATABASE_URL 验证后再还原。
2. 空库启动时调度器「收盘缺口自愈」检测到空库即自动补跑采集（符合设计），为保持空库状态做验证，截断表后重启并快速完成探测，随后删库。
3. `npx tsc --noEmit` 存在**既有**类型错误（scripts/、src/lib/bayes/、src/lib/calc/、src/lib/collector/ 等，均为本次未触碰的代码）；本次改动的文件无新增类型错误。
4. playwright-cli 的 daemon 与 Node 24 不兼容，改用全局 @playwright/cli 自带的 playwright-core + 已安装 Chromium 直接驱动验证 UI。

## 六、当前状态

- Docker `astock-pg`：Up，数据完好。
- dev server：运行在 http://localhost:3000（连真实库 astock），`/api/strategies` 200。
- 改动文件共 11 个（如上），未提交、未推送；`schema.prisma` 模型定义未动；`src/lib/bayes/` 未触碰。
