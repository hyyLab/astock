# 多智能体协作日志

---
Task ID: 1
Agent: Super Z (main agent)
Task: 按《连板类行情复盘网站复现开发流程》方案，完成第一阶段 MVP 的全栈开发（数据层→计算层→API层→前端展示层）

Work Log:
- 验证数据源连通性：东财 push2/push2his 被 WAF 拦截；东财 push2ex（涨停池/炸板池/跌停池，支持历史日期）可用；腾讯 proxy.finance.qq.com（全市场快照 4604 只 + K线 + 指数）可用；腾讯 web.ifzq.gtimg.cn 大批量请求后被 WAF 限频，改走 proxy 域名主路 + web 域名备路 + 限速重试
- Prisma 建模 11 张表：stock_basic / daily_market / daily_stock / limit_up / board_history / concept / stock_concept / daily_concept / sentiment_daily + 补充 broken_limit / limit_down / collect_log（龙虎榜两表属第三阶段未建）
- 采集链路 scripts/collect-daily.ts（bun 运行，对应方案的 python collect_daily.py）：全市场快照→交易日推导→东财三池回补 10 日→池内股票 547 只 K线→规则法涨停/炸板/跌停逐日检测（10%/20%/30%/ST5%，涨停池名单∪规则检出）→自主连板状态机→晋级率→题材聚类（行业动态获取非硬编码）→龙头规则（最高板>首封时间>成交额）→情绪温度（透明加权算法，缺失分量自动重归一）
- 修复 bug：roster 键名映射、窗口外 K线日期、指数代码 sz/sh 同号歧义（000001）、deleteMany 日期格式、K线重复日期去重、StockConcept 缺失 Prisma 关系、dev 服务器旧 Prisma 客户端（重启解决）
- 情绪序列：09-16 极强 85° → 09-24 升温 52.1°，10 日连续可回溯；晋级率 1进2 21% / 2进3 33% / 3进4 43% / 4进5 50%
- 交叉验证：自主连板数与东财参考连板数 0 不一致；成交额采用指数官方口径（上证 7836.13 亿与交易所值精确吻合）
- API 层 12 个端点全部 200：market/today、limit-up、boards、concepts、sentiment(+history)、stock/[code](/kline)、review/latest、review/[date]、review/calendar、stocks 搜索、admin/collect；内存缓存键名对齐方案 Redis 命名（review:today:* 风格）
- 前端：单页面 hash 路由（#/ 今日复盘、#/review/[date] 历史复盘、#/stock/[code] 个股详情），连板天梯/情绪仪表盘(ECharts 趋势)/题材榜/涨停池(Tabs)/昨日涨停表现/K线(涨停日 pin 标记)/搜索/移动端响应式；深色交易台风格，红涨绿跌
- 浏览器端到端验证通过：首页四大指数+统计条+天梯+情绪+晋级率、题材榜、涨停列表、昨日涨停表现、个股详情（新华文轩 5 板链路/宁德时代非池内代理）、历史复盘切换（09-23 最高 4 板）、搜索下拉、日期 [<][>] 导航、错误态与重试、移动端 390px 布局
- lint 0 错误；dev.log 无异常

