// ============================================================
// 连板计算（方案第八步核心原则）
// 不直接相信数据源提供的"几连板"，自己保留可追溯的每日状态：
//   如果今天涨停：昨天也涨停 => board_count = yesterday + 1，否则 = 1
// 停牌/复牌天然按交易日序列处理（缺席交易日自动断链）
// ============================================================

export interface BoardState {
  stockCode: string;
  stockName: string;
  boardCount: number; // 当前连板数，0 = 今日未涨停
  previousBoardCount: number; // 昨日连板数
  isPromotion: boolean; // 昨日N板 → 今日N+1板
  isBreak: boolean; // 昨日涨停今日未涨停
  isRebound: boolean; // 前日涨停、昨日断板、今日再涨停（反包）
}

export interface PromotionLevel {
  level: string; // "1进2" "2进3" ...
  fromBoard: number;
  total: number; // 昨日 k 板股票数
  promoted: number; // 今日晋级 k+1 板数量
  rate: number; // 晋级率 0-1
}

export interface BoardChainResult {
  /** 每个交易日的全部股票状态（含断板记录） */
  byDate: Map<string, Map<string, BoardState>>;
  /** 每个交易日的晋级率明细 */
  promotionsByDate: Map<string, PromotionLevel[]>;
}

/**
 * 计算连板链路
 * @param tradeDates 升序交易日数组（YYYY-MM-DD）
 * @param rosters 每个交易日的涨停名单（代码集合，已经过 数据源名单 ∪ 规则检测 合并）
 * @param names 代码 → 名称
 */
export function computeBoardChain(
  tradeDates: string[],
  rosters: Map<string, Set<string>>,
  names: Map<string, string>
): BoardChainResult {
  const byDate = new Map<string, Map<string, BoardState>>();
  const promotionsByDate = new Map<string, PromotionLevel[]>();
  const prevBoards = new Map<string, number>(); // code -> 昨日连板数（跨日滚动）
  const boardsBeforePrev = new Map<string, number>(); // code -> 前日连板数

  for (const date of tradeDates) {
    const roster = rosters.get(date) ?? new Set<string>();
    const dayMap = new Map<string, BoardState>();
    const prevDayBoards = prevBoards; // alias（语义：t-1 日的连板数）

    // 1) 今日涨停的股票
    for (const code of roster) {
      const prev = prevDayBoards.get(code) ?? 0;
      const board = prev > 0 ? prev + 1 : 1;
      const prev2 = boardsBeforePrev.get(code) ?? 0;
      dayMap.set(code, {
        stockCode: code,
        stockName: names.get(code) ?? code,
        boardCount: board,
        previousBoardCount: prev,
        isPromotion: prev > 0,
        isBreak: false,
        isRebound: prev === 0 && prev2 > 0, // 断板后反包
      });
    }

    // 2) 昨日涨停今日未涨停 => 断板（boardCount = 0 保留可追溯记录）
    for (const [code, prev] of prevDayBoards) {
      if (prev > 0 && !roster.has(code)) {
        dayMap.set(code, {
          stockCode: code,
          stockName: names.get(code) ?? code,
          boardCount: 0,
          previousBoardCount: prev,
          isPromotion: false,
          isBreak: true,
          isRebound: false,
        });
      }
    }

    // 3) 晋级率统计（基于昨日 board == k，今日 board == k+1）
    const promotions: PromotionLevel[] = [];
    const totals = new Map<number, number>();
    const promotedCounts = new Map<number, number>();
    for (const [code, prev] of prevDayBoards) {
      if (prev <= 0) continue;
      totals.set(prev, (totals.get(prev) ?? 0) + 1);
      const st = dayMap.get(code);
      if (st && st.boardCount === prev + 1) {
        promotedCounts.set(prev, (promotedCounts.get(prev) ?? 0) + 1);
      }
    }
    const maxPrev = Math.max(0, ...totals.keys());
    for (let k = 1; k <= maxPrev; k++) {
      const total = totals.get(k) ?? 0;
      if (total === 0) continue;
      const promoted = promotedCounts.get(k) ?? 0;
      promotions.push({
        level: `${k}进${k + 1}`,
        fromBoard: k,
        total,
        promoted,
        rate: total > 0 ? promoted / total : 0,
      });
    }
    promotionsByDate.set(date, promotions);

    // 4) 滚动状态
    const nextBoards = new Map<string, number>();
    for (const [code, st] of dayMap) nextBoards.set(code, st.boardCount);
    boardsBeforePrev.clear();
    for (const [code, v] of prevBoards) boardsBeforePrev.set(code, v);
    prevBoards.clear();
    for (const [code, v] of nextBoards) prevBoards.set(code, v);

    byDate.set(date, dayMap);
  }

  return { byDate, promotionsByDate };
}

/** 连板天梯分组：boardCount desc → 首封时间 asc → 成交额 desc */
export function ladderSort<T extends { boardCount: number; firstLimitTime?: string | null; amount?: number | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (b.boardCount !== a.boardCount) return b.boardCount - a.boardCount;
    const ta = a.firstLimitTime ?? "99:99:99";
    const tb = b.firstLimitTime ?? "99:99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (b.amount ?? 0) - (a.amount ?? 0);
  });
}
