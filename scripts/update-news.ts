// ============================================================
// 手动一次性更新快讯（正常情况下由进程内调度器自动执行）
// 用途：外部 cron 兜底 / 调试
// 用法：bun scripts/update-news.ts
// ============================================================

import { refreshNewsNow } from "../src/lib/services/news";

try {
  const r = await refreshNewsNow();
  console.log(`快讯更新完成：读取 ${r.count} 条 @ ${r.fetchedAt}`);
  process.exit(0);
} catch (e) {
  console.error("[快讯更新失败]", (e as Error).message);
  process.exit(1);
}