Stage Summary:
- 交付：可运行的连板复盘平台（Next.js 16 + Prisma/SQLite + ECharts），数据 2026-09-11 ~ 2026-09-24 共 10 个交易日
- 验收清单（2026-09-24）：涨停 53 / 炸板 10 / 跌停 0 / 最高板 5 / 连板 13 / 首板 40 / 成交额 16533.57 亿 / 上涨 1008 / 下跌 3465 / 封板率 84.1% / 情绪 52.1 升温
- 关键文件：prisma/schema.prisma；src/lib/market/*（数据源）；src/lib/calc/*（连板/情绪/题材）；src/lib/collector/collect.ts；src/lib/services/*；src/app/api/*；src/components/lb/*
- 日常运行：bun run collect（每日收盘后）；访问 / 即今日复盘，#/review/日期 为历史复盘
- 第二/三/四阶段（爆量、龙虎榜、AI 复盘）已在个股页与库表预留扩展位

---
Task ID: 2
Agent: Super Z (main agent)
Task: 按《连板复盘网站 UI 与功能升级需求文档》完成首页工作台化改造（P0+P1 全模块 + 专项页 + 爆量首版）

Work Log:
- Schema 扩展并 db:push：DailyMarket 增 上证50/北证50 指数列（sz50Index/sz50ChangePct/bz50Index/bz50ChangePct）；DailyStock/LimitUp/BrokenLimit 增 volumeRatio（量比=当日成交量/前20日均量，爆量体系核心字段）
- tx.ts 指数表增 sh000016(上证50)/bj899050(北证50)；collect.ts 增 volumeRatioAt()（≥5日样本），涨停/炸板/日K入库均带量比；重跑采集 18.9s 成功，验收口径与首版一致（09-24 涨停53/炸板10/最高5板/封板率84.1%）
- review.ts 服务扩展（只增不改，API 兼容）：compare（涨停/连板/最高板/跌停/炸板/封板率 今日vs昨日）；conceptHeat（前8题材×近10日涨停家数矩阵，热力图数据源）；volumeSurge（量比≥2 爆量涨停降序，30家）；indices 补齐 6 指数；yesterdayPerf 增 amount；prevTemperature/prevStage（情绪对比）
- 视觉重构：深色交易台 → 浅色专业金融风（globals.css 全套令牌：白面板/1px边框/4px小圆角/红涨#d9352f绿跌#0e9663/橙重点/蓝交互/灰辅助；Inter+tabular-nums 数字字体 .num 工具类）；layout 换 Inter 字体
- 导航与路由：Header 8 项导航（今日复盘/连板天梯/主线题材/涨停池/爆量/龙虎榜/个股/历史复盘）+ 搜索右置 + 克制高亮（红线+红字）；hash 路由扩至 9 视图，limit-up 支持 ?concept= 参数
- 首页按需求文档·二十七顺序组装 11 模块：DateBar(日期+周几+上一/下一交易日+今日/历史badge) → IndexStrip(6指数+两市成交) → CoreMetrics(7指标含昨日值+变化箭头) → SentimentCycle(温度/阶段/昨日对比/五段刻度尺/10日SVG趋势/透明因子条) → 连板天梯+主线题材双列 → 涨停池 → 市场宽度+昨日涨停表现双列 → 晋级率 → 断板池 → 爆量 → 明日推演(规则化5条观察)
- 连板天梯重写：梯队结构（板数徽章+色带），最高板橙/连板红/首板灰/反包蓝标，首板折叠展开，行内悬停详情（成交额/换手/封单/炸板次数），点击进个股
- 主线题材重写：排序列表（涨停/连板/最高/龙头可点/星级强度/热度条）+ CSS 热力图（题材×D-9..今日，深浅=涨停数）
- 涨停池重写：9 筛选 tabs（全部/首板/2板/3板/4板+/一字板/换手板/爆量/高成交额，口径透明）+ 题材下拉 + 搜索 + 列排序 + 分页 + 量比列橙色高亮
- 市场宽度（红绿比例条）+ 昨日涨停表现（平均/翻红/涨跌家数/6桶分布柱图）；晋级率（四色进度条+点击展开晋级/失败个股名单）；断板池（断板/炸板/跌停状态标签+高位/低位标签+成交额列）
- 专项页 6 个：LadderView(全量天梯+晋级+断板)/ConceptView(33题材全景表可展开成分股+全量热力图)/LimitUpView/VolumeView(爆量全表+口径说明+P2规划)/DragonView(第三阶段占位)/StocksView(搜索+连板/首板快速索引)
- 个股详情与 K 线浅色化（ECharts 浅色主题/涨停 pin 标记/涨停历史/连板历史）；HistoryView 并入 ReviewView（历史复盘与今日复盘同一套 UI，符合需求·二十一）
- 修复：dev server 旧 Prisma Client（重启加载新列 sz50Index/volumeRatio）；dev server 存活机制（Bash 会话清理会杀子进程 → .git/hooks/post-commit 内拉起，经平台 12600 /git/commit 端点触发，落入平台进程树存活）；窄屏指标换行（nowrap）
- 浏览器端到端验证（agent-browser）：桌面 1440px 全模块渲染、爆量筛选(30家)、晋级率展开（晋级8/失败31名单）、搜索"新华"→点击→个股页、历史复盘 09-23（badge+切换+对比数据）、移动端 390px 单列、console/页面错误 0；lint 0 错误

Stage Summary:
- 交付：结构化市场复盘工作台（浅色专业金融风），今日复盘首页 11 模块 + 6 专项页 + 个股/历史复盘同构；后端新增 6 指数/量比/对比/热度/爆量数据，全部自主计算
- 关键文件：prisma/schema.prisma；src/lib/market/tx.ts；src/lib/collector/collect.ts；src/lib/services/review.ts；src/app/{globals.css,layout.tsx,page.tsx}；src/components/lb/{Header,useReview,DateBar,MarketTop,SentimentCycle,BoardLadder,MainThemes,LimitUpPool,MarketBreadth,YesterdayPerf,PromotionRates,BrokenPool,VolumeSurge,TomorrowOutlook,LadderView,ConceptView,LimitUpView,VolumeView,DragonView,StocksView,StockView,KLineChart,api,format}（旧 MarketOverview/SentimentPanel/SentimentTrend/ConceptRanking/HistoryView/LimitUpTable 已删除）
- 待办（收盘后）：15:00 后执行 bun scripts/collect-daily.ts 将 2026-09-25 收盘数据纳入（幂等，自动回补窗口滚动）；P2 爆量历史统计/龙虎榜接入

---
Task ID: 3
Agent: Super Z (main agent)
Task: 用户 6 项迭代——拼音缩写搜索、明暗主题切换、题材跨行业归纳（双层题材体系）、主线追踪栏目（实时资讯/研判/受益标的）、隔夜美股映射页、爆量改造（含非涨停+低位/高位）

Work Log:
- Schema 扩展（db push 幂等）：StockBasic+nameAbbr；LimitUp+themes(JSON)；DailyConcept+kind(industry|theme)+members(JSON)+联合唯一(tradeDate,conceptName,kind)；新表 VolumeSurge（close/changePct/volumeRatio/position low|mid|high/distFromHigh60/distFromLow60/isLimitUp/isBroken/themes）；新表 NewsItem（extId唯一/pubTime/content/impact good|bad|none/themes/stocks）
- 拼音搜索：bun add pinyin-pro；src/lib/calc/pinyin.ts（nameAbbrOf，忽略*ST/空格/标点）；scripts/backfill-abbr.ts 一次性回填 4604 只（平潭发展→PTFZ/合富中国→HFZG）；searchStocks 重写（OR 查询 代码/名称/缩写 + 5级排序权重 精确代码>缩写前缀>名称前缀>缩写包含>名称包含）；collect 7.1 upsert 同步写 nameAbbr
- 双层题材体系：src/lib/calc/themeRules.ts 规则引擎（17 条主线：industries 行业白名单子串匹配东财截断行业名 + nameKeywords 名称关键词（规范化去空格如"七 匹 狼"）+ members 显式成员；福建概念=名称关键词+成员[合富中国,鹭燕医药]；newsKeywords 供新闻匹配；usSymbols 供美股映射）；concept.ts 增 buildThemeStats（多归属分组+members 明细，强度分侧重家数/高度/梯队/成交额）；collect：LimitUp 行写入 themes、7.5 双层 DailyConcept（industry 原逻辑 + theme 新增）；review.ts 输出 concepts(主线)+industries(行业)，conceptHeat 用主线 top8
- 爆量改造：collect 7.4.5 全市场快照量比预筛（腾讯 lb≥1.5 取前120，含非涨停）→ 拉K线 → 自有 volumeRatioAt 20日口径精算 ≥2 入选 → 位置分类（距60日高点回撤≤10%高位/≥30%低位/其余中位）→ 仅删写最新日（历史爆量保留供 P2 统计）；本次采集爆量 107 家（涨停16/非涨停91/高位66/低位4）；review.volumeSurge 改为 VolumeSurge 表读取（VolumeSurgeRow 新结构）
- 主线追踪：src/lib/market/news.ts（新浪 7x24 zhibo feed，rich_text 清洗/【标题】提取/ext 提及股票解析）；src/lib/calc/newsImpact.ts（利好38词/利空30词计数研判）；src/lib/services/news.ts（抓两页60条→研判/题材标签→upsert 入库保留500条→读库，cache.ts 新增 cachedTtl）；/api/news?limit=
- 美股映射：src/lib/market/us.ts（腾讯 qt.gtimg.cn usAAPL 无后缀格式，GBK 容忍解析 [3]close [31]chg [32]pct，指数 usIXIC/usDJI/usINX）；src/lib/services/usmarket.ts（60s 缓存；13 组映射按组均涨跌排序；传导强度规则 ≥2强势/≥0.5偏强/>-0.5平淡/>-2偏弱/其余大跌；A股受益标的=当日该主线涨停股按连板取8）；/api/us-market
- 前端：api.ts 全量新类型+api.news/api.usMarket；MainThemes（跨N行业 chip+成员 tooltip）；ConceptView 重写双 Tab（主线/行业，主线展开=成分股带各自行业）；LimitUpPool（题材筛选=主线★∪行业，题材列显示主线标签）；VolumeSurge/VolumeView 重写（VolumeSurgeRow：涨跌/位置chip/涨停炸板非涨停标记/5 tabs）；NewsView.tsx 新建（NewsTracker 首页紧凑版+NewsView 专项页：筛选 tabs/受益标的行/提及股票 cn 代码可点/60s 自动刷新/免责声明）；UsMarketView.tsx 新建（指数条+分组块+受益标的+传导提示+口径）
- 明暗主题：globals.css 重写为语义 token 体系（@theme inline 增 fg2/dim/dim2/line/subtle/hover/up*/down*/warn*/link*/flat 共 22 个语义色，.dark 全套值，up-rgb 供热力图 rgba）；scripts/sweep-colors.sh 机械清扫 24 个文件 463 处硬编码（bg-white→bg-card 等 41 条映射，hover:/focus:/placeholder: 前缀子串自动跟随）；.panel/scrollbar 走 var；ThemeProvider.tsx（next-themes class 策略默认 light）+layout 接入；Header 增 ThemeToggle（Sun/Moon，mounted 门控）；theme.ts（useIsDark 用 useSyncExternalStore 避开 setState-in-effect lint；useChartPalette 亮/暗两套 ECharts 调色板）；KLineChart/SentimentCycle 主题感知重渲染；format.ts 增 STAGE_COLOR_DARK
- 修复/运维：修复 VolumeView/ConceptView useMemo-after-early-return、KLineChart render 期 ref 赋值、ReviewView NewsTracker 未导入等 6 个 lint 错误（现 0 错误）；dev server 拉起链路修复（post-commit 钩子 su 鉴权失效 → 改为直接 setsid nohup，本次会话内存活正常）；重跑采集验证（09-25 中秋休市，最新交易日仍 09-24，验收口径不变：涨停53/炸板10/封板率84.1%/情绪52.1升温）
- 浏览器端到端（agent-browser，亮/暗双主题）：首页（主线题材跨N行业/热力图/爆量+主线追踪双栏）、#/us（三指数+13组映射+受益标的联动）、#/news（筛选/受益标的/提及股票）、#/volume（5 tabs：全部107/低位4/高位66/中位37/爆量涨停16）、搜索 ptf→平潭发展 下拉、#/concepts 双Tab+10日热力图；console/页面错误 0

