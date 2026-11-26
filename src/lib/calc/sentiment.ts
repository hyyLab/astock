// ============================================================
// 情绪指标（方案第十一步）
// 第一版使用完全透明的自有规则，不声称等同任何网站的"情绪温度"。
// 温度 = Σ(权重 × 标准化分量) − 跌停惩罚，区间 0~100
// 后续可用历史数据回测调整权重。
// ============================================================

export interface SentimentInputs {
  limitUpCount: number;
  limitDownCount: number;
  brokenCount: number;
  highestBoard: number;
  yesterdayLimitAvg: number | null; // 昨日涨停股今日平均涨跌幅 %
  upCount: number | null; // 上涨家数（历史回补日可能缺失）
  downCount: number | null;
}

export interface SentimentComponent {
  label: string;
  weight: number; // 权重（满分100体系内）
  value: number | null; // 0-1 标准化结果
  detail: string; // 人类可读解释
}

export interface SentimentResult {
  temperature: number; // 0-100
  stage: string; // 冰点 / 修复 / 升温 / 高潮 / 极强
  components: SentimentComponent[];
  penalty: number; // 跌停惩罚 0-20
}

/** 封板率 = 最终封住涨停数 / (最终涨停数 + 炸板数)（方案第十步统一口径） */
export function sealRateOf(limitUpCount: number, brokenCount: number): number {
  const denom = limitUpCount + brokenCount;
  return denom > 0 ? limitUpCount / denom : 0;
}

/** 炸板率 */
export function brokenRateOf(limitUpCount: number, brokenCount: number): number {
  const denom = limitUpCount + brokenCount;
  return denom > 0 ? brokenCount / denom : 0;
}

export function stageOf(t: number): string {
  if (t < 20) return "冰点";
  if (t < 40) return "修复";
  if (t < 60) return "升温";
  if (t < 80) return "高潮";
  return "极强";
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function calcSentiment(inputs: SentimentInputs): SentimentResult {
  const {
    limitUpCount,
    limitDownCount,
    brokenCount,
    highestBoard,
    yesterdayLimitAvg,
    upCount,
    downCount,
  } = inputs;

  const sealRate = sealRateOf(limitUpCount, brokenCount);

  const components: SentimentComponent[] = [
    {
      label: "涨停强度",
      weight: 25,
      value: clamp01(limitUpCount / 100),
      detail: `涨停 ${limitUpCount} 家（100家封顶）`,
    },
    {
      label: "连板高度",
      weight: 20,
      value: clamp01(highestBoard / 8),
      detail: `最高 ${highestBoard} 板（8板封顶）`,
    },
    {
      label: "封板质量",
      weight: 20,
      value: clamp01(sealRate),
      detail: `封板率 ${(sealRate * 100).toFixed(1)}%（炸板 ${brokenCount} 家）`,
    },
    {
      label: "昨日涨停表现",
      weight: 15,
      value: yesterdayLimitAvg === null ? null : clamp01((yesterdayLimitAvg + 5) / 10),
      detail:
        yesterdayLimitAvg === null
          ? "无昨日数据"
          : `昨日涨停今日均涨 ${yesterdayLimitAvg.toFixed(2)}%（-5%~+5% 线性映射）`,
    },
    {
      label: "涨跌家数比",
      weight: 20,
      value:
        upCount === null || downCount === null
          ? null
          : clamp01(upCount / Math.max(downCount, 1) / 5),
      detail:
        upCount === null || downCount === null
          ? "缺少全市场快照"
          : `上涨 ${upCount} / 下跌 ${downCount}`,
    },
  ];

  const available = components.filter((c) => c.value !== null);
  const availableWeight = available.reduce((s, c) => s + c.weight, 0);
  const positiveSum = available.reduce((s, c) => s + c.weight * (c.value as number), 0);

  // 有缺失分量时按可用权重归一化到 0-100，保证历史日温度可比
  const positive = availableWeight > 0 ? (positiveSum / availableWeight) * 100 : 0;

  const penalty = 20 * clamp01(limitDownCount / 30); // 跌停30家惩罚封顶
  const temperature = Math.min(100, Math.max(0, positive - penalty));

  return {
    temperature: Math.round(temperature * 10) / 10,
    stage: stageOf(temperature),
    components,
    penalty: Math.round(penalty * 10) / 10,
  };
}
