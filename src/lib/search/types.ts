/** 搜索索引与搜索引擎共用的类型。索引在构建期生成，浏览器只做召回和排序。 */

export type ShopRef = { id: string; name: string };

/**
 * 一条预处理好的菜。
 *
 * - norm / canon：原名与“同义词规范化”后的名字，都去了空格标点、统一了大小写
 * - py / ini：原名的拼音全拼与首字母（pinyin-pro 在构建期生成）
 * - cpy / cini：规范化名字的拼音，只在和原名不同时存在
 * - aliases / aliasCanon / aliasPy / aliasIni：别名（已标准化）、规范化别名、拼音，四个数组一一对应
 *
 * ingredients 与 popularity 是预留位：目前固定为空数组 / 0，排序里留了弱加权入口。
 */
export type PreparedDish = {
  id: string;
  /** 指向 SearchData.shops 的下标，避免每条菜重复存店名 */
  shop: number;
  name: string;
  price: string;
  group: string;
  norm: string;
  canon: string;
  py: string;
  ini: string;
  cpy?: string;
  cini?: string;
  /** pinyin-pro 的错误读音，按“近似”计分，例如鳜鱼的 jueyu */
  pyTypo?: string[];
  iniTypo?: string[];
  cpyTypo?: string[];
  ciniTypo?: string[];
  aliases: string[];
  aliasCanon: string[];
  aliasPy: string[];
  aliasIni: string[];
  aliasPyTypo?: string[];
  aliasIniTypo?: string[];
  ingredients: string[];
  popularity: number;
};

export type SearchData = {
  version: 1;
  shops: ShopRef[];
  dishes: PreparedDish[];
  /** 汉字 → 拼音（可能多音），用于把中文查询转成拼音后做同音/近音召回 */
  pinyinTable: Record<string, string[]>;
};

export type MatchRoute =
  | "name"
  | "alias"
  | "pinyin"
  | "initials"
  | "pinyinTypo"
  | "wordBag"
  | "nearAlias"
  | "anagram"
  | "fuzzy"
  | "ingredient";

/** 聚合卡片里的一家店 */
export type SearchShop = {
  shopId: string;
  shopName: string;
  price: string;
  group: string;
  /** 这家店菜单上的原始写法，可能和卡片标题不同（西红柿炒鸡蛋 / 番茄炒蛋） */
  name: string;
};

/** 一道菜一张卡：同义词（番茄炒蛋 / 西红柿炒鸡蛋）和跨店同款都收进 shops */
export type SearchHit = {
  id: string;
  /** 展示名，优先用户输入的字面写法，其次是规范写法 */
  name: string;
  /** 同义词规范化后的分组键 */
  canon: string;
  score: number;
  route: MatchRoute;
  shops: SearchShop[];
  /** 同组里和展示名不同的写法，UI 用「也叫：…」列出来 */
  aliases: string[];
};

export type SearchOutcome = {
  /** 所有结果；UI 默认只渲染前 10 条，可展开剩余 */
  hits: SearchHit[];
  /** 去重后的菜品数（同义词算一道），不是店铺条目数 */
  total: number;
  /** generic：命中“盖浇饭”这类泛词被压制；short：两个字且不是具体名词，没敢做包含召回 */
  reason?: "generic" | "short";
  /** 零结果时最多 3 个可点击的菜名建议 */
  suggestions?: string[];
};