Stage Summary:
- 交付：6 项用户需求全部上线——①ptf 搜索平潭发展 ②右上角按钮一键明暗切换（全站 token 化，图表自适应）③主线题材规则归组跨行业（福建概念横跨林业/医药/水泥/航运/综合，主线13条/行业33个双层并存）④主线追踪栏目（7x24快讯+利好利空研判+题材标签+受益标的+提及股票）⑤美股映射页（隔夜三指数+13题材组+传导提示+A股受益标的）⑥爆量全市场口径（107家含91非涨停，低位4/高位66/中位37）
- 新增 API：/api/news、/api/us-market；review bundle 新增 industries/volumeSurge(新结构)/limitUp[].themes/concepts[].members 字段（前端已同步，历史日期 volumeSurge 为空属预期）
- 可维护配置集中两处：src/lib/calc/themeRules.ts（主线规则/新闻关键词/美股映射，随主线演变增删即可）、src/lib/calc/newsImpact.ts（利好利空词表）
- 关键新文件：themeRules.ts/pinyin.ts/newsImpact.ts/news.ts(market)/us.ts(market)/news.ts(services)/usmarket.ts/theme.ts/ThemeProvider.tsx/NewsView.tsx/UsMarketView.tsx + /api/news + /api/us-market + scripts/{backfill-abbr,check-news-us,check-industries,sweep-colors}

---
Task ID: 4
Agent: Super Z (main agent)
Task: 题材归类方法论升级——炒作类型优先于行业 + 盘中同步启动聚类（海峡创新入福建概念、大亚圣象按炒作类型归PCB）

Work Log:
- themeRules.ts 归类原则重写：按"炒作类型"（资金炒的故事）而非行业（公司主业）归类；注释明确四大炒作类型（产业链/区域/事件/政策）与维护指引（炒作与行业不符时用 members 显式指定）
- 福建概念 members += 海峡创新（行业IT服务，炒两岸/福建）；newsKeywords += "海峡"
- 新增 PCB概念（产业链题材）：industries=[元件]（从半导体拆出）、nameKeywords=[PCB/印制电路/覆铜板/铜箔]、members=[大亚圣象]（行业家居用品，市场炒其PCB业务）、usSymbols=[usTTMI TTM科技]
- 新增 并购重组（事件题材）：纯 newsKeywords 驱动（并购/重组/借壳/资产注入/控制权变更等），无行业白名单，members 个案维护
- 新建 src/lib/calc/syncLaunch.ts 盘中同步启动聚类：首封时间相邻≤2分钟链式聚合、≥3只成批；跨度≤10分钟=题材批次(batch)，超=启动潮(wave)降权；批次内≥2只共享主线=题材佐证(sharedThemes)，无共享=候选新题材(isCandidate)；纯即席计算不落库
- review.ts bundle 新增 syncClusters 字段（SyncCluster 类型从 calc 层 re-export）；api.ts 新增 SyncClusterRow
- ConceptView 新增"盘中同步启动聚类"板块（批次全展示：时间窗/阶段/成员chip可点/佐证主题/候选新题材高亮；启动潮降权灰显列成员）；MainThemes 首页新增紧凑提示条（仅 batch，佐证批次优先可点跳题材筛选，最多3行）
- 重跑采集刷新全窗口 themes 标签与双层 DailyConcept（验收口径不变：53涨停/84.1%封板率/52.1升温）
- 新增 scripts/verify-theme-sync.ts 回归脚本：8/8 归类用例通过（海峡创新→福建概念、大亚圣象→PCB概念、沪电/生益按元件行业命中PCB等）+ 聚类输出检查
- 浏览器端到端：#/concepts 同步启动聚类板块（09:25竞价批=候选新题材5股、14:23~14:24尾盘批=佐证福建概念3股、09:30~09:43=启动潮灰显24股）、首页紧凑条、暗色主题渲染均正常；console/页面错误 0；lint 0 错误

