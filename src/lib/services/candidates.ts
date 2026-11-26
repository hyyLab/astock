// ============================================================
// 明日候选：打板 / 趋势 / 跳水观察 / 爆量洗盘
// 原则：不搞预言，每个候选都给历史数据与透明理由
//   - 打板：只做主线龙头（题材涨停家数 + 封单质量 + 合力）
//   - 主动带动：主动性（早盘主动封板+封单扎实+不炸板）+ 带动性（带动题材涨停潮，是题材龙头）
//   - 涨停后低吸：涨停只是资金活跃的证明，不是买点；低开 2%+ 接，吃后面的波动和趋势
//   - 辨识度回踩：前期涨停打出辨识度，缩量回调不破涨停日低点，再次放量转强（资金才认）
//   - 趋势：均线多头 + 资金活跃，给回踩参考位
//   - 跳水观察：炸板/首阴，按历史概率说能不能接
//   - 爆量洗盘：爆量长下影不破前低（会稽山模式）
// ============================================================

import { db as prisma } from "@/lib/db";

export type CandidateKind = "打板" | "主动带动" | "涨停后低吸" | "辨识度回踩" | "趋势" | "跳水观察" | "爆量洗盘";

export interface TomorrowCandidate {
  stockCode: string;
  stockName: string;
  kind: CandidateKind;
  boardCount: number | null;
  score: number; // 0-100，越高越优先
  reasons: string[]; // 透明理由，每条都能在数据里找到出处
  theme: string | null;
  themeLimitUpCount: number | null;
  sealQuality: number | null; // 封单/成交 %
  turnoverRate: number | null;
  changePct: number;
  close: number;
  maNote: string; // 均线状态
  pullbackLevel: number | null; // 回踩参考位（趋势候选给 5 日线）
  historyNote: string; // 历史概率说明
}

interface DailyRow {
  tradeDate: string;
  stockCode: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number | null;
  changePct: number;
  volumeRatio: number | null;
  turnoverRate: number | null;
  isLimitUp: boolean;
  isBroken: boolean;
}

function ma(rows: DailyRow[], n: number, endIdx: number): number | null {
  if (endIdx < n - 1) return null;
  let s = 0;
  for (let i = endIdx - n + 1; i <= endIdx; i++) s += rows[i].close;
  return s / n;
}

