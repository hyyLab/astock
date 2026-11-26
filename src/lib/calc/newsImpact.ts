// ============================================================
// 快讯利好利空研判（透明关键词规则，非投资建议）
// 正面词命中数 > 负面词命中数 → good；反之 bad；否则 none
// 词表维护在本文件，随市场语境演进增删
// ============================================================

const GOOD_WORDS = [
  "利好", "涨价", "提价", "增长", "超预期", "中标", "签约", "合作", "出台", "支持",
  "补贴", "回购", "增持", "获批", "批准", "突破", "签署", "创新高", "预增", "扭亏",
  "订单", "扩产", "投产", "重组", "注入", "政策支持", "减税", "降准", "降息", "促消费",
  "以旧换新", "繁荣", "回暖", "改善", "加速", "放量", "需求旺盛", "供不应求", "景气", "两会",
];

const BAD_WORDS = [
  "利空", "下跌", "减持", "质押", "处罚", "立案", "退市", "亏损", "预亏", "下滑",
  "警告", "风险提示", "下调", "裁员", "诉讼", "违约", "逾期", "冻结", "调查", "问询",
  "停产", "事故", "爆炸", "召回", "减持计划", "解禁", "跌停", "崩", "危机", "制裁",
  "加征关税", "反倾销", "疫情", "暴雨", "地震", "资不抵债", "平仓",
];

export interface ImpactResult {
  impact: "good" | "bad" | "none";
  goodHits: string[];
  badHits: string[];
}

export function analyzeImpact(text: string): ImpactResult {
  const goodHits = GOOD_WORDS.filter((w) => text.includes(w));
  const badHits = BAD_WORDS.filter((w) => text.includes(w));
  let impact: ImpactResult["impact"] = "none";
  if (goodHits.length > badHits.length) impact = "good";
  else if (badHits.length > goodHits.length) impact = "bad";
  return { impact, goodHits, badHits };
}