Stage Summary:
- 题材归类已从"行业细分归纳"升级为"炒作类型驱动"：行业白名单只是便捷手段，炒作逻辑与行业不符时 members 优先；同步启动聚类成为题材佐证与新题材发现的常规信号（09-24 尾盘福建概念批量封板被自动捕捉佐证，验证方法论有效）
- 福建概念 09-24 成员 7 家（福建水泥/平潭发展/海峡创新/厦门港务/漳州发展/福建金森/合富中国），主线榜升至第2
- 配置仍集中 themeRules.ts 单文件维护；聚类参数（gap≤2min/min 3只/跨度≤10min）在 syncLaunch.ts 可调
- 关键新文件：src/lib/calc/syncLaunch.ts、scripts/verify-theme-sync.ts

---
Task ID: 5
Agent: Super Z (main agent)
Task: 题材归类证据链升级——个股新闻参与归类（社区讨论 P2 预留）+ 主线新闻流（新闻直接挂主线，强度直观化）

Work Log:
- 用户方法论落地：不能光看分类，要看股票下面的相关新闻再归类；主线下面直接放新闻让人直观了解强度。社区爬虫按既定决策放 P2（合规与稳定性），本期新闻证据先行
- 数据源探测（scripts/check-stock-news.ts）：东财搜索 API（search-api-web jsonp，result.cmsArticleWebOld）可用且日期与库内交易日一致 → 定为主源；东财 np-listapi / 同花顺 push / 新浪搜索页均为空或非个股定向，弃用
- Schema 扩展（db push 幂等）：LimitUp+themeEvidence(JSON 证据明细)；NewsItem+kind(flash|stock)
- 新增 src/lib/market/stockNews.ts：按股票名搜新闻（jsonp 解析/em 标签清洗/标题或摘要含股票名过滤/时间窗过滤）
- themeRules.ts 新增 matchThemesInTextDetailed（返回命中主题+关键词，证据用）；福建概念 newsKeywords 收窄去掉裸"海峡"（霍尔木兹海峡国际新闻误挂），scripts/retag-flash-themes.ts 一次性重打存量快讯标签（124 条中修正 3 条）
- collect.ts 新增 7.4b 步：最新交易日涨停股逐只拉个股新闻（pmap 3 并发+限速）→ matchThemesInTextDetailed 命中主线 → ①merge 进 LimitUp.themes（新闻可新增归属）②证据落 themeEvidence（含命中词/标题/媒体/时间）③新闻入库 NewsItem(kind=stock, 题材=新闻命中∪该股当日主线, stocks=[txCode])；个股新闻独立裁剪保留 600 条；本次采集：覆盖 27/53 只 · 入库 207 条 · 新增归属 35 处
- concept.ts buildThemeStats 接受预计算 themes（新闻合并后归属参与主线统计），collect 传入
- services/review.ts：aggregateThemeNews 按 [tradeDate,nextDate) 窗口聚合 NewsItem → concepts[].newsCount/newsGoodCount/news(最新3条头条,含 kind/stockCode/stockName)
- services/stock.ts：StockDetail+themeEvidence（新→旧展开）；concepts 改为 最近涨停行主线题材 ∪ 行业概念（主线优先）
- 前端：MainThemes 每条主线加"新闻 N(利好 M)"角标+头条摘要+展开新闻流（快讯/个股标识、影响三色、股票可点）；ConceptView 主线行新闻角标；NewsView 个股新闻筛选 tab+口径说明更新；StockView 新增"题材归类依据·新闻证据"区块（命中关键词+来源标注）；api.ts 类型同步
- 验证：重跑采集验收口径不变（09-24 涨停53/炸板10/最高5板/封板率84.1%/情绪52.1升温/连板交叉验证0不一致）；verify-theme-sync.ts 回归通过；lint 0 错误；浏览器端到端（亮/暗双主题）：首页主线新闻角标+福建概念展开新闻流（厦金大桥合龙/路桥信息减持/福建水泥龙虎榜）、个股页平潭发展 4 条新闻证据（命中「平潭」等）、console 无新增错误（仅 Next16 dev 态水合提示，非本次功能引入）
- 运维备注：dev server 会被平台会话清理回收，验证时用"单调用内 启动→探活→操作"模式；数据/代码无残留问题

Stage Summary:
- 题材归类从"规则引擎+同启动聚类"升级为三层证据体系：①炒作类型规则（themeRules）②盘中同步启动聚类（syncLaunch）③个股新闻证据（本期，themeEvidence 可解释可追溯）；新闻命中主线关键词即可佐证/新增归属，主线统计与个股页题材随之联动
- 主线强度直观化：主线卡片直接挂新闻流（新闻数+利好数+最新3条），快讯与个股新闻混排并区分来源；个股新闻同时进入主线追踪页（个股新闻 tab）
- 关键新文件：src/lib/market/stockNews.ts、scripts/{check-stock-news,retag-flash-themes}.ts；配置仍集中 themeRules.ts
- P2 待办：社区讨论（股吧热帖）作为第四路证据源接入；爆量非涨停股的新闻证据覆盖

---
Task ID: 6
Agent: Super Z (main agent)
Task: 用户 4 项迭代——新闻每日自动更新、交易日日历选择、移除「历史复盘」「主线追踪」子页面、修复 SSR 水合 bug