export async function getTomorrowCandidates(date?: string): Promise<TomorrowCandidate[]> {
  const [dsAll, luAll, dcAll, bhAll] = await Promise.all([
    prisma.dailyStock.findMany({ orderBy: [{ stockCode: "asc" }, { tradeDate: "asc" }] }),
    prisma.limitUp.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.dailyConcept.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.boardHistory.findMany({ orderBy: { tradeDate: "asc" } }),
  ]);

  const dates = [...new Set(dsAll.map((r) => r.tradeDate))].sort();
  const tradeDate = date ?? dates[dates.length - 1];
  const idx = dates.indexOf(tradeDate);
  if (idx < 0) return [];
  const prevDate = idx > 0 ? dates[idx - 1] : null;

  // 按股票组织日线
  const byStock = new Map<string, DailyRow[]>();
  dsAll.forEach((r) => {
    const arr = byStock.get(r.stockCode) ?? [];
    arr.push(r as DailyRow);
    byStock.set(r.stockCode, arr);
  });

  const luToday = luAll.filter((r) => r.tradeDate === tradeDate);
  const luByStock = new Map(luToday.map((r) => [r.stockCode, r]));
  const bhToday = bhAll.filter((r) => r.tradeDate === tradeDate);
  const bhByStock = new Map(bhToday.map((r) => [r.stockCode, r]));

  // 主线题材：今日涨停家数最多的 theme（kind=theme 优先，其次 industry）
  const themesToday = dcAll
    .filter((r) => r.tradeDate === tradeDate && r.limitUpCount >= 3)
    .sort((a, b) => b.limitUpCount - a.limitUpCount || (b.strengthScore ?? 0) - (a.strengthScore ?? 0));
  const mainTheme = themesToday[0] ?? null;
  const mainThemeName = mainTheme?.conceptName ?? null;

  // 历史晋级率（按板数）
  const promoMap = new Map<number, { total: number; promoted: number }>();
  const bhDates = [...new Set(bhAll.map((r) => r.tradeDate))].sort();
  for (let i = 0; i < bhDates.length - 1; i++) {
    const today = bhAll.filter((r) => r.tradeDate === bhDates[i]);
    const nextMap = new Map(bhAll.filter((r) => r.tradeDate === bhDates[i + 1]).map((r) => [r.stockCode, r]));
    today.forEach((r) => {
      if (r.boardCount < 1 || r.isBreak) return;
      const stat = promoMap.get(r.boardCount) ?? { total: 0, promoted: 0 };
      stat.total++;
      const t = nextMap.get(r.stockCode);
      if (t && t.boardCount === r.boardCount + 1 && !t.isBreak) stat.promoted++;
      promoMap.set(r.boardCount, stat);
    });
  }

  // 历史首阴次日表现：2 板以上首阴（昨日涨停今日大阴），次日平均涨跌
  let syTotal = 0;
  let sySum = 0;
  let syWin = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const d = dates[i];
    const next = dates[i + 1];
    const bhPrev = new Map(bhAll.filter((r) => r.tradeDate === d).map((r) => [r.stockCode, r]));
    dsAll
      .filter((r) => r.tradeDate === next)
      .forEach((r) => {
        const prev = bhPrev.get(r.stockCode);
        if (!prev || prev.boardCount < 2 || prev.isBreak) return;
        if (r.changePct > -3) return; // 首阴定义：跌 3% 以上
        const nextRow = dsAll.find((x) => x.tradeDate === dates[dates.indexOf(next) + 1] && x.stockCode === r.stockCode);
        if (!nextRow) return;
        syTotal++;
        sySum += nextRow.changePct;
        if (nextRow.changePct > 0) syWin++;
      });
  }
  const syAvg = syTotal ? sySum / syTotal : null;
  const syWinRate = syTotal ? syWin / syTotal : null;

  // 历史炸板次日表现：今日炸板（曾涨停未封住），次日平均涨跌
  let bzTotal = 0;
  let bzSum = 0;
  let bzWin = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const d = dates[i];
    const next = dates[i + 1];
    dsAll
      .filter((r) => r.tradeDate === d && r.isBroken)
      .forEach((r) => {
        const nextRow = dsAll.find((x) => x.tradeDate === next && x.stockCode === r.stockCode);
        if (!nextRow) return;
        bzTotal++;
        bzSum += nextRow.changePct;
        if (nextRow.changePct > 0) bzWin++;
      });
  }
  const bzAvg = bzTotal ? bzSum / bzTotal : null;
  const bzWinRate = bzTotal ? bzWin / bzTotal : null;

  const candidates: TomorrowCandidate[] = [];

  // 名字表：先建好，循环里直接用
  const nameMap = new Map<string, string>();
  luAll.forEach((r) => nameMap.set(r.stockCode, r.stockName));
  bhAll.forEach((r) => nameMap.set(r.stockCode, r.stockName));
  const nameMapGet = (code: string) => nameMap.get(code) ?? code;

  for (const [code, rows] of byStock) {
    const i = rows.findIndex((r) => r.tradeDate === tradeDate);
    if (i < 0) continue;
    const today = rows[i];
    const lu = luByStock.get(code);
    const bh = bhByStock.get(code);
    const ma5 = ma(rows, 5, i);
    const ma10 = ma(rows, 10, i);
    const ma20 = ma(rows, 20, i);

    // ---------- 打板候选：今日 2 板以上、封住的主线票 ----------
    if (lu && (bh?.boardCount ?? lu.boardCount) >= 2 && !bh?.isBreak) {
      const boardCount = bh?.boardCount ?? lu.boardCount;
      const sealQuality = lu.sealAmount != null && lu.amount ? (lu.sealAmount / lu.amount) * 100 : null;
      const themes: string[] = lu.themes ? JSON.parse(lu.themes) : [];
      const isMain = mainThemeName ? themes.includes(mainThemeName) : false;
      const promo = promoMap.get(boardCount);
      const reasons: string[] = [];
      let score = 40;
      if (isMain) {
        reasons.push(`属于主线「${mainThemeName}」（今日 ${mainTheme?.limitUpCount ?? 0} 只涨停）`);
        score += 25;
      } else if (themes.length) {
        reasons.push(`题材：${themes.join("、")}`);
        score += 8;
      }
      if (sealQuality != null) {
        reasons.push(`封成比 ${sealQuality.toFixed(0)}%${sealQuality >= 30 ? "（封单扎实）" : sealQuality < 10 ? "（封单偏弱）" : ""}`);
        score += Math.min(20, sealQuality / 3);
      }
      if (lu.firstLimitTime && lu.firstLimitTime.slice(0, 5) <= "10:30") {
        reasons.push(`早盘 ${lu.firstLimitTime.slice(0, 5)} 封板（越早越强）`);
        score += 10;
      }
      if (promo && promo.total >= 10) {
        reasons.push(`历史 ${boardCount}进${boardCount + 1} 晋级率 ${((promo.promoted / promo.total) * 100).toFixed(0)}%（${promo.total} 样本）`);
      }
      candidates.push({
        stockCode: code,
        stockName: lu.stockName,
        kind: "打板",
        boardCount,
        score: Math.min(100, Math.round(score)),
        reasons,
        theme: themes[0] ?? null,
        themeLimitUpCount: isMain ? mainTheme?.limitUpCount ?? null : null,
        sealQuality,
        turnoverRate: lu.turnoverRate ?? today.turnoverRate ?? null,
        changePct: today.changePct,
        close: today.close,
        maNote: ma5 && ma10 && ma20 ? `MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : "-",
        pullbackLevel: null,
        historyNote: promo && promo.total >= 10 ? `明日晋级（${boardCount}进${boardCount + 1}）历史胜率 ${((promo.promoted / promo.total) * 100).toFixed(0)}%` : "样本不足，仅观察",
      });
    }

    // ---------- 主动带动：主动性（早盘主动封板+封单扎实+不炸板）+ 带动性（带动题材涨停潮，是题材龙头） ----------
    if (lu) {
      const themes: string[] = lu.themes ? JSON.parse(lu.themes) : [];
      // 带动性：所属题材今日涨停 >= 3 家（题材效应），且它是该题材的 leader（规则：最高板>首封最早>成交最大）
      const myThemes = dcAll
        .filter((r) => r.tradeDate === tradeDate && r.limitUpCount >= 3 && themes.includes(r.conceptName))
        .sort((a, b) => b.limitUpCount - a.limitUpCount);
      const drive = myThemes.find((r) => r.leaderCode === code) ?? null;
      // 主动性：10:00 前主动封板 + 封成比 >= 20% + 全天没炸过板
      const early = lu.firstLimitTime != null && lu.firstLimitTime.slice(0, 5) <= "10:00";
      const sealQuality = lu.sealAmount != null && lu.amount ? (lu.sealAmount / lu.amount) * 100 : null;
      const solid = sealQuality != null && sealQuality >= 20;
      const noBreak = (lu.openCount ?? 0) === 0;
      if (myThemes.length > 0 && early && solid && noBreak) {
        const top = myThemes[0];
        const reasons: string[] = [];
        let score = 50;
        reasons.push(`主动性：${lu.firstLimitTime?.slice(0, 5)} 主动封板，封成比 ${sealQuality?.toFixed(0)}%，全天 0 次炸板`);
        if (drive) {
          reasons.push(`带动性：「${drive.conceptName}」今日 ${drive.limitUpCount} 只涨停，它是题材龙头（${drive.leaderName ?? nameMapGet(code)}）`);
          score += 20;
        } else {
          reasons.push(`带动性：所属「${top.conceptName}」今日 ${top.limitUpCount} 只涨停（题材效应强）`);
          score += 10;
        }
        if ((bh?.boardCount ?? lu.boardCount) >= 2) {
          reasons.push(`${bh?.boardCount ?? lu.boardCount} 板（高度在，情绪核心）`);
          score += 10;
        }
        candidates.push({
          stockCode: code,
          stockName: lu.stockName,
          kind: "主动带动",
          boardCount: bh?.boardCount ?? lu.boardCount,
          score: Math.min(100, Math.round(score)),
          reasons,
          theme: (drive ?? top).conceptName,
          themeLimitUpCount: (drive ?? top).limitUpCount,
          sealQuality,
          turnoverRate: lu.turnoverRate ?? today.turnoverRate ?? null,
          changePct: today.changePct,
          close: today.close,
          maNote: ma5 && ma10 && ma20 ? `MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : "-",
          pullbackLevel: null,
          historyNote: "主动性+带动性=资金合力：可打板可低吸，低开 2% 内看承接，破今日开盘价止损",
        });
      }
    }

    // ---------- 涨停后低吸：涨停=资金活跃的证明，不是买点；低开 2%+ 接，吃后面的波动和趋势 ----------
    if (lu && !bh?.isBreak) {
      const themes: string[] = lu.themes ? JSON.parse(lu.themes) : [];
      const isMain = mainThemeName ? themes.includes(mainThemeName) : false;
      const sealQuality = lu.sealAmount != null && lu.amount ? (lu.sealAmount / lu.amount) * 100 : null;
      const trendUp = ma5 != null && ma10 != null && ma20 != null && ma5 > ma10 && ma10 > ma20 && today.close > ma5;
      const reasons: string[] = ["今日涨停（资金活跃的证明），明日低开 2% 以上才是低吸点"];
      let score = 50;
      if (isMain) {
        reasons.push(`主线「${mainThemeName}」（今日 ${mainTheme?.limitUpCount ?? 0} 只涨停）`);
        score += 20;
      }
      if (trendUp) {
        reasons.push("均线多头（趋势在，吃的是涨停后的趋势不是板）");
        score += 15;
      }
      if (sealQuality != null && sealQuality >= 30) {
        reasons.push(`封成比 ${sealQuality.toFixed(0)}%，封单扎实`);
        score += 10;
      }
      if ((today.volumeRatio ?? 0) >= 2) {
        reasons.push(`量比 ${today.volumeRatio?.toFixed(1)}，资金活跃`);
        score += 5;
      }
      candidates.push({
        stockCode: code,
        stockName: lu.stockName,
        kind: "涨停后低吸",
        boardCount: bh?.boardCount ?? lu.boardCount,
        score: Math.min(100, Math.round(score)),
        reasons,
        theme: themes[0] ?? null,
        themeLimitUpCount: isMain ? mainTheme?.limitUpCount ?? null : null,
        sealQuality,
        turnoverRate: lu.turnoverRate ?? today.turnoverRate ?? null,
        changePct: today.changePct,
        close: today.close,
        maNote: ma5 && ma10 && ma20 ? `MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : "-",
        pullbackLevel: today.close * 0.98, // 低开 2% 参考位
        historyNote:
          "历史回测（开盘买收盘卖）：低开 2~5% 均值 +1.77%、红盘率 56%（197 样本）；低开 >5% 均值 +2.57%、57%（83 样本）；高开 >3% 追均值 -1.38%、红盘率 35%——只低吸，不追高",
      });
    }

    // ---------- 趋势候选：均线多头 + 资金活跃 + 未涨停 ----------
    if (!lu && !today.isLimitUp && ma5 && ma10 && ma20 && i >= 20) {
      const bullish = ma5 > ma10 && ma10 > ma20 && today.close > ma5 && today.close > ma10 && today.close > ma20;
      const active = (today.volumeRatio ?? 0) >= 1.5;
      if (bullish && active) {
        const chg20 = (today.close / rows[i - 20].close - 1) * 100;
        const reasons: string[] = [
          `均线多头排列（MA5>MA10>MA20，收盘全在均线上）`,
          `量比 ${today.volumeRatio?.toFixed(2)}（资金活跃）`,
        ];
        let score = 45;
        if (chg20 >= 0 && chg20 <= 30) {
          reasons.push(`20 日涨幅 ${chg20.toFixed(1)}%（趋势初期，未透支）`);
          score += 15;
        } else if (chg20 > 30) {
          reasons.push(`20 日涨幅 ${chg20.toFixed(1)}%（涨幅已大，注意回撤）`);
          score -= 10;
        }
        if (today.turnoverRate != null && today.turnoverRate <= 8) {
          reasons.push(`换手 ${today.turnoverRate.toFixed(1)}%（筹码稳定，合力票特征）`);
          score += 10;
        }
        candidates.push({
          stockCode: code,
          stockName: code,
          kind: "趋势",
          boardCount: null,
          score: Math.min(100, Math.round(score)),
          reasons,
          theme: null,
          themeLimitUpCount: null,
          sealQuality: null,
          turnoverRate: today.turnoverRate ?? null,
          changePct: today.changePct,
          close: today.close,
          maNote: `MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)} / MA20 ${ma20.toFixed(2)}`,
          pullbackLevel: ma5,
          historyNote: "回踩 5 日线不破可接，跌破 MA10 止损",
        });
      }
    }

    // ---------- 跳水观察：今日炸板 or 2板以上首阴 ----------
    const isBrokenToday = today.isBroken || bh?.isBreak;
    const firstYin = prevDate && bh && bh.previousBoardCount >= 2 && today.changePct <= -3 && !today.isLimitUp;
    if (isBrokenToday || firstYin) {
      const reasons: string[] = [];
      if (isBrokenToday) reasons.push(`今日炸板（曾涨停未封住，收 ${today.changePct.toFixed(2)}%）`);
      if (firstYin) reasons.push(`${bh?.previousBoardCount} 板后首阴（跌 ${Math.abs(today.changePct).toFixed(1)}%）`);
      candidates.push({
        stockCode: code,
        stockName: lu?.stockName ?? code,
        kind: "跳水观察",
        boardCount: bh?.previousBoardCount ?? null,
        score: 30,
        reasons,
        theme: null,
        themeLimitUpCount: null,
        sealQuality: null,
        turnoverRate: today.turnoverRate ?? null,
        changePct: today.changePct,
        close: today.close,
        maNote: ma5 ? `MA5 ${ma5.toFixed(2)}` : "-",
        pullbackLevel: null,
        historyNote: firstYin
          ? syTotal >= 10
            ? `历史 2 板以上首阴，次日均涨 ${syAvg?.toFixed(2)}%、红盘率 ${((syWinRate ?? 0) * 100).toFixed(0)}%（${syTotal} 样本）——低开不破今日低点可小仓试错，破位不接`
            : "首阴样本不足，按破位处理，不接"
          : bzTotal >= 10
            ? `历史炸板股次日均涨 ${bzAvg?.toFixed(2)}%、红盘率 ${((bzWinRate ?? 0) * 100).toFixed(0)}%（${bzTotal} 样本）——弱转强（高开回封）才看，低开破今日低点不接`
            : "炸板样本不足，按弱势处理，不接",
      });
    }

    // ---------- 辨识度回踩：前期资金活跃打出辨识度，缩量回调不破活跃期低点，再次放量转强 ----------
    if (!lu && i >= 15) {
      // 近 15 天内有过资金活跃日（量比>=2 或 换手>=10%），涨停只是其中一种
      let actIdx = -1;
      for (let k = Math.max(0, i - 15); k < i; k++) {
        const r = rows[k];
        if ((r.volumeRatio ?? 0) >= 2 || (r.turnoverRate ?? 0) >= 10) { actIdx = k; break; }
      }
      if (actIdx >= 0) {
        const actDay = rows[actIdx];
        const pull = rows.slice(actIdx + 1, i);
        // 回调期间不破活跃日低点，且量能整体萎缩（均量比 < 1.2）
        const noBreak = pull.every((r) => r.low > actDay.low);
        const avgVr = pull.length ? pull.reduce((s, r) => s + (r.volumeRatio ?? 1), 0) / pull.length : 1; // 无回调日按 1 算
        // 今天放量转强（量比 >= 1.5，涨幅 > 2%）；回调期不要求每天缩量，只要整体量能没放大
        const active = (today.volumeRatio ?? 0) >= 1.5 && today.changePct > 2;
        if (noBreak && active) {
          const daysSince = i - actIdx;
          const wasLimitUp = actDay.isLimitUp;
          candidates.push({
            stockCode: code,
            stockName: nameMapGet(code),
            kind: "辨识度回踩",
            boardCount: null,
            score: 65,
            reasons: [
              `${daysSince} 天前资金活跃${wasLimitUp ? "（涨停）" : `（量比 ${(actDay.volumeRatio ?? 0).toFixed(1)}）`}打出辨识度（${actDay.tradeDate}）`,
              `回调缩量（均量比 ${avgVr.toFixed(2)}）不破活跃日低点 ${actDay.low.toFixed(2)}`,
              `今日放量转强（量比 ${today.volumeRatio?.toFixed(1)}，涨 ${today.changePct.toFixed(1)}%）`,
            ],
            theme: null,
            themeLimitUpCount: null,
            sealQuality: null,
            turnoverRate: today.turnoverRate ?? null,
            changePct: today.changePct,
            close: today.close,
            maNote: ma5 && ma10 && ma20 ? `MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : "-",
            pullbackLevel: actDay.low,
            historyNote: "资金活跃的票才有记忆，资金才认：回踩不破活跃日低点可接，跌破=辨识度失效，不碰",
          });
        }
      }
    }

    // ---------- 爆量洗盘：爆量长下影收红 + 近 5 日有涨停 ----------
    const vr = today.volumeRatio ?? 0;
    const lowerShadow = today.open - today.low;
    const body = Math.abs(today.close - today.open);
    const red = today.close > today.open;
    const recentLimitUp = rows.slice(Math.max(0, i - 5), i).some((r) => r.isLimitUp);
    if (vr >= 5 && red && lowerShadow >= body && lowerShadow / today.close >= 0.02 && recentLimitUp) {
      candidates.push({
        stockCode: code,
        stockName: lu?.stockName ?? code,
        kind: "爆量洗盘",
        boardCount: bh?.boardCount ?? null,
        score: 55,
        reasons: [
          `爆量（量比 ${vr.toFixed(1)}）长下影收红（下影 ${(lowerShadow / today.close * 100).toFixed(1)}%）`,
          `近 5 日有涨停，爆量不破位=洗盘特征`,
        ],
        theme: null,
        themeLimitUpCount: null,
        sealQuality: null,
        turnoverRate: today.turnoverRate ?? null,
        changePct: today.changePct,
        close: today.close,
        maNote: ma5 ? `MA5 ${ma5.toFixed(2)}` : "-",
        pullbackLevel: today.low,
        historyNote: "会稽山模式：缩量回踩不破爆量日低点可接，跌破则形态失效",
      });
    }
  }

  // 排序：分数高的在前，同类内按分数
  const kindOrder: Record<CandidateKind, number> = { 打板: 0, 主动带动: 1, 涨停后低吸: 2, 辨识度回踩: 3, 趋势: 4, 爆量洗盘: 5, 跳水观察: 6 };
  candidates.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.score - a.score);

  candidates.forEach((c) => {
    if (!c.stockName || c.stockName === c.stockCode) c.stockName = nameMap.get(c.stockCode) ?? c.stockCode;
  });

  // 每类最多 8 个，避免信息过载
  const capped: TomorrowCandidate[] = [];
  const counts = new Map<CandidateKind, number>();
  for (const c of candidates) {
    const n = counts.get(c.kind) ?? 0;
    if (n < 8) {
      capped.push(c);
      counts.set(c.kind, n + 1);
    }
  }
  return capped;
}
