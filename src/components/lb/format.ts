// 展示格式化工具（A股习惯：红涨绿跌 · 浅色主题）

export function fmtYi(amount?: number | null, digits = 2): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return (amount / 1e8).toFixed(digits);
}

export function fmtPct(p?: number | null, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}

export function pctClass(p?: number | null): string {
  if (p == null || !Number.isFinite(p) || p === 0) return "text-flat";
  return p > 0 ? "text-up" : "text-down";
}

export function fmtNum(n?: number | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtRate(r?: number | null, digits = 1): string {
  if (r == null || !Number.isFinite(r)) return "—";
  return `${(r * 100).toFixed(digits)}%`;
}

/** 有符号数字：+2 / -3 / 0（核心指标环比变化用） */
export function fmtDelta(n?: number | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Number(n.toFixed(digits));
  return v > 0 ? `+${v}` : `${v}`;
}

/** 情绪阶段主色（克制：低温蓝 → 高温红，重点用橙；暗色用提亮变体） */
export const STAGE_COLOR: Record<string, string> = {
  冰点: "#2563eb",
  修复: "#0e9663",
  升温: "#e8850c",
  高潮: "#d9352f",
  极强: "#b91c1c",
};

export const STAGE_COLOR_DARK: Record<string, string> = {
  冰点: "#5b8def",
  修复: "#0ecb81",
  升温: "#f5a623",
  高潮: "#f6465d",
  极强: "#f87171",
};

export function stageColor(stage: string, dark = false): string {
  const map = dark ? STAGE_COLOR_DARK : STAGE_COLOR;
  return map[stage] ?? (dark ? "#f5a623" : "#e8850c");
}

/** 状态标签（浅色系） */
export const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  promoted: { text: "晋级", cls: "bg-up-soft text-up border-up-soft" },
  break: { text: "断板", cls: "bg-muted text-muted-foreground border-line" },
  broken: { text: "炸板", cls: "bg-warn-soft text-warn-strong border-warn-soft" },
  limitdown: { text: "跌停", cls: "bg-down-soft text-down border-down-soft" },
  suspended: { text: "停牌", cls: "bg-muted text-dim border-line" },
};

/** 连板天梯颜色体系（方案：突出梯队结构，不做彩色列表）
 *  最高板=强调橙 / 普通连板(2板+)=主红 / 首板=中性灰 / 断板=低透明灰 */
export function boardTierClass(boardCount: number, highest: number): {
  label: string; labelCls: string; dotCls: string; nameCls: string;
} {
  if (boardCount >= highest && highest >= 2) {
    return {
      label: `${boardCount}板`,
      labelCls: "text-warn-strong bg-warn-soft border-warn-soft",
      dotCls: "bg-warn",
      nameCls: "text-foreground font-semibold",
    };
  }
  if (boardCount >= 2) {
    return {
      label: `${boardCount}板`,
      labelCls: "text-up bg-up-soft border-up-soft",
      dotCls: "bg-up",
      nameCls: "text-foreground",
    };
  }
  return {
    label: "首板",
    labelCls: "text-muted-foreground bg-muted border-line",
    dotCls: "bg-flat",
    nameCls: "text-fg2",
  };
}

/** 交易日 → 周几（中文） */
export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
}