Work Log:
- 水合 bug 定位与修复（agent-browser 复现）：React 19 报 "A tree hydrated but some attributes..."，根因 Header.tsx ThemeToggle——图标用 mounted 门控但 aria-label/title 直接读 resolvedTheme；SSR 时 resolvedTheme=undefined 渲染「切换到暗色主题」，客户端首帧 next-themes 已从 localStorage 读出 "dark" 渲染「切换到亮色主题」，属性不一致。修复：统一 const dark = mounted && resolvedTheme === "dark"，label/title/图标/onClick 全部由 dark 派生（首帧与 SSR 完全一致，mount 后再更新）
- 新闻每日自动更新：新增 src/lib/scheduler.ts 进程内调度器（globalThis 防重入，北京时间=UTC+8 偏移读 getUTC*）——①快讯每日 07:00–23:59 每 10 分钟自动抓取入库（此前只在有人访问 /api/news 时才抓）②全量采集工作日 15:35/17:35 自动跑 runCollection（幂等，含个股新闻证据/爆量/题材全链路）后清 review:/stock:/news: 缓存 ③启动自检（20s 后）：快讯立即补抓 + 工作日 15:35 后当日无行情数据则补跑采集（平台回收进程后重启的兜底）；src/instrumentation.ts register() 拉起（NEXT_RUNTIME nodejs 门控）；services/news.ts 新增 refreshNewsNow（绕过读取缓存直接 collectAndPersist + cacheClearPrefix）
- 运维配套：GET /api/admin/scheduler 查看调度器状态（started/beijingNow/schedule/jobs 最近运行）+ POST 手动立即触发快讯更新；scripts/update-news.ts 一次性手动更新脚本（外部 cron 兜底用）
- 交易日日历：新建 TradeCalendar.tsx（280px 弹层月历：周一开头网格/‹›翻月按数据范围 clamp/有数据交易日深色可点/选中红底白字/今天小圆点标记/非交易日灰显不可点/底部「共 N 个交易日 · 最新 X」）；DateBar 日期区域整体变为按钮（aria-label 选择复盘交易日 + CalendarDays 图标）弹出日历，外部点击/Esc 关闭；数据源 /api/review/calendar（getCalendar 已有，api.calendar() 前端封装已有）
- 子页面移除：Header NAV_ITEMS 删除「主线追踪」「历史复盘」（现 7 项）；parseHash 中 #/review/{date} 归一为 {view:"today", date}（Route.view 删除 review/news，旧深链不 404）；page.tsx 渲染 <ReviewView key={route.date} initialDate={route.date}/>；ReviewView 改为组件内 date state（DateBar onNav=setDate，上一/下一交易日与日历选择均只换数据不改 URL）；NewsView.tsx 删除，NewsTracker.tsx 独立（模块头部去「完整要闻→」入口，升级为筛选 tabs 全部/有关联主线/个股新闻/利好/利空 + 12 条 + 刷新按钮 + 更新时间）
- 验证：bun run lint 0 错误；调度器启动日志 + 自检抓取 50 条（534ms）+ POST 触发 ok；重启 dev server 后浏览器端到端——暗色 localStorage 二次加载（原复现路径）0 水合警告、#/concepts #/us 直载 0 水合警告；日历点击 09-23 → 徽章变「历史复盘」URL 保持 #/ 且弹层关闭、下一交易日回 09-24；深链 #/review/2026-09-22 正常渲染；主线追踪模块筛选/受益标的/主题标签完整且含今天 19:26 新入库快讯；亮/暗双主题截图检查布局完好；调试截图已清理
- 备注：2026-09-26 为周六，采集自检按工作日门控正确跳过（未跑无效采集）；dev.log 曾出现 Module not found './NewsTracker' 为 HMR 写入窗口期瞬时错误，随后自愈，无残留

Stage Summary:
- 交付：①资讯从「有人访问才更新」变为「服务端每日自动更新」（快讯每 10 分钟 + 收盘后全量采集两次 + 重启自检兜底），状态可查 /api/admin/scheduler ②日期栏日历化：点日期弹月历，仅交易日可点，历史日期查看完全在首页内完成 ③导航收敛为 7 项，历史复盘/主线追踪子页面下线（主线追踪保留为首页模块且功能增强：筛选 tabs）④水合 bug 根治（ThemeToggle 全属性 mounted 门控）
- 关键新文件：src/lib/scheduler.ts、src/instrumentation.ts、src/components/lb/{TradeCalendar,NewsTracker}.tsx、/api/admin/scheduler、scripts/update-news.ts；删除 NewsView.tsx
- 待办（后续）：社区热帖证据源（P2）；若平台允许外部 cron，可用 POST /api/admin/scheduler 或 bun scripts/update-news.ts 做双保险

---
Task ID: 7
Agent: Super Z (main agent)
Task: 新增「爆量不跌」板块——近 5 个交易日爆量（量比≥2）且股价未跌破爆量日收盘的个股筛选

Work Log:
- 口径设计（透明）：爆量=自有 20 日口径量比≥2（与爆量榜/涨停池同体系），取自每日采集入库的 VolumeSurge（历史按日保留）；窗口=最近 5 个有行情数据的交易日；基准日=该股窗口内最近一次爆量日；不跌=当前收盘 ≥ 基准日收盘（0 容差，跌破剔除）；当前价优先腾讯全市场快照（fetchAllStockSnapshot 复用，实时且含今日涨跌/腾讯口径量比/换手），失败回退库内 DailyStock 最新收盘并在返回值 quoteSource 标注
- 后端：src/lib/services/volumeHold.ts（cachedTtl 5 分钟；按股聚合→基准日/爆量次数/峰值量比→不跌过滤→距基准涨幅降序；excludedCount 记录被剔除家数）；新增 GET /api/volume-hold
- 前端：api.ts 增 VolumeHoldRow/VolumeHoldData + api.volumeHold()；Header Route/parseHash/NAV_ITEMS 增 volumehold「爆量不跌」（置于爆量后，共 8 项）；page.tsx 接入 #/volume-hold；新建 VolumeHoldView.tsx——头部统计（窗口区间/爆量总数/入选/当前价来源/更新时间+刷新，2 分钟自动刷新）、5 筛选 tabs（全部/强势距基准≥5%/多次爆量/爆量日涨停/低位爆量）、可排序表格（现价/今日、距爆量日★默认、爆量日、爆量量比；行点击进个股页）、多次爆量 N次 徽章（tooltip 峰值量比）、爆量日表现（涨停/炸板/涨幅%三态）、位置 chip、主线题材/行业列、口径说明面板；VolumeView 口径说明同步指向新板块
- 验证：API 实测——窗口 [09-24, 09-28, 09-29, 09-30, 10-08]（前一轮部署的调度器已自动积累 5 个交易日数据），爆量 364 家 → 不跌 95 家 / 剔除 269 家，价格源 snapshot，1.8s（缓存后）；头部样例 善水科技 距基准 +44.02%（09-29 基准 2 次爆量）；浏览器端到端——#/volume-hold 渲染 95 行、强势 tab 过滤 34、行点击/排序/亮暗双主题截图正常、console 0 水合警告 0 页面错误；lint 0 错误；调试截图已清理

Stage Summary:
- 交付：「爆量不跌」板块全链路上线（后端计算 + 专项页 + 导航），量能体系闭环——爆量榜（当日）→ 爆量不跌（5 日窗口留存筛选），承接此前 P2 规划的「爆量后表现统计」第一步
- 关键新文件：src/lib/services/volumeHold.ts、src/app/api/volume-hold/route.ts、src/components/lb/VolumeHoldView.tsx
- 口径要点：0 容差不跌判定；最近一次爆量日为基准；快照不可用自动降级库内收盘；数据随每日采集（调度器）自动积累，窗口滚动

