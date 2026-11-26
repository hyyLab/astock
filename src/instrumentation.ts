// Next.js instrumentation：服务进程启动时执行一次（仅 nodejs 运行时）
// 用于拉起进程内调度器，实现新闻/行情数据每日自动更新
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/lib/scheduler");
  startScheduler();
}
