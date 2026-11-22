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
  aliases: string[];
  aliasCanon: string[];
  aliasPy: string[];
  aliasIni: string[];
  ingredients: string[];
  popularity: number;
};

export type SearchData = {
  version: 1;
  shops: ShopRef[];
  dishes: PreparedDish[];
};

export type MatchRoute = "name" | "alias" | "pinyin" | "initials" | "fuzzy" | "ingredient";

export type SearchHit = {
  id: string;
  name: string;
  price: string;
  group: string;
  shopId: string;
  shopName: string;
  score: number;
  route: MatchRoute;
};

export type SearchOutcome = {
  hits: SearchHit[];
  /** 去重后、截断到 10 条之前的总数 */
  total: number;
  /** generic：命中“盖浇饭”这类泛词被压制；short：两个字且不是具体名词，没敢做包含召回 */
  reason?: "generic" | "short";
};
