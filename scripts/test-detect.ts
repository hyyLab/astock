// 最小复现：detectEvents 纯函数直测
import { detectEvents } from "../src/lib/calc/intradayMoves";

const events = detectEvents({
  tradeDate: "2026-10-12",
  ts: "10:58",
  rows: [
    { stockCode: "600000", stockName: "测试股", price: 10.5, changePct: 5, volumeRatio: 2, limitState: null, themes: ["测试"] },
    { stockCode: "600001", stockName: "封板股", price: 11.0, changePct: 10.02, volumeRatio: 5, limitState: "sealed", themes: [] },
    { stockCode: "600002", stockName: "跳水股", price: 9.0, changePct: -5, volumeRatio: 1, limitState: null, themes: [] },
  ],
  baseline10: new Map([
    ["600000", { price: 10.2, ageMin: 10 }],
    ["600002", { price: 9.4, ageMin: 10 }],
  ]),
  indexPctNow: -0.5,
  indexPctBase: -0.2,
  prevSealed: new Set(["600001"]),
});

console.log("events:", JSON.stringify(events, null, 2));
