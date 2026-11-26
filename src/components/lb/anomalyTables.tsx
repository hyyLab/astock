"use client";

// 异动监控 · 表格子组件（共振/逆势共用行情表 + 板块效应 + 领涨龙头 + 前期爆量）
// 全部为展示与排序逻辑，不做任何指标计算（口径见 AnomalyView 底部说明）
import { Fragment, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AnomalyStock, LeaderRow, PriorSurgeRow, SectorEffectRow } from "./api";
import { pctClass, fmtPct, fmtYi } from "./format";

export const POOL_LABEL: Record<AnomalyStock["fromPool"], string> = {
  limitup: "涨停",
  broken: "炸板",
  limitdown: "跌停",
  surge: "爆量",
  scan: "扫描",
};

const POSITION_LABEL = { low: "低位", mid: "中位", high: "高位" } as const;

export function positionChip(p: "low" | "mid" | "high" | null) {
  if (!p) return null;
  const cls =
    p === "high"
      ? "bg-warn-soft text-warn-strong"
      : p === "low"
        ? "bg-link-soft-bg text-link-strong"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-[2px] px-1 text-[10px] leading-4 ${cls}`}>{POSITION_LABEL[p]}</span>;
}

// ---------- 共振 / 逆势共用行情表 ----------

type StockSortKey = "pct" | "rs" | "ratio" | "amount";

export function AnomalyStockTable({
  rows,
  defaultSort,
  tableKey,
}: {
  rows: AnomalyStock[];
  defaultSort: StockSortKey;
  tableKey: string; // tab 切换时强制重挂载，重置排序状态
}) {
  const [sortKey, setSortKey] = useState<StockSortKey>(defaultSort);
  const sorted = useMemo(() => {
    const cmp: Record<StockSortKey, (a: AnomalyStock, b: AnomalyStock) => number> = {
      pct: (a, b) => b.changePct - a.changePct,
      rs: (a, b) => b.rsPct - a.rsPct || b.changePct - a.changePct,
      ratio: (a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0),
      amount: (a, b) => (b.amount ?? 0) - (a.amount ?? 0),
    };
    return [...rows].sort(cmp[sortKey]);
  }, [rows, sortKey]);

  const th = (active: boolean) => `cursor-pointer px-2 py-1.5 text-right font-normal hover:text-foreground ${active ? "text-up" : ""}`;

  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[920px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
            <th onClick={() => setSortKey("pct")} className={th(sortKey === "pct")} title="点击排序">
              现价 / 涨幅
            </th>
            <th
              onClick={() => setSortKey("rs")}
              className={th(sortKey === "rs")}
              title="相对大盘强度 = 个股涨幅 − 上证指数涨幅（百分点） · 点击排序"
            >
              相对大盘
            </th>
            <th className="px-2 py-1.5 text-center font-normal">状态</th>
            <th onClick={() => setSortKey("ratio")} className={th(sortKey === "ratio")} title="点击排序">
              量比
            </th>
            <th className="px-2 py-1.5 text-right font-normal">换手%</th>
            <th onClick={() => setSortKey("amount")} className={th(sortKey === "amount")} title="点击排序">
              成交额(亿)
            </th>
            <th className="px-2 py-1.5 text-right font-normal">流通市值(亿)</th>
            <th className="px-2 py-1.5 text-left font-normal">主线题材</th>
            <th className="px-3.5 py-1.5 text-right font-normal">行业</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.stockCode}
              onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
              className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
            >
              <td className="px-3.5 py-1.5">
                <span className="font-medium text-foreground">{r.stockName}</span>
                <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
              </td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                <span className="text-foreground">{r.price.toFixed(2)}</span>
                <span className={`ml-1.5 font-medium ${pctClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
              </td>
              <td className={`num px-2 py-1.5 text-right font-bold tabular-nums ${pctClass(r.rsPct)}`}>
                {fmtPct(r.rsPct)}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-center">
                {r.isLimitUp ? (
                  <span className="rounded-[2px] bg-up-soft px-1 text-[10px] leading-4 text-up">
                    {r.boardCount != null && r.boardCount >= 2 ? `${r.boardCount}板涨停` : "涨停"}
                  </span>
                ) : r.isBroken ? (
                  <span className="rounded-[2px] bg-warn-soft px-1 text-[10px] leading-4 text-warn-strong">炸板</span>
                ) : r.isLimitDown ? (
                  <span className="rounded-[2px] bg-down-soft px-1 text-[10px] leading-4 text-down">跌停</span>
                ) : null}
                <span
                  className="ml-1 rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-dim"
                  title={`异动来源：${POOL_LABEL[r.fromPool]}${r.firstLimitTime ? ` · 首封 ${r.firstLimitTime.slice(0, 5)}` : ""}`}
                >
                  {POOL_LABEL[r.fromPool]}
                </span>
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.volumeRatio != null ? r.volumeRatio.toFixed(1) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.turnoverRate != null ? r.turnoverRate.toFixed(1) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.amount ? fmtYi(r.amount) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-dim">
                {r.floatMarketCap ? fmtYi(r.floatMarketCap, 1) : "—"}
              </td>
              <td
                className="max-w-[150px] truncate px-2 py-1.5 text-muted-foreground"
                title={r.themes.join("、") || r.industry || ""}
              >
                {r.themes.length > 0 ? r.themes.slice(0, 2).join("·") : (r.industry ?? "—")}
              </td>
              <td className="max-w-[90px] truncate px-3.5 py-1.5 text-right text-dim2" title={r.industry ?? ""}>
                {r.industry ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 板块效应表（点击行展开成分明细） ----------

export function SectorEffectTable({ rows }: { rows: SectorEffectRow[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[940px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">题材 / 行业</th>
            <th className="px-2 py-1.5 text-center font-normal">类型</th>
            <th className="px-2 py-1.5 text-right font-normal" title="题材内涨停家数">
              涨停
            </th>
            <th className="px-2 py-1.5 text-right font-normal">最高板</th>
            <th className="px-2 py-1.5 text-right font-normal" title="题材内 ≥2 连板的股票数">
              连板股数
            </th>
            <th className="px-2 py-1.5 text-right font-normal">炸板</th>
            <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
            <th className="px-2 py-1.5 text-right font-normal" title="题材强度分 0-100（家数/高度/梯队/成交额加权）">
              强度分
            </th>
            <th className="px-2 py-1.5 text-left font-normal">龙头</th>
            <th className="px-3.5 py-1.5 text-left font-normal">成分明细</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const key = `${s.kind}:${s.conceptName}`;
            const open = openKey === key;
            return (
              <Fragment key={key}>
                <tr
                  onClick={() => setOpenKey(open ? null : key)}
                  className="cursor-pointer border-b border-line transition-colors hover:bg-hover"
                >
                  <td className="px-3.5 py-1.5">
                    <span className="font-medium text-foreground">{s.conceptName}</span>
                    <ChevronDown
                      className={`ml-1 inline h-3 w-3 text-dim transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span
                      className={`rounded-[2px] px-1 text-[10px] leading-4 ${
                        s.kind === "theme" ? "bg-up-soft text-up" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.kind === "theme" ? "主线" : "行业"}
                    </span>
                  </td>
                  <td className="num px-2 py-1.5 text-right font-bold tabular-nums text-up">{s.limitUpCount}</td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                    {s.highestBoard > 0 ? `${s.highestBoard}板` : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{s.boardStockCount}</td>
                  <td className="num px-2 py-1.5 text-right tabular-nums">
                    {s.brokenCount > 0 ? (
                      <span className="font-medium text-warn-strong">{s.brokenCount}</span>
                    ) : (
                      <span className="text-dim2">0</span>
                    )}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                    {s.totalAmount != null ? s.totalAmount.toFixed(1) : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{s.strengthScore.toFixed(0)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-fg2">{s.leaderName ?? "—"}</td>
                  <td className="max-w-[220px] px-3.5 py-1.5">
                    <span className="block truncate text-muted-foreground" title={s.members.map((m) => m.stockName).join("、")}>
                      {s.members.length > 0
                        ? `${s.members.slice(0, 5).map((m) => m.stockName).join("·")}${s.members.length > 5 ? ` 等${s.members.length}家` : ""}`
                        : "—"}
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-line bg-subtle">
                    <td colSpan={10} className="px-3.5 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {s.members.map((m) => (
                          <button
                            key={m.stockCode}
                            onClick={(e) => {
                              e.stopPropagation();
                              location.hash = `#/stock/${m.stockCode}`;
                            }}
                            className="rounded-[3px] border border-line bg-card px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:border-link-soft hover:text-link"
                            title={`${m.stockName} ${m.industry ?? ""}`}
                          >
                            {m.stockName}
                            {m.boardCount >= 2 && <span className="ml-0.5 text-up">{m.boardCount}板</span>}
                            {m.changePct != null && (
                              <span className={`num ml-1 ${pctClass(m.changePct)}`}>{fmtPct(m.changePct)}</span>
                            )}
                          </button>
                        ))}
                        {s.members.length === 0 && <span className="text-[11px] text-dim">无成分明细</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 领涨龙头表 ----------

export function LeaderTable({ rows }: { rows: LeaderRow[] }) {
  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[900px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">级别</th>
            <th className="px-2 py-1.5 text-left font-normal">所属题材</th>
            <th className="px-2 py-1.5 text-left font-normal">龙头</th>
            <th className="px-2 py-1.5 text-right font-normal">连板</th>
            <th className="px-2 py-1.5 text-right font-normal">首封时间</th>
            <th className="px-2 py-1.5 text-right font-normal">封单(亿)</th>
            <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
            <th className="px-2 py-1.5 text-right font-normal">换手%</th>
            <th className="px-2 py-1.5 text-right font-normal">量比</th>
            <th className="px-3.5 py-1.5 text-right font-normal">题材涨停 / 强度</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.scope}:${r.stockCode}`}
              onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
              className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
            >
              <td className="whitespace-nowrap px-3.5 py-1.5">
                <span
                  className={`rounded-[2px] px-1 text-[10px] leading-4 ${
                    r.scope === "market" ? "bg-warn-soft text-warn-strong" : "bg-link-soft-bg text-link-strong"
                  }`}
                >
                  {r.scope === "market" ? "市场总龙头" : "题材龙头"}
                </span>
              </td>
              <td className="max-w-[130px] truncate px-2 py-1.5 text-muted-foreground" title={r.conceptName ?? ""}>
                {r.conceptName ?? "—"}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <span className="font-medium text-foreground">{r.stockName}</span>
                <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
              </td>
              <td className="num px-2 py-1.5 text-right font-bold tabular-nums text-up">{r.boardCount}板</td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.firstLimitTime ? r.firstLimitTime.slice(0, 5) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.sealAmount ? fmtYi(r.sealAmount) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.amount ? fmtYi(r.amount) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.turnoverRate != null ? r.turnoverRate.toFixed(1) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.volumeRatio != null ? r.volumeRatio.toFixed(1) : "—"}
              </td>
              <td className="num whitespace-nowrap px-3.5 py-1.5 text-right tabular-nums text-dim">
                {r.themeLimitUpCount != null ? (
                  <>
                    <span className="text-up">{r.themeLimitUpCount}家</span> / {r.themeStrength?.toFixed(0) ?? "—"}
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 前期爆量表 ----------

const SURGE_STATUS: Record<PriorSurgeRow["status"], { label: string; cls: string }> = {
  limitup: { label: "今日涨停", cls: "bg-up-soft text-up" },
  surging: { label: "今日拉升", cls: "bg-up-soft text-up" },
  holding: { label: "守住不跌", cls: "bg-muted text-muted-foreground" },
  floor_broken: { label: "跌破基准", cls: "bg-down-soft text-down" },
};

export function PriorSurgeTable({ rows }: { rows: PriorSurgeRow[] }) {
  const [sortKey, setSortKey] = useState<"since" | "current" | "ratio">("since");
  const sorted = useMemo(() => {
    const cmp = {
      since: (a: PriorSurgeRow, b: PriorSurgeRow) => b.sinceChangePct - a.sinceChangePct,
      current: (a: PriorSurgeRow, b: PriorSurgeRow) => b.currentChangePct - a.currentChangePct,
      ratio: (a: PriorSurgeRow, b: PriorSurgeRow) => b.surgeVolumeRatio - a.surgeVolumeRatio,
    };
    return [...rows].sort(cmp[sortKey]);
  }, [rows, sortKey]);

  const th = (active: boolean) =>
    `cursor-pointer px-2 py-1.5 ${active ? "text-up" : ""} font-normal hover:text-foreground ${active ? "" : "text-dim"}`;

  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[880px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
            <th onClick={() => setSortKey("current")} className={`text-right ${th(sortKey === "current")}`} title="点击排序">
              现价 / 今日
            </th>
            <th onClick={() => setSortKey("since")} className={`text-right ${th(sortKey === "since")}`} title="当前收盘较最近一次爆量日收盘的涨跌幅 · 点击排序">
              距爆量日
            </th>
            <th onClick={() => setSortKey("ratio")} className={`text-right ${th(sortKey === "ratio")}`} title="基准日 20 日口径量比 · 点击排序">
              爆量量比
            </th>
            <th className="px-2 py-1.5 text-left font-normal">爆量日</th>
            <th className="px-2 py-1.5 text-center font-normal">今日状态</th>
            <th className="px-2 py-1.5 text-center font-normal">位置</th>
            <th className="px-2 py-1.5 text-left font-normal">主线题材</th>
            <th className="px-3.5 py-1.5 text-right font-normal">行业</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.stockCode}
              onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
              className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
            >
              <td className="px-3.5 py-1.5">
                <span className="font-medium text-foreground">{r.stockName}</span>
                <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
              </td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                <span className="text-foreground">{r.currentClose.toFixed(2)}</span>
                <span className={`ml-1.5 font-medium ${pctClass(r.currentChangePct)}`}>
                  {fmtPct(r.currentChangePct)}
                </span>
              </td>
              <td className={`num px-2 py-1.5 text-right font-bold tabular-nums ${pctClass(r.sinceChangePct)}`}>
                {fmtPct(r.sinceChangePct)}
              </td>
              <td className="num px-2 py-1.5 text-right font-bold tabular-nums text-warn">
                {r.surgeVolumeRatio.toFixed(1)}
                {r.surgeCount >= 2 && (
                  <span
                    className="ml-1 rounded-[2px] bg-up-soft px-1 text-[10px] font-normal leading-4 text-up"
                    title={`窗口内爆量 ${r.surgeCount} 次（峰值量比 ${r.maxVolumeRatio.toFixed(1)}）`}
                  >
                    {r.surgeCount}次
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-left text-fg2">
                <span className="num">{r.surgeDate.slice(5)}</span>
                {r.surgeIsLimitUp && <span className="ml-1 rounded-[2px] bg-up-soft px-1 text-[10px] leading-4 text-up">涨停</span>}
                {r.surgeIsBroken && <span className="ml-1 rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-dim">炸板</span>}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-center">
                <span className={`rounded-[2px] px-1 text-[10px] leading-4 ${SURGE_STATUS[r.status].cls}`}>
                  {SURGE_STATUS[r.status].label}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-center">{positionChip(r.position)}</td>
              <td
                className="max-w-[150px] truncate px-2 py-1.5 text-muted-foreground"
                title={r.themes.join("、") || r.industry || ""}
              >
                {r.themes.length > 0 ? r.themes.slice(0, 2).join("·") : (r.industry ?? "—")}
              </td>
              <td className="max-w-[90px] truncate px-3.5 py-1.5 text-right text-dim2" title={r.industry ?? ""}>
                {r.industry ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
