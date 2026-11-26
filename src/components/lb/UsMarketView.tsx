"use client";

// 隔夜美股映射（用户迭代新增）：美股强势题材 → A股主线 → 受益标的
// 逻辑：A 股情绪常受隔夜美股推动（英伟达→算力链、特斯拉→车链、礼来→减肥药…）
// 数据：腾讯美股行情（60s 缓存）+ themeRules 中维护的 美股标的→主线 映射
import { useEffect, useState } from "react";
import { api, type UsMarketData, type UsThemeGroup } from "./api";
import { pctClass } from "./format";
import { RefreshCw, Globe2 } from "lucide-react";

const DIRECTION_META: Record<UsThemeGroup["direction"], { text: string; cls: string; tip: string }> = {
  strong: { text: "隔夜强势", cls: "bg-up-soft text-up", tip: "关注 A 股对应主线竞价高开与承接力度" },
  up: { text: "隔夜偏强", cls: "bg-warn-soft text-warn-strong", tip: "对应主线或有情绪传导，留意开盘量能" },
  flat: { text: "隔夜平淡", cls: "bg-muted text-dim", tip: "传导效应有限，按 A 股自身节奏观察" },
  down: { text: "隔夜偏弱", cls: "bg-down-soft text-down", tip: "对应主线或承压，注意低开后的承接" },
  weak: { text: "隔夜大跌", cls: "bg-down-soft text-down", tip: "警惕对应主线情绪退潮风险" },
};

function GroupBlock({ g }: { g: UsThemeGroup }) {
  const dir = DIRECTION_META[g.direction];
  return (
    <div className="border-b border-line px-3.5 py-2.5 last:border-0 hover:bg-hover">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">{g.theme}</span>
        <span className={`rounded-[2px] px-1.5 text-[10px] leading-4 font-medium ${dir.cls}`}>{dir.text}</span>
        <span className={`num text-[12px] font-bold tabular-nums ${pctClass(g.avgChangePct)}`}>
          组均 {g.avgChangePct > 0 ? "+" : ""}
          {g.avgChangePct.toFixed(2)}%
        </span>
        <span className="text-[11px] text-dim">{dir.tip}</span>
      </div>

      <div className="mt-1.5 flex flex-col gap-1.5 lg:flex-row lg:items-start lg:gap-6">
        {/* 美股标的 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-dim2">美股：</span>
          {g.stocks.map((s) => (
            <span
              key={s.symbol}
              className="rounded-[3px] border border-border bg-card px-1.5 py-0.5 text-[11px]"
              title={`${s.cname} ${s.symbol} · 收盘 ${s.close} · ${s.note ?? ""}`}
            >
              <span className="font-medium text-foreground">{s.cname}</span>
              <span className={`num ml-1 tabular-nums ${pctClass(s.changePct)}`}>
                {s.changePct > 0 ? "+" : ""}
                {s.changePct.toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
        {/* A股受益标的 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-dim2">A股受益（当日涨停）：</span>
          {g.beneficiaries.length === 0 ? (
            <span className="text-[11px] text-dim2">该主线今日暂无涨停股</span>
          ) : (
            g.beneficiaries.map((b) => (
              <button
                key={b.stockCode}
                onClick={() => (location.hash = `#/stock/${b.stockCode}`)}
                className="num rounded-[3px] border border-border bg-card px-1.5 py-0.5 text-[11px] text-fg2 hover:border-up-soft hover:text-up"
                title={`${b.industry ?? ""} · 涨幅 ${b.changePct.toFixed(2)}%`}
              >
                <span className="font-medium">{b.stockName}</span>
                {b.boardCount > 1 && <b className="ml-1 text-up">{b.boardCount}板</b>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function UsMarketView() {
  const [data, setData] = useState<UsMarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await api.usMarket();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div className="py-20 text-center text-sm text-dim">美股行情加载中…</div>;
  if (error || !data)
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded border border-warn-soft bg-warn-bg py-20">
        <p className="text-sm text-muted-foreground">{error ?? "数据加载失败"}</p>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs text-fg2 hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 重试
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      {/* 指数条 */}
      <section className="panel">
        <div className="module-header">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Globe2 className="h-4 w-4 text-link" /> 隔夜美股 · 三大指数
          </h2>
          <span className="text-[11px] text-dim">{data.tradeNote}</span>
          <span className="ml-auto text-[10px] text-dim2">每 2 分钟自动刷新</span>
        </div>
        <div className="grid grid-cols-3 divide-x divide-line">
          {data.indices.map((i) => (
            <div key={i.symbol} className="px-3.5 py-3 text-center sm:px-6">
              <div className="text-[12px] text-muted-foreground">{i.name}</div>
              <div className="num mt-0.5 text-[18px] font-semibold tabular-nums text-foreground">
                {i.close.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </div>
              <div className={`num mt-0.5 text-[12px] tabular-nums ${pctClass(i.changePct)}`}>
                {i.changePct > 0 ? "+" : ""}
                {i.changePct.toFixed(2)}%
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 题材映射分组 */}
      <section className="panel">
        <div className="module-header">
          <h2 className="text-[13px] font-semibold text-foreground">美股题材 → A股主线映射</h2>
          <span className="text-[11px] text-dim">
            按组均涨跌幅排序 · 强势主线利于 A 股对应题材情绪传导
          </span>
        </div>
        {data.groups.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-dim">美股行情暂不可用</div>
        ) : (
          data.groups.map((g) => <GroupBlock key={g.theme} g={g} />)
        )}
      </section>

      <section className="panel px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">口径说明</div>
        <p>
          美股行情来自腾讯公开行情接口（美东收盘数据，北京时间盘前更新，缓存 60 秒）。
          美股标的 → A股主线的映射关系由本站规则库维护（如 英伟达/博通 → 算力AI，特斯拉 → 新能源车，礼来/诺和诺德 → 医药），
          集中在 themeRules 配置文件中，可随时增删。「A股受益标的」为该主线内当日涨停股（按连板数排序，最多 8 只）。
          传导强度规则：组均涨跌幅 ≥2% 强势 / ≥0.5% 偏强 / &gt;-0.5% 平淡 / &gt;-2% 偏弱 / 其余大跌。
        </p>
        <p className="mt-1.5">
          使用建议：竞价阶段重点观察「隔夜强势」主线的 A 股对应标的（高开幅度、竞价量能），
          隔夜大跌的主线则需警惕情绪退潮。映射仅为情绪参考，不构成投资建议。
        </p>
      </section>
    </div>
  );
}
