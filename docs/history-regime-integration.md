# 历史窗口扩展：分层分析待接线清单

## 已准备的数据
- MarketRegimeTag：逐日 phase（WEAK/TREND/RANGE/UNKNOWN）、sentimentTag、20 日上证斜率、tagVersion。
- SentimentDaily：调用现有 calcSentiment；历史 upCount/downCount 为 NULL。
- DailyStock：仅写涨停/炸板/跌停池内日 K，带 rowOrigin/dataQuality/fieldVersion。
- LimitUp 与 BoardHistory：完整交易日序列调用 computeBoardChain 整链生成。

## 下一期接线（本期不改）
1. route.ts 的 UNCLASSIFIED 分组保持不动；下一期按 MarketRegimeTag.phase 分层。
2. 不修改 bayes/*、策略公式、FDR、HDI、prior、posterior 或 regime 权重；条件先验另行设计审查。
3. API 增加 phase 维度 n/mean/interval/selectedIds，前端提供弱市抱团与趋势扩散对照。
4. 逐战法披露有效窗口；依赖 sealAmount/floatMarketCap 的战法历史字段为 NULL。
5. 样本不足时明确显示样本不足，并验收连续相位长度和标签版本漂移。

## v1 描述性标签
TREND：20 交易日上证涨幅 >3%；WEAK：跌幅 <-3%；RANGE：其余；不足 20 日 UNKNOWN。情绪标签沿用现有五态映射。历史涨跌家数缺失，不代表完整市场广度评分。

## 硬禁区
不修改 bayes/*、策略公式、route.ts UNCLASSIFIED、detectBarStatus、limitPctOf、computeBoardChain、calcSentiment；不回填 Shadow*、IntradaySnap、IntradayIndexSnap、IntradayEvent、VolumeSurge、NewsItem。
