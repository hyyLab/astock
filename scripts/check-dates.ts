import Database from "better-sqlite3";

const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });

function q(sql: string): any[] {
  try {
    return db.prepare(sql).all() as any[];
  } catch (e) {
    return [{ ERR: String(e) }];
  }
}

console.log("== DailyMarket dates ==");
console.log(q("SELECT DISTINCT tradeDate FROM DailyMarket ORDER BY tradeDate DESC LIMIT 8"));

console.log("== LimitUpPool dates ==");
console.log(q("SELECT DISTINCT tradeDate FROM LimitUpPool ORDER BY tradeDate DESC LIMIT 6"));

console.log("== IntradaySnap dates ==");
console.log(q("SELECT tradeDate, COUNT(*) n FROM IntradaySnap GROUP BY tradeDate ORDER BY tradeDate DESC LIMIT 6"));

console.log("== IntradayEvent dates ==");
console.log(q("SELECT tradeDate, COUNT(*) n FROM IntradayEvent GROUP BY tradeDate ORDER BY tradeDate DESC LIMIT 6"));

console.log("== IntradayIndexSnap latest ==");
console.log(q("SELECT * FROM IntradayIndexSnap ORDER BY pollTs DESC LIMIT 3"));

console.log("== News latest ==");
console.log(q("SELECT publishedAt FROM News ORDER BY publishedAt DESC LIMIT 3"));

db.close();
