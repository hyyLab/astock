// ============================================================
// 主线题材规则引擎（双层题材体系的"主线层"）
//
// 归类原则（重要）：按"炒作类型"归类，而非公司所属行业。
// 资金炒的是"故事/逻辑"，不是主营业务——例如：
//   · 大亚圣象行业是家居用品，但市场炒的是 PCB → 应归 PCB概念；
//   · 海峡创新行业是 IT服务，但市场炒的是两岸/福建 → 应归 福建概念；
//   · 福建概念本身横跨 林业(平潭发展)/医药商业(合富中国/鹭燕医药)/水泥。
// 行业白名单只是"炒作类型"与行业重合时的便捷匹配手段，
// 当炒作逻辑与行业不符时，用 members/nameKeywords 显式指定（优先维护个案）。
// 盘中同批启动聚类（syncLaunch.ts）可辅助发现新题材：
//   首封时间聚集且无主线归属的股票群 = 候选新题材。
//
// 炒作类型四大类（新增题材时先归类再写规则）：
//   1. 产业链题材：PCB概念/算力AI/机器人/固态电池…（跨上下游环节）
//   2. 区域题材：福建概念/海南自贸…（跨所有行业）
//   3. 事件题材：并购重组/摘帽/中标/涨价…（与行业无关，newsKeywords 为主）
//   4. 政策题材：低空经济/东数西算…（常与产业链重叠）
//
// 三种归组手段（可叠加）：
//   1. industries    行业白名单（子串匹配东财 hybk 行业名，如 "中药"→"中药Ⅱ"）
//   2. nameKeywords  股票名称关键词（包含即命中，自动去空格）
//   3. members       显式成员名单（股票名精确匹配，维护跨行业/炒作类型个案）
// 一只股票可同时归属多个主线；无命中的股票仅留在行业层。
//
// 维护说明：题材规则全部集中在本文件，随市场主线演变增删即可，
// 重新采集后自动生效，历史数据随采集窗口滚动重建。
// usSymbols 为"隔夜美股映射"配置：美股标的 → 该主线 → A股受益标的。
// ============================================================

export interface ThemeRule {
  name: string;
  desc?: string;
  nameKeywords?: string[];
  industries?: string[];
  members?: string[];
  newsKeywords?: string[]; // 主线追踪：新闻文本命中关键词 → 关联本题材
  usSymbols?: { symbol: string; name: string; note?: string }[]; // 隔夜美股映射
}