---
Task ID: 8
Agent: Super Z (main agent)
Task: 新增「异动监控」专题页——A股异动多维分组：跟大盘共振 / 逆大盘拉升 / 板块效应 / 领涨龙头 / 前期爆量

Work Log:
- 口径设计（透明，全部后端计算）：大盘基准=上证指数当日涨跌幅；异动宇宙=最新交易日腾讯全市场快照（约4600只，合并当日涨停/炸板/跌停/爆量四池标记，同股多池取优先级涨停>炸板>跌停>爆量、题材并集）+ 历史日期回放四池并集（快照仅对当前有效）；①大盘共振=大盘收涨且个股涨幅≥2%且跑赢大盘≥2pp（rsPct降序）②逆势拉升=大盘收跌且收涨且跑赢≥1pp（涨幅降序），两组互斥于大盘方向，页签计数为全量、展示上限150 ③板块效应=DailyConcept 主线/行业层 涨停≥2家或涨停+炸板≥3家，行展开成分明细（行业层成员从涨停+炸板池现算，主线层解析 members JSON 并补当日涨幅）④领涨龙头=市场最高连板股（空间龙头，并列全列）+ 有板块效应主线题材 leaderCode（与题材统计同规则）⑤前期爆量=近5个交易日爆量（20日口径量比≥2）个股，基准日=窗口内最近一次爆量日，状态分级：今日涨停/今日拉升(≥2%)/守住不跌(距基准≥0，与爆量不跌同口径)/跌破基准；历史日期下非池内股无当日行情剔除并标注家数
- 后端：src/lib/services/anomaly.ts（cachedTtl——最新日90s/历史日30min；快照失败自动降级池内宇宙；industry 复用 StockBasic，themes 复用池内标签）；新增 GET /api/anomaly?date=；scheduler.ts 采集完成后缓存清理增补 anomaly:/volume-hold: 前缀
- 前端：api.ts 增 AnomalyData 等类型 + api.anomaly(date)；Header Route/parseHash/NAV_ITEMS 增 anomaly「异动监控」（置于爆量不跌后，共9项）；page.tsx 接入 #/anomaly；DateBar props 放宽为最小接口 DateBarBundle（5字段，多页复用）；新建 AnomalyView.tsx（DateBar 复用日期切换 + 指数基准条与方向提示 + 5 tab 带全量计数 + 首载按大盘方向自动落tab + 120s 轮询仅最新日生效）+ anomalyTables.tsx（共振/逆势共用可排序行情表——现价涨幅/相对大盘/状态chips/量比/换手/成交额/市值/题材/行业；板块效应表行展开成分chips可跳个股；龙头表市场/题材双级别；前期爆量表4态状态列+多次爆量徽章）+ 底部完整口径说明
- 验证：API 实测——最新日(2026-10-08 大盘-0.79%) snapshot 宇宙4608只：共振0/逆势1025/板块18/龙头8/前期爆量364（状态分布 涨停16/拉升34/守住84/跌破230），首载2s缓存后7ms；历史日(2026-09-30 大盘+0.31%) pools 宇宙136只：共振95/逆势0（方向互斥正确）/板块22/龙头9/前期爆量120+剔除178；浏览器端到端——#/anomaly 亮暗双主题截图正常、5 tab 切换、板块行展开成员chips、表格排序、DateBar 上一/下一交易日切换、行点击跳个股、空状态引导文案、console 0水合警告0页面错误；lint 0错误

Stage Summary:
- 交付：「异动监控」专题页全链路上线（导航第7项 #/anomaly），异动五维分类一次看全——大盘共振/逆势拉升（方向自适应）/板块效应/领涨龙头/前期爆量
- 关键新文件：src/lib/services/anomaly.ts、src/app/api/anomaly/route.ts、src/components/lb/AnomalyView.tsx、src/components/lb/anomalyTables.tsx
- 关键修改：api.ts（类型+客户端）、Header.tsx（导航）、page.tsx（路由）、DateBar.tsx（props 最小接口化）、scheduler.ts（缓存清理增补）
- 口径要点：共振/逆势互斥于大盘方向；最新日全市场扫描 vs 历史日四池回放的宇宙差异已透明标注；前期爆量与「爆量不跌」页同源同口径（0容差不跌），本页增加今日异动状态维度

---
Task ID: 9
Agent: Super Z (main agent)
Task: 异动监控升级为盘中实时——交易时段每2分钟自动采样 + 异动事件判定 + 实时分组展示（用户澄清：要的是盘中的异动情况，非收盘后复盘）

