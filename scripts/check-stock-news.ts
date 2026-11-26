// 个股新闻数据源探测 v2：打印原始响应 + 新增同花顺/新浪个股页候选
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const NAME = process.argv[2] ?? "平潭发展";
const CODE = process.argv[3] ?? "301001"; // 6位数字代码

async function testEMSearchRaw() {
  const param = JSON.stringify({
    uid: "",
    keyword: NAME,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize: 8,
        preTag: "<em>",
        postTag: "</em>",
      },
    },
  });
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(param)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://so.eastmoney.com/" },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  console.log(`[A] 东财搜索 raw(${text.length}): ${text.slice(0, 300)}`);
}

async function testTHS() {
  // 同花顺个股新闻 push 接口（个股新闻页使用）
  const url = `https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=20&stock_id=${CODE}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: `https://stockpage.10jqka.com.cn/${CODE}/` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { data?: { list?: Record<string, unknown>[] } };
    const list = json.data?.list ?? [];
    console.log(`[D] 同花顺个股新闻: HTTP ${res.status} list=${list.length}`);
    for (const it of list.slice(0, 3)) {
      console.log(`    ${it["ctime"]} [${it["source"]}] ${String(it["title"] ?? "").slice(0, 48)}`);
    }
  } catch {
    console.log(`[D] 同花顺个股新闻: HTTP ${res.status} 非JSON raw(${text.length}): ${text.slice(0, 200)}`);
  }
}

async function testSinaVip() {
  // 新浪个股新闻页（GBK）
  const url = `https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllNewsStock/symbol/sz${CODE}.phtml`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  const buf = await res.arrayBuffer();
  const html = new TextDecoder("gbk").decode(buf);
  const rows = [...html.matchAll(/<a target='_blank' href='([^']+)'>([^<]{6,60})<\/a>\s*\((\d{4}-\d{2}-\d{2})\)/g)].map(
    (m) => ({ url: m[1], title: m[2], date: m[3] })
  );
  console.log(`[E] 新浪个股新闻页: HTTP ${res.status} len=${html.length} 条目=${rows.length}`);
  for (const r of rows.slice(0, 3)) console.log(`    ${r.date} ${r.title.slice(0, 48)} | ${r.url.slice(0, 50)}`);
}

async function testEMListV2() {
  // 东财个股资讯列表：secid 前缀 0=SZ 1=SH，用真实代码测试
  for (const secid of [`0.${CODE}`, `1.${CODE}`]) {
    try {
      const url = `https://np-listapi.eastmoney.com/comm/web/getListInfo?client=web&mTypeAndCode=${secid}&type=1&pageSize=8&req_trace=${Date.now()}`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://emcreative.eastmoney.com/" },
        signal: AbortSignal.timeout(15000),
      });
      const json = (await res.json()) as { code?: number; data?: { list?: Record<string, string>[] } };
      const rows = json.data?.list ?? [];
      console.log(`[B] 东财列表 secid=${secid}: HTTP ${res.status} code=${json.code} list=${rows.length}`);
      for (const a of rows.slice(0, 3)) {
        console.log(`    ${a["showTime"] ?? a["ShowTime"] ?? "?"} ${String(a["title"] ?? a["Art_Title"] ?? "").slice(0, 48)}`);
      }
      if (rows.length > 0) break;
    } catch (e) {
      console.log(`[B] secid=${secid} 失败: ${(e as Error).message.slice(0, 80)}`);
    }
  }
}

async function main() {
  console.log(`=== 个股新闻源探测 v2：${NAME} (${CODE}) ===`);
  for (const fn of [testEMSearchRaw, testEMListV2, testTHS, testSinaVip]) {
    try {
      await fn();
    } catch (e) {
      console.log(`  [${fn.name}] 异常: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  process.exit(0);
}
main();
