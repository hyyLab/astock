// ============================================================
// 股票名称拼音首字母（搜索增强）
// 例：平潭发展 → PTFZ；合富中国 → HFZG；鹭燕医药 → LYYY
// 用户输入 "ptf" 即可命中 "PTFZ"（contains 匹配）
// ============================================================

import { pinyin } from "pinyin-pro";

/** 取名称中连续汉字/字母的拼音首字母大写串（忽略 *ST、空格、标点等） */
export function nameAbbrOf(name: string): string {
  if (!name) return "";
  // 去除 *ST/ST/退 等风险前缀与空白、标点，仅保留汉字与字母数字
  const cleaned = name
    .replace(/[*STst退\s]+/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
  if (!cleaned) return "";
  const abbr = pinyin(cleaned, {
    pattern: "first",
    toneType: "none",
    type: "array",
  })
    .filter((s) => /^[a-zA-Z]$/.test(s))
    .join("")
    .toUpperCase();
  return abbr;
}