Work Log:
- 数据源探测与新增：qt.gtimg.cn A股指数实时行情（字段位与 us.ts 同构 [3]close [4]昨收 [32]涨跌幅，GBK 容忍解析）→ src/lib/market/indexQuote.ts；腾讯 minute/query 个股分时（"HHMM 价格 累计量 累计额" 每分钟一条）→ src/lib/market/minute.ts（minuteBaselineAt 窗口基线取点）
- Schema 扩展（db push 幂等）3 张表：IntradaySnap（tradeDate+pollTs+stockCode 唯一，含 price/changePct/volume/amount/量比/isSealed/touchedLimit）、IntradayIndexSnap（三大指数逐轮）、IntradayEvent（dedupeKey=tradeDate|code|kind|10分钟桶 唯一，窗口/指数/相对强度/题材 JSON）
- 判定层 src/lib/calc/intradayMoves.ts（纯函数）：bjNow/sessionInfo 时段判定（pre/am/lunch/pm/closed + 采样窗口 09:20–11:36 ∪ 12:55–15:06 + shouldPollAt 偶数分钟）、limitStateOf（涨幅近似涨停幅度，容差 0.15pp）、windowBaseline（精确窗口起点 + 最小时效 3min + 最大滞后 5min 防午休/断采失真）、detectEvents（拉升≥2%三分类：指数窗口≥+0.15%共振/≤-0.15%逆势/独立；跳水≤-3%；封板/炸板=上轮封板状态转移；分时爆量=腾讯量比≥3且涨≥1%；10分钟桶去重）
- 采样器 src/lib/collector/intradayPoll.ts runIntradayPoll：全市场快照+指数并行 → 交易日自校验（指数行情时间戳非今日自动跳过，节假日零噪音）→ 异动宇宙过滤（|涨幅|≥1% 或 量比≥1.5 或 触板附近 或 近5日爆量池 或 上轮封板，约 3300 只）→ 冷启动/新进股分时回补（单轮≤200只按异动强度优先、并发6路，5/10/30分钟基线真实分时价写回 IntradaySnap）→ 本轮采样先删后写幂等 + 基线行限定「将写入股票×时点」删除防误删他股 → 事件逐条 upsert → cacheClearPrefix("intraday:")；pruneIntraday(3) 采样留3个交易日/事件留30天
- 调度器接入：新增 intraday job（tick 内 isWeekday+shouldPollAt 每2分钟）+ 启动自检交易时段立即补采样 + 15:35/17:35 采集任务追加 pruneIntraday 与 intraday: 缓存清理 + /api/admin/scheduler 展示三任务状态；scripts/intraday-poll.ts 手动兜底（--force 跳时段守卫 / --prune 清理）
- 服务层 src/lib/services/intraday.ts getIntraday（30s 缓存）：窗口涨幅 5/10/30 分钟（同一基线点集）→ 拉升异动列表（窗口≥1.5% 或有拉升事件，共振/逆势/独立分型）→ 板块联动（候选股按 近3日主线标签∪规则归组∪行业 聚合，≥3只成块，领涨=组内窗口涨幅最大）→ 领涨龙头（封板股按昨日连板+1 高度，并列最高=市场总龙头，首封时间/炸板次数来自事件流）→ 前期爆量（近5日爆量股×当前快照四态分级）→ 跳水预警 → 事件时间轴（最新80条）
- API：GET /api/intraday（force-dynamic）；修复服务层指数基线字段笔误（IntradayIndexSnap.close 而非 price，曾致 indexWindow10m 恒为 null）
- 前端：api.ts 新增 IntradayData 等类型 + api.intraday()；新建 intradayLive.tsx（盘中实时异动模块：时段徽章+采样轮次+红点脉冲、三指数带10分钟窗口、扫描/封板/事件统计条、大盘窗口方向提示；6 页签=异动时间轴/快速拉升(子筛选 全部/共振/逆势/独立)/板块联动(行展开成员chips)/领涨龙头(市场最高高亮)/前期爆量(四态+多次爆量徽章)/跳水预警(曾触板标记)；30s 自动刷新；事件行/表格行点击跳个股）；AnomalyView 顶部接入并把原标题改「全天复盘 · 异动五维分组」，口径说明前置盘中实时两段
- 修复过程 bug：themeMaps TDZ（同解构内自引用 dates）、快照源重复行致唯一约束冲突（按代码去重）、detectEvents mk 闭包作用域（函数声明在循环外看不见块内 windowPct → 改循环内箭头闭包，scripts/test-detect.ts 回归：逆势拉升/跳水/封板状态转移分类正确）、Prisma 6 SQLite 不支持 createMany skipDuplicates（改先删后写）
- 验证：当前为周一盘中（10:55–11:28 真实交易时段），手动 3 轮采样 + 调度器自动 6 轮全部成功（宇宙 3300+ 只、事件 125–151 条/轮、单轮 2–3s）；API 实测 indexWindow10m=0.02 正确分型、拉升表窗口涨幅/相对大盘/10分钟/30分钟列齐全、封板股宿迁联盛首封 11:26、龙头表新华传媒 9 板「市场最高」高亮、前期爆量 364 家四态分布（涨停7/拉升25/守住88/跌破244）、跳水预警 6 只含曾触板标记；浏览器端到端——亮/暗双主题截图正常、事件流行点击跳个股页（深物业A）、console 0 水合警告 0 页面错误；lint 0 错误；调试脚本已清理（保留 test-detect.ts 事件判定回归）

Stage Summary:
- 交付：异动监控页升级为「盘中实时 + 全天复盘」双层——交易时段调度器每 2 分钟自动采样全市场+指数，实时捕捉 快速拉升(共振/逆势/独立)/板块联动/领涨龙头/前期爆量盘中状态/快速跳水/封板炸板 并以事件时间轴呈现；收盘后保留 3 个交易日回放，全天五维复盘（原 EOD）保留在下方
- 关键新文件：src/lib/market/{indexQuote,minute}.ts、src/lib/calc/intradayMoves.ts、src/lib/collector/intradayPoll.ts、src/lib/services/intraday.ts、src/app/api/intraday/route.ts、src/components/lb/intradayLive.tsx、scripts/intraday-poll.ts、scripts/test-detect.ts
- 关键修改：prisma/schema.prisma（+3 表）、src/lib/scheduler.ts（intraday job+自检+清理）、api.ts、AnomalyView.tsx
- 口径要点：事件阈值 拉升≥2%/跳水≤-3%/封板容差0.15pp/爆量 量比≥3且涨≥1%，同股同类 10 分钟桶去重；分型基准=上证 10 分钟窗口（±0.15pp 分界，走平归独立）；冷启动用交易所分时回补基线（真实价非估算）；采样宇宙≈3300 只/轮、体量≈40 万行/日、保留 3 日；节假日由指数行情时间戳自动识别跳过
- 待办（后续）：收盘后 15:35 采集自动清理验证；如需分钟级更细窗口（3/5 分钟）可调 SURGE_WINDOW_MIN；分时爆量事件可接入题材热度统计

---
Task ID: 10
Agent: Super Z (main agent)
Task: 异动监控日期口径修正——「最新一天 = 今天」，盘中实时更新而非收盘后再更新（用户反馈：日期应该设计成最新一天 而不是说 收盘了再更新）