export const THEME_RULES: ThemeRule[] = [
  {
    name: "PCB概念",
    desc: "印制电路板/覆铜板/铜箔（产业链题材；成分按炒作类型归，不按行业）",
    industries: ["元件"],
    nameKeywords: ["PCB", "印制电路", "覆铜板", "铜箔"],
    members: ["大亚圣象"], // 行业家居用品，市场炒其 PCB 相关业务 → 按炒作类型归类
    newsKeywords: ["PCB", "覆铜板", "印制电路板", "铜箔", "AI服务器主板"],
    usSymbols: [
      { symbol: "usTTMI", name: "TTM科技", note: "北美PCB龙头" },
    ],
  },
  {
    name: "并购重组",
    desc: "事件题材：并购/重组/借壳/控制权变更（与行业无关，个案维护 members）",
    newsKeywords: ["并购", "重组", "借壳", "资产注入", "收购", "控制权变更", "易主", "实控人变更", "资产重组"],
    usSymbols: [],
  },
  {
    name: "福建概念",
    desc: "海峡西岸/福建区域主题（跨行业：林业/医药商业/水泥/航运/IT服务等）",
    nameKeywords: ["福建", "厦门", "福州", "泉州", "平潭", "漳州", "闽"],
    members: ["合富中国", "鹭燕医药", "海峡创新"], // 海峡创新行业IT服务，炒的是两岸/福建
    newsKeywords: ["福建", "海峡西岸", "平潭", "厦门", "两岸融合", "漳州", "福州"], // 注意：不能用裸"海峡"（霍尔木兹海峡等国际新闻会误命中）
    usSymbols: [],
  },
  {
    name: "算力AI",
    desc: "算力/光模块/数据中心（通信设备/计算机/软件）",
    industries: ["通信设备", "IT服务", "计算机设", "软件开发"],
    nameKeywords: ["光模块", "光通信", "算力", "数据中心", "云计算", "大数据"],
    newsKeywords: ["算力", "英伟达", "GPU", "光模块", "数据中心", "AI芯片", "东数西算", "智算", "CPO"],
    usSymbols: [
      { symbol: "usNVDA", name: "英伟达", note: "AI算力核心" },
      { symbol: "usAMD", name: "AMD" },
      { symbol: "usAVGO", name: "博通", note: "CPO/定制芯片" },
      { symbol: "usSMCI", name: "超微电脑", note: "AI服务器" },
      { symbol: "usORCL", name: "甲骨文", note: "云与AI订单" },
      { symbol: "usTSM", name: "台积电", note: "先进制程" },
    ],
  },
  {
    name: "机器人",
    desc: "机器人/自动化装备",
    industries: ["自动化设"],
    nameKeywords: ["机器人", "减速", "伺服", "智能装备", "机电"],
    newsKeywords: ["人形机器人", "机器人", "减速器", "伺服", "特斯拉Optimus", "具身智能"],
    usSymbols: [{ symbol: "usTER", name: "Teradyne", note: "协作机器人" }],
  },
  {
    name: "半导体",
    desc: "芯片/存储/封测（自主可控）",
    // 注："元件"行业归 PCB概念（PCB 属元件业但为独立炒作主线）
    industries: ["半导体", "电子化学"],
    nameKeywords: ["半导", "芯片", "晶圆", "微电子", "微电"],
    newsKeywords: ["半导体", "芯片", "晶圆", "光刻", "中芯国际", "存储", "先进封装", "国产替代", "制裁"],
    usSymbols: [
      { symbol: "usMU", name: "美光科技", note: "存储" },
      { symbol: "usINTC", name: "英特尔" },
      { symbol: "usASML", name: "阿斯麦", note: "光刻机" },
    ],
  },
  {
    name: "消费电子",
    desc: "果链/安卓链/光学（消费电子/光学光电）",
    industries: ["消费电子", "光学光电", "黑色家电", "照明设备"],
    nameKeywords: ["光电", "视听", "音响"],
    newsKeywords: ["苹果", "iPhone", "Vision Pro", "折叠屏", "华为手机", "果链", "AI手机", "AI眼镜"],
    usSymbols: [
      { symbol: "usAAPL", name: "苹果" },
      { symbol: "usQCOM", name: "高通" },
    ],
  },
  {
    name: "新能源车",
    desc: "整车/锂电池/汽车零部件",
    industries: ["电池", "乘用车", "商用车", "汽车零部", "汽车服务", "摩托车及"],
    nameKeywords: ["锂电", "锂能", "充电"],
    newsKeywords: ["新能源车", "锂电", "固态电池", "特斯拉", "比亚迪", "充电桩", "车企", "汽车零部件"],
    usSymbols: [
      { symbol: "usTSLA", name: "特斯拉", note: "全球新能源车龙头" },
      { symbol: "usLI", name: "理想汽车" },
      { symbol: "usNIO", name: "蔚来" },
      { symbol: "usXPEV", name: "小鹏汽车" },
    ],
  },
  {
    name: "光伏储能",
    desc: "光伏/风电/电网设备",
    industries: ["光伏设备", "风电设备", "电网设备", "其他电源", "电机Ⅱ"],
    nameKeywords: ["光伏", "风能", "储能", "特高压"],
    newsKeywords: ["光伏", "储能", "风电", "特高压", "虚拟电厂", "电网投资", "反内卷"],
    usSymbols: [
      { symbol: "usENPH", name: "Enphase", note: "微型逆变器" },
      { symbol: "usFSLR", name: "First Solar" },
    ],
  },
  {
    name: "医药",
    desc: "创新药/中药/器械/医药商业",
    industries: ["化学制药", "中药", "生物制品", "医疗器械", "医疗服务", "医药商业"],
    newsKeywords: ["医药", "创新药", "减肥药", "GLP-1", "中药", "集采", "疫苗", "CXO", "医保"],
    usSymbols: [
      { symbol: "usLLY", name: "礼来", note: "减肥药GLP-1" },
      { symbol: "usNVO", name: "诺和诺德", note: "司美格鲁肽" },
      { symbol: "usMRK", name: "默沙东" },
      { symbol: "usPFE", name: "辉瑞" },
    ],
  },
  {
    name: "军工低空",
    desc: "军工/低空经济/大飞机",
    industries: ["航空装备", "地面兵装", "军工电子"],
    nameKeywords: ["航空", "航天", "防务", "无人", "兵"],
    newsKeywords: ["军工", "低空经济", "无人机", "导弹", "军贸", "大飞机", "商业航天"],
    usSymbols: [],
  },
  {
    name: "地产基建",
    desc: "房地产/基建/建材",
    industries: ["房地产", "装修装饰", "装修建材", "基础建设", "专业工程", "水泥", "玻璃玻纤", "工程咨询"],
    nameKeywords: ["地产", "建设", "路桥", "城建"],
    newsKeywords: ["房地产", "地产", "基建", "城中村", "保障房", "房贷", "收储"],
    usSymbols: [],
  },
  {
    name: "金融",
    desc: "券商/银行/保险/多元金融",
    industries: ["证券", "多元金融", "保险", "银行"],
    nameKeywords: ["证券", "金融", "信托", "期货"],
    newsKeywords: ["券商", "降准", "降息", "资本市场", "并购重组", "互换便利", "中特估"],
    usSymbols: [
      { symbol: "usGS", name: "高盛" },
      { symbol: "usJPM", name: "摩根大通" },
    ],
  },
  {
    name: "AI应用传媒",
    desc: "传媒/游戏/出版/IP（AI应用落地方向）",
    industries: ["数字媒体", "影视院线", "出版", "广告营销", "游戏", "电视广播", "文娱用品"],
    nameKeywords: ["传媒", "文化", "影视", "数码"],
    newsKeywords: ["AI应用", "短剧", "游戏版号", "Sora", "大模型", "IP", "谷子经济", "电影"],
    usSymbols: [
      { symbol: "usNFLX", name: "奈飞" },
      { symbol: "usDIS", name: "迪士尼" },
    ],
  },
  {
    name: "大消费",
    desc: "白酒/食品饮料/零售/旅游/服装",
    industries: ["白酒", "饮料", "休闲食品", "调味发酵", "一般零售", "专业连锁", "旅游", "服装家纺", "饰品", "农产品加", "美容护理"],
    nameKeywords: ["食品", "酒", "零售", "百货", "旅游"],
    newsKeywords: ["消费", "免税", "以旧换新", "促消费", "白酒", "文旅", "节假日"],
    usSymbols: [
      { symbol: "usKO", name: "可口可乐" },
      { symbol: "usMCD", name: "麦当劳" },
      { symbol: "usNKE", name: "耐克" },
    ],
  },
  {
    name: "农业种业",
    desc: "种业/养殖/化肥（粮食安全）",
    industries: ["种植业", "养殖业", "林业", "饲料", "农化制品", "渔业"],
    nameKeywords: ["种业", "农业", "牧", "渔", "垦"],
    newsKeywords: ["种业", "转基因", "粮食安全", "猪价", "农业", "养殖", "水产"],
    usSymbols: [],
  },
  {
    name: "有色金属",
    desc: "工业金属/贵金属/稀土",
    industries: ["工业金属", "小金属", "贵金属", "普钢", "冶钢原料", "金属新材", "能源金属", "焦炭"],
    newsKeywords: ["稀土", "黄金", "铜价", "铝", "有色金属", "钨", "锂价", "战略金属"],
    usSymbols: [
      { symbol: "usFCX", name: "自由港", note: "铜矿" },
      { symbol: "usNEM", name: "纽蒙特", note: "黄金" },
    ],
  },
  {
    name: "煤炭油气",
    desc: "煤炭/石油/天然气（红利与能源）",
    industries: ["煤炭开采", "炼化及贸", "油服工程", "燃气", "焦炭Ⅱ"],
    newsKeywords: ["煤炭", "原油", "天然气", "油价", "OPEC", "红利"],
    usSymbols: [
      { symbol: "usXOM", name: "埃克森美孚" },
      { symbol: "usCVX", name: "雪佛龙" },
    ],
  },
  {
    name: "中概互联",
    desc: "美股中概股（纯美股侧映射，无A股行业归组）",
    newsKeywords: ["中概股", "阿里巴巴", "拼多多", "京东", "百度"],
    usSymbols: [
      { symbol: "usBABA", name: "阿里巴巴" },
      { symbol: "usPDD", name: "拼多多" },
      { symbol: "usJD", name: "京东" },
      { symbol: "usBIDU", name: "百度", note: "AI搜索/萝卜快跑" },
      { symbol: "usBILI", name: "哔哩哔哩" },
      { symbol: "usNTES", name: "网易" },
    ],
  },
];

