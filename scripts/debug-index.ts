// 调试：指数K线拉取
import { fetchIndexKline } from "../src/lib/market/tx";

try {
  const s = await fetchIndexKline("sh000001", 5);
  console.log("OK sh000001:", s.name, s.bars.length, "根");
  console.log(s.bars.slice(-3));
} catch (e) {
  console.error("sh000001 failed:", (e as Error).message);
}
try {
  const s2 = await fetchIndexKline("sz399001", 5);
  console.log("OK sz399001:", s2.name, s2.bars.length, "根");
  console.log(s2.bars.slice(-2));
} catch (e) {
  console.error("sz399001 failed:", (e as Error).message);
}
process.exit(0);