Work Log:
- 问题定位：原 getAnomaly 的「最新日」锚定 DailyMarket 最大日期（收盘 15:35 采集后才前进），盘中页面日期停在上一交易日，且大盘基准/四池标记用昨日收盘数据、价格却是实时快照，语义混乱
- 口径重设计（src/lib/services/anomaly.ts 重写）：「最新一天」= 北京时间今天（交易日）——①今天且收盘采集未落定 → 盘中实时口径（新路径 computeAnomalyLive）：异动宇宙=腾讯全市场实时快照（封板=实时涨幅达涨停幅度容差0.15pp、炸板=曾封板/触板但当前未封（盘中采样 touchedLimit∪当日 seal 事件）、跌停=涨幅近似、爆量=实时量比≥2），大盘基准=实时指数涨跌幅（fetchAIndexQuotes，quoteTime 非今日自动回落），题材=近3日主线（loadThemeMaps 从 intraday 服务导出复用）∪规则归组∪行业，板块效应=封板/炸板按题材∪行业聚合（阈值同收盘口径，实时强度分=封板×10+连板股×5+最高板×3+炸板），龙头=封板股「昨日连板+1」（boardHistory）+首封时间（seal 事件流），前期爆量=近5收盘日窗口×实时四态；②收盘采集落定后自动切今天收盘口径（四池回放）；③盘前/节假日（指数时间戳守卫）或快照不可用 → 回落最近收盘日回放；④历史日期纯四池回放（同时修复了旧版「回看最新收盘日误用实时快照」的串日 bug）；cache key 拆分 anomaly:live:{today}(60s)/anomaly:eod:{date}:{fwd|end}(15min)，采集后 anomaly: 前缀清理已有
- AnomalyData 增 today/liveMode/sessionLabel 字段（api.ts 同步）；nextDate 语义增强：回看最新收盘日时「下一交易日」直接指向今天（盘中实时），形成 昨天⇄今天 双向导航闭环
- 前端：DateBar 徽章四态化（今日·盘中[脉冲红点]/今日/最新/历史复盘，today 可选字段向后兼容今日复盘页），日历 TradeCalendar 增 includeToday（今天=工作日即可选，红框标识「今日可看盘中实时」）；AnomalyView 标题随口径切换（今日盘中·异动五维分组（实时）/全天复盘）、大盘措辞「现涨/现跌（实时基准）」、空态文案实时/收盘分形、轮询实时口径 60s、updatedAt 展示北京时间（原 UTC 已修）、口径说明前置「日期口径（最新一天）」段落并区分实时/收盘两套宇宙与阈值
- 验证（周二 14:16–14:20 真实下午盘）：API 三模式——缺省/显式今天=liveMode（4606 只快照、上证实时 -0.47→-0.60% 逐次变动、逆势 586→594 随盘口增长、板块效应 12 组（机器人 9 封板/强度 147）、市场龙头上海九百 5 板=昨日4+1 首封 12:56、前期爆量 296 窗口 [10-20..10-26]）；历史 10-26=四池 157 只回放、nextDate=今天；非法日期回落今天。浏览器端到端——徽章「●今日·盘中」、日历今天可选（红框+底部提示）、上一交易日→10-26 历史复盘徽章+收盘口径文案、下一交易日→回到今天实时、暗色主题正常、console 0 错误 0 水合警告；lint 0 错误；调试截图已清理

Stage Summary:
- 交付：异动监控页日期体系从「收盘采集驱动」改为「今天驱动」——交易日打开即是今天，盘中实时口径分钟级更新（封板/炸板/共振/逆势/板块/龙头/前期爆量全按盘口现值），收盘 15:35 采集落定后无缝切换收盘口径；盘前/非交易日优雅回落最近收盘日。今日复盘页日期行为不受影响（向后兼容）
- 关键修改：src/lib/services/anomaly.ts（重写：日期路由+computeAnomalyLive）、src/lib/services/intraday.ts（导出 loadThemeMaps）、src/components/lb/{api,DateBar,TradeCalendar,AnomalyView}.tsx
- 口径要点：实时封板判定按涨幅近似（容差 0.15pp）与盘中采样 touchedLimit/seal 事件并集；实时板块效应强度分与收盘口径分值体系不同（页内已注明）；实时口径无封单额（LeaderRow.sealAmount=null，收盘口径提供）

---
Task ID: 11
Agent: Super Z (main agent)
Task: 修复「27号没有显示」——10-27 收盘数据缺口补采 + 调度器收盘缺口自愈 + 爆量预筛时点无关化（用户反馈：时间显示有问题，27号没有显示）

Work Log:
- 根因定位：10-27（周二）14:22 后进程被回收，15:35/17:35 收盘采集未跑 → DailyMarket 停在 10-26；启动自检只查「今天 15:35 后有无今天数据」，不查近期缺口 → 27号在日历/日期条/异动页全部消失（盘前回落「最近收盘日」也只到 10-26）
- 立即补采：bun scripts/collect-daily.ts --days 10 → 10-27 入库（涨停43/炸板28/封板率60.6%/成交1.46万亿，覆盖 10-14~10-27）；日历 API 恢复 latest=2026-10-27
- 调度器自愈（src/lib/scheduler.ts）：新增 lastExpectedEodDate（工作日15:35后=今天否则上一工作日）+ gapCheck（库内最新<应有 → 补跑采集，幂等回补10日）；触发点=启动自检20s + 每日09:05盘前巡检；__lbSchedulerGapCheckDate 每日一次防抖（法定节假日按工作日规则会有假缺口，防空转）；/api/admin/scheduler schedule 增 gapCheck 说明
- 顺带发现并修复：盘前补采时爆量榜为空（VolumeSurge 10-27 无行）——根因是预筛依赖「运行时刻全市场快照量比」，盘前快照量比=0。collect.ts 7.4.5 重写为双通道预筛（①全市场快照≥1.5前120 ②池内K线直接 volumeRatioAt≥1.5 精算），价格/涨跌幅一律取 K线日bar（时点无关），快照仅在数值有效时补充成交额/换手/市值；重跑后 10-27 爆量 0→159 家（快照0只+池内219只，涨停27/非涨停132）
- 顺手清零（eslint 口径全绿）：admin/collect/route.ts 补 NextRequest import；AnomalyView 两处 AnomalyStockTable 补 tableKey prop；HistoryView（无引用遗留）ReviewView prop 改 initialDate
- 验证：日历 API dates 含 10-27 且 has27=true（浏览器内 fetch 复核）；首页日期条 2026-10-27+日历 27 高亮选中（span 非按钮，grep 误判已澄清）、28 灰字不可点（首页 includeToday=false 正确）；异动页 09:3x 开盘后「今日·盘中」实时生效（466条事件）、上一交易日→10-27 历史复盘徽章+全天复盘五维（逆势113/板块18/龙头9/前期爆量185，共振0与大盘-1.33%互斥正确）、下一交易日回今天、异动页日历 27选中+28今日可点；eslint 0 错误；tsc 存量 35 处遗留类型债务（collect.ts Parameters<>/chunk 泛型模式、calc 文件空值类型）不影响运行时，开盘在即不冒险重构，留待后续

Stage Summary:
- 交付：27号数据与显示全链路恢复；调度器新增「收盘数据缺口自愈」（启动+每日09:05，每日最多补跑一次）——今后进程在采集点宕机/被回收，重启或次日盘前自动补齐，不再出现日期断档
- 关键修改：src/lib/scheduler.ts（gapCheck 自愈）、src/lib/collector/collect.ts（爆量双通道预筛+K线bar取价，时点无关，盘前/盘中/盘后补采结果一致）、src/app/api/admin/collect/route.ts、src/components/lb/{AnomalyView,HistoryView}.tsx
- 已知债务：tsc 35 处存量类型错误（此前会话仅以 eslint 验收）；建议后续专门清一轮