/** 股票名规范化：去空格/星号等干扰字符（如 "七 匹 狼" → "七匹狼"） */
export function normalizeStockName(name: string): string {
  return (name ?? "").replace(/[\s*＊]/g, "").trim();
}

function industryHit(industry: string | null | undefined, fragments?: string[]): boolean {
  if (!industry || !fragments?.length) return false;
  return fragments.some((f) => industry.includes(f));
}

/** 判定一只股票归属哪些主线题材（可多归属；无命中返回空数组=仅行业层） */
export function matchThemes(
  stockName: string,
  industry: string | null | undefined
): string[] {
  const name = normalizeStockName(stockName);
  const hits: string[] = [];
  for (const rule of THEME_RULES) {
    let hit = false;
    if (!hit && rule.members?.some((m) => name === normalizeStockName(m))) hit = true;
    if (!hit && rule.nameKeywords?.some((k) => name.includes(k))) hit = true;
    if (!hit && industryHit(industry, rule.industries)) hit = true;
    if (hit) hits.push(rule.name);
  }
  return hits;
}

/** 新闻/资讯文本命中的主线题材明细（含命中的关键词，归类证据用） */
export function matchThemesInTextDetailed(text: string): { theme: string; hits: string[] }[] {
  const out: { theme: string; hits: string[] }[] = [];
  for (const rule of THEME_RULES) {
    const hits = (rule.newsKeywords ?? []).filter((k) => text.includes(k));
    if (hits.length > 0) out.push({ theme: rule.name, hits });
  }
  return out;
}

/** 新闻/资讯文本命中的主线题材（用 newsKeywords，不用行业白名单——新闻没有行业字段） */
export function matchThemesInText(text: string): string[] {
  return matchThemesInTextDetailed(text).map((x) => x.theme);
}

/** 美股代码 → 主线题材名（隔夜美股映射页用） */
export function usSymbolThemeMap(): Map<string, { theme: string; name: string; note?: string }> {
  const map = new Map<string, { theme: string; name: string; note?: string }>();
  for (const rule of THEME_RULES) {
    for (const us of rule.usSymbols ?? []) {
      map.set(us.symbol.replace(/^us/i, "").toUpperCase(), {
        theme: rule.name,
        name: us.name,
        note: us.note,
      });
    }
  }
  return map;
}
