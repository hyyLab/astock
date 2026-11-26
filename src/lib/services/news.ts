// ============================================================
// 主线追踪资讯服务：抓取 → 研判/题材标签 → 入库 → 读取
// 读取路径带 2 分钟 TTL 缓存；入库保留最近 500 条供历史查询
// ============================================================

import { db } from "@/lib/db";
import { cachedTtl, cacheClearPrefix } from "@/lib/cache";
import { fetchSinaFastNews, type SinaExtStock } from "@/lib/market/news";
import { analyzeImpact } from "@/lib/calc/newsImpact";
import { matchThemesInText } from "@/lib/calc/themeRules";

export interface NewsRow {
  extId: string;
  pubTime: string;
  title: string | null;
  content: string;
  impact: "good" | "bad" | "none";
  kind: "flash" | "stock"; // flash=7x24快讯 | stock=个股新闻（题材归类证据源）
  themes: string[];
  stocks: SinaExtStock[]; // 数据源提及的股票（受益标的信号源之一）
}

const NEWS_TTL_MS = 2 * 60 * 1000; // 页面读取缓存 2 分钟
const KEEP_MAX = 500; // 入库保留条数

function extractTitle(content: string): string | null {
  const m = content.match(/^【(.+?)】/);
  return m ? m[1] : null;
}

function safeParse<T = string[]>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

async function collectAndPersist(limit: number): Promise<NewsRow[]> {
  // 抓两页共约 60 条，保证盘点密度；失败时静默回退读库
  let items: Awaited<ReturnType<typeof fetchSinaFastNews>> = [];
  try {
    const [p1, p2] = await Promise.all([fetchSinaFastNews(30, 1), fetchSinaFastNews(30, 2)]);
    items = [...p1, ...p2];
  } catch {
    // ignore → 读库兜底
  }

  for (const it of items) {
    const { impact } = analyzeImpact(it.content);
    const themes = matchThemesInText(it.content);
    await db.newsItem.upsert({
      where: { extId: it.extId },
      create: {
        extId: it.extId,
        pubTime: it.pubTime,
        content: it.content,
        source: "sina-7x24",
        impact,
        themes: themes.length ? JSON.stringify(themes) : null,
        stocks: it.stocks.length ? JSON.stringify(it.stocks) : null,
      },
      update: {}, // 已入库不覆盖（研判规则变化不影响历史）
    });
  }

  // 裁剪：仅保留最近 KEEP_MAX 条快讯（个股新闻由采集链路独立裁剪，不在此删除）
  const total = await db.newsItem.count({ where: { kind: "flash" } });
  if (total > KEEP_MAX) {
    const old = await db.newsItem.findMany({
      where: { kind: "flash" },
      orderBy: { pubTime: "desc" },
      skip: KEEP_MAX,
      take: total - KEEP_MAX,
      select: { id: true },
    });
    if (old.length > 0) {
      await db.newsItem.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    }
  }

  // 从库读取（保证与入库研判一致）：快讯 + 个股新闻混合流
  const rows = await db.newsItem.findMany({ orderBy: [{ pubTime: "desc" }, { id: "desc" }], take: limit });
  return rows.map((r) => ({
    extId: r.extId,
    pubTime: r.pubTime,
    title: extractTitle(r.content) ?? (r.kind === "stock" ? r.content.split("；")[0] : null),
    content: r.content,
    impact: r.impact as NewsRow["impact"],
    kind: r.kind as NewsRow["kind"],
    themes: safeParse<string[]>(r.themes) ?? [],
    stocks: safeParse<SinaExtStock[]>(r.stocks) ?? [],
  }));
}

/** 主线追踪资讯（带 2 分钟缓存；新闻源不可用时静默读库兜底） */
export async function getLatestNews(limit = 50): Promise<{ rows: NewsRow[]; fetchedAt: string; sourceOnline: boolean }> {
  return cachedTtl(`news:latest:${limit}`, NEWS_TTL_MS, async () => {
    let sourceOnline = true;
    try {
      await fetchSinaFastNews(1, 1); // 探活
    } catch {
      sourceOnline = false;
    }
    const rows = await collectAndPersist(limit);
    return { rows, fetchedAt: new Date().toISOString(), sourceOnline };
  });
}

/**
 * 定时任务 / 手动脚本入口：绕过读取缓存直接抓取入库，并清空读取缓存
 * 由进程内调度器（src/lib/scheduler.ts）每日自动调用；页面访问只是读取，不再依赖有人打开页面才更新
 */
export async function refreshNewsNow(limit = 50): Promise<{ count: number; fetchedAt: string }> {
  const rows = await collectAndPersist(limit);
  cacheClearPrefix("news:");
  return { count: rows.length, fetchedAt: new Date().toISOString() };
}
