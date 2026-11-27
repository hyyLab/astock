# 历史回补字段映射与数据质量

| 字段 | 历史来源 | canonical 口径 |
|---|---|---|
| OHLC/volume/amount/turnoverRate/changePct | 东财 push2his f52-f61 | 精确日线；腾讯 320 根校验 OHLC |
| firstLimitTime/lastLimitTime | 历史分钟数据不可得 | NULL + MISSING |
| sealAmount | 历史封单快照不可得 | NULL + MISSING |
| openCount | 日 K 无法还原盘中开板次数 | -1 哨兵 + MISSING |
| floatMarketCap | 历史流通股本不可可靠重建 | NULL，不估算 |
| sourceBoard/daysAndBoards | 不采信历史池外推 | NULL |
| themes | matchThemes 规则引擎 | 规则重算；新闻增强字段 NULL |
| upCount/downCount/flatCount | 实时快照才可得 | NULL + MISSING |
| boardCount/promotion/rebound | computeBoardChain 整链 | 自主计算 |
| sentiment | calcSentiment，up/down=NULL | 可用权重归一化 |

rowOrigin=LIVE/BACKFILL；fieldVersion=history-v2。DailyStock 只写池内股票；全市场 K 线只在内存处理。严禁回填 Shadow* 与盘中/新闻/爆量历史表。

封单强度战法依赖 sealAmount/floatMarketCap，只能使用有真实值的样本。其余战法的有效窗口需按字段非空后的实际样本数核验，不得统一宣称 220 天。
