import Fuse from "fuse.js";
import { GENERIC_TERMS, NEAR_RELATIONS } from "./dictionary";
import { codePointLength, isPinyinQuery, normalizeText } from "./normalize";
import { KNOWN_TERMS, canonicalize } from "./synonyms";
import type { MatchRoute, PreparedDish, SearchData, SearchHit, SearchOutcome } from "./types";

/**
 * 四层里的第 2、3 层：多路召回 + 加权排序。
 *
 * 召回全部在内存里做：1000 多条菜的精确/前缀/包含/别名/拼音都是 O(n) 字符串比较，
 * 编辑距离只在 Fuse 返回的少量候选上做（不会对全量菜名跑 Levenshtein）。
 * 同一道菜多路命中取最高分，不累加。
 */

/** 最长公共子串长度，用来在同一个 canon 组里挑更贴近用户原话的展示名 */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return best;
}

const SCORE = {
  nameExact: 100,
  namePrefix: 90,
  nameContains: 80,
  aliasExact: 85,
  aliasContains: 75,
  pinyinExact: 70,
  pinyinPrefix: 68,
  pinyinContains: 65,
  initialsExact: 60,
  initialsPrefix: 58,
  /** 汉字查询转拼音后的同音命中，低于直接输入正确拼音，高于模糊匹配 */
  homophoneExact: 62,
  homophonePrefix: 58,
  /** pinyin-pro 读错但确实有人这么读的拼音，按近似处理，压在正确拼音下面 */
  pinyinTypoExact: 55,
  pinyinTypoPrefix: 52,
  initialsTypoExact: 50,
  /** 词袋匹配：清蒸 + 鳜鱼 这种顺序不同的组合，按近似处理 */
  wordBag: 66,
  /** 不是严格同义词、但菜单里指向同一道菜的写法，标近似 */
  nearAlias: 62,
  /** 语序变体：字符相同、顺序不同，标近似 */
  anagram: 58,
  /** 编辑距离相似度上限，实际按 70 * (1 - 距离/长度) 折算 */
  fuzzyMax: 70,
  /** 食材别称预留位：等 ingredients 真正录入再启用 */
  ingredient: 40,
} as const;

const MIN_SCORE = 40;
const CACHE_SIZE = 50;
const FUZZY_CANDIDATES = 40;
const PINYIN_FUZZY_CANDIDATES = 30;

const GENERIC = new Set(GENERIC_TERMS.map(normalizeText));

type ScoredHit = {
  dish: PreparedDish;
  id: string;
  name: string;
  canon: string;
  norm: string;
  price: string;
  group: string;
  shopId: string;
  shopName: string;
  score: number;
  route: MatchRoute;
  tie: number;
  overlap: number;
  popularity: number;
  key: string;
};

type GroupedHit = SearchHit & {
  tie: number;
  popularity: number;
  minPrice: number;
  overlap: number;
};

/** 只取价格里的第一个数字：¥18、¥15/22、¥16（小）都按 18 / 15 / 16 排 */
function priceRank(price: string): number {
  const match = price.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;

  const left = Array.from(a);
  const right = Array.from(b);
  if (Math.abs(left.length - right.length) > max) return max + 1;

  let prev = new Array<number>(right.length + 1);
  let curr = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) prev[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    let rowMin = i;

    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > max) return max + 1;

    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[right.length];
}

type Closest = { distance: number; length: number };

function closest(
  query: string,
  targets: readonly string[],
  max: number,
  sameLengthOnly = false,
  firstCode?: number,
): Closest | null {
  let best: Closest | null = null;
  const queryLength = codePointLength(query);

  for (const target of targets) {
    if (!target) continue;
    if (firstCode !== undefined && target.codePointAt(0) !== firstCode) continue;
    const targetLength = codePointLength(target);
    if (sameLengthOnly && targetLength !== queryLength) continue;
    if (Math.abs(queryLength - targetLength) > max) continue;

    const distance = editDistance(query, target, max);
    if (distance > max) continue;
    if (!best || distance < best.distance) best = { distance, length: targetLength };
  }

  return best;
}

function fuzzyScore(query: string, match: Closest): number {
  const span = Math.max(codePointLength(query), match.length);
  const similarity = span === 0 ? 1 : 1 - match.distance / span;
  return Math.round(SCORE.fuzzyMax * similarity);
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** 拼音里的 v 是 ü 的键盘写法；u 也允许，所以每个拼音都同时给出 v/u 两个形态 */
function altPinyin(value: string): string {
  return value.includes("v") ? value.replaceAll("v", "u") : "";
}

function pinyinVariants(values: readonly string[]): string[] {
  return dedupe(values.flatMap((value) => [value, altPinyin(value)]));
}

/**
 * 汉字查询 → 拼音变体。
 * 多音字会展开，最多 32 种；表里没有的字直接放弃这条召回，避免半截拼音误伤。
 */
function queryPinyinVariants(query: string, table: Record<string, string[]>): string[] {
  const chars = Array.from(query).filter((char) => /\p{Script=Han}/u.test(char));
  if (!chars.length) return [];

  let variants = [""];
  for (const char of chars) {
    const readings = table[char];
    if (!readings?.length) return [];

    const next = new Set<string>();
    for (const prefix of variants) {
      for (const reading of readings) {
        if (next.size >= 32) break;
        next.add(prefix + reading);
        next.add((prefix + reading).replaceAll("v", "u"));
      }
    }
    variants = [...next].slice(0, 32);
  }
  return dedupe(variants);
}

/** 把查询按已知词做最长切分，用于「清蒸鳜鱼」这种顺序不同的词袋匹配 */
function tokenizeKnown(query: string, terms: readonly string[]): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < query.length) {
    let matched = "";
    for (const term of terms) {
      if (query.startsWith(term, index)) {
        matched = term;
        break;
      }
    }
    if (matched) {
      tokens.push(matched);
      index += matched.length;
    } else {
      index += 1;
    }
  }

  return dedupe(tokens);
}

export type SearchEngine = {
  search: (raw: string) => SearchOutcome;
  size: number;
};

export function createSearchEngine(data: SearchData): SearchEngine {
  const shops = data.shops;
  const dishes = data.dishes;
  const pinyinTable = data.pinyinTable ?? {};
  const knownTermList = [...KNOWN_TERMS]
    .filter((term) => codePointLength(term) >= 2)
    .sort((a, b) => codePointLength(b) - codePointLength(a));

  // 两套 Fuse 索引：中文模糊走菜名，英文模糊走拼音。
  // 它们只负责“产生候选”，真正的接受/拒绝和打分用上面的 editDistance。
  const nameFuse = new Fuse(dishes, {
    keys: ["norm", "canon", "aliases", "aliasCanon"],
    includeScore: true,
    threshold: 0.34,
    ignoreLocation: true,
    minMatchCharLength: 2,
    shouldSort: true,
  });

  const pinyinFuse = new Fuse(dishes, {
    keys: ["py", "cpy", "aliasPy"],
    includeScore: true,
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 3,
    shouldSort: true,
  });

  const cache = new Map<string, SearchOutcome>();

  const fuzzyName = (query: string, queryLength: number) => {
    const maxDistance = queryLength <= 4 ? 1 : 2;
    // 短名字只接受“同长度替换 + 首字相同”，避免红烧肉把红烧牛肉、
    // 小馄饨把汤馄饨也当成近似（那是另一道菜）
    const sameLengthOnly = queryLength <= 4;
    const firstCode = queryLength <= 4 ? query.codePointAt(0) : undefined;
    const found = nameFuse.search(query, { limit: FUZZY_CANDIDATES });
    const results = new Map<PreparedDish, number>();

    for (const result of found) {
      const dish = result.item;
      const targets = dedupe([dish.norm, dish.canon, ...dish.aliases, ...dish.aliasCanon]);
      const match = closest(query, targets, maxDistance, sameLengthOnly, firstCode);
      if (!match) continue;

      const score = fuzzyScore(query, match);
      if (score < MIN_SCORE) continue;

      const previous = results.get(dish);
      if (previous === undefined || score > previous) results.set(dish, score);
    }

    return results;
  };

  const fuzzyPinyin = (query: string, queryLength: number) => {
    const maxDistance = queryLength >= 12 ? 2 : 1;
    const found = pinyinFuse.search(query, { limit: PINYIN_FUZZY_CANDIDATES });
    const results = new Map<PreparedDish, number>();

    for (const result of found) {
      const dish = result.item;
      const targets = dedupe([dish.py, dish.cpy ?? "", ...dish.aliasPy]);
      const match = closest(query, targets, maxDistance);
      if (!match) continue;

      const score = fuzzyScore(query, match);
      if (score < MIN_SCORE) continue;

      const previous = results.get(dish);
      if (previous === undefined || score > previous) results.set(dish, score);
    }

    return results;
  };

  /** 零结果时给 2–3 个可直接点击的菜名建议；只在默认无结果时使用 */
  const suggestNames = (query: string, queryCanon: string): string[] => {
    if (!/[\u4e00-\u9fff]/.test(query) || codePointLength(query) < 2) return [];
    const ranked = new Map<string, number>();

    const add = (name: string, score: number): void => {
      if (codePointLength(name) <= 2 || GENERIC.has(normalizeText(name))) return;
      if (name === query) return;
      ranked.set(name, Math.max(ranked.get(name) ?? 0, score));
    };

    const relation = NEAR_RELATIONS[queryCanon];
    if (relation) {
      for (const dish of dishes) {
        const targets = [dish.norm, dish.canon, ...dish.aliasCanon];
        if (relation.targets.some((target) => targets.some((value) => value.includes(target)))) {
          add(dish.name, 100);
        }
      }
    }

    const found = nameFuse.search(query, { limit: 15 });
    for (const result of found) {
      const dish = result.item;
      const targets = dedupe([dish.norm, dish.canon, ...dish.aliases, ...dish.aliasCanon]);
      const direct = targets.find((target) => target.includes(query));
      if (direct) {
        add(dish.name, 80);
        continue;
      }
      const match = closest(query, targets, 2);
      if (!match) continue;
      const score = fuzzyScore(query, match);
      if (score >= 45) add(dish.name, score);
    }

    return [...ranked.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
      .slice(0, 3)
      .map(([name]) => name);
  };

  const run = (query: string): SearchOutcome => {
    if (!query) return { hits: [], total: 0 };

    // 泛类别本身不返回结果：输入「米饭」「面条」「盖浇饭」是来逛菜单的，
    // 不是来点名某道菜的。具体到「黄焖鸡米饭」「鱼香肉丝盖浇饭」仍然能搜。
    if (GENERIC.has(query)) return { hits: [], total: 0, reason: "generic" };

    const queryCanon = canonicalize(query);
    const queryLength = codePointLength(query);
    const pinyinQuery = isPinyinQuery(query);
    // 1 个字一律不用“包含”；2 个字默认也不用，避免「饭」「面」「鸡丁」把整本菜单捞出来。
    // 例外是词典里的具体名词：「馄饨」「烧卖」「土豆」「洋芋」「花甲」——
    // 它们本身指向明确食材/品类，允许用来包含匹配「鲜肉小馄饨」「香菇糯米烧卖」。
    // 「盖浇饭」这类泛词即使 3 个字也仍然被 generic 拦住。
    const synonymQuery = queryCanon !== query;
    const knownTerm = KNOWN_TERMS.has(query) || KNOWN_TERMS.has(queryCanon);
    const allowContains = queryLength >= 3 || (queryLength >= 2 && (synonymQuery || knownTerm));
    // 别名的“包含”只对 3 个字以上开放：两个字时同义词已经由 canonicalize 覆盖，
    // 再拿别名去包含只会把「鸡蛋」扩散成所有「蛋X」的变体。
    const allowAliasContains = queryLength >= 3;
    // 汉字查询转拼音：觉鱼 / 绝鱼 → jueyu，再去匹配鳜鱼的错误读音
    const queryPinyin =
      !pinyinQuery && queryLength >= 2 ? queryPinyinVariants(query, pinyinTable) : [];
    const queryTokens = queryLength >= 3 ? tokenizeKnown(queryCanon, knownTermList) : [];

    const scored = new Map<PreparedDish, ScoredHit>();

    for (const dish of dishes) {
      let score = 0;
      let route: MatchRoute = "name";
      const overlap = longestCommonSubstring(query, dish.norm);

      // 1) 菜名精确 / 2) 前缀 / 3) 包含（规范化后比较，别名差异已在 canon 里抹平）
      if (dish.norm === query || dish.canon === queryCanon) {
        score = SCORE.nameExact;
      } else if (dish.norm.startsWith(query) || dish.canon.startsWith(queryCanon)) {
        score = SCORE.namePrefix;
      } else if (allowContains && (dish.norm.includes(query) || dish.canon.includes(queryCanon))) {
        score = SCORE.nameContains;
      }

      // 4) 别名精确 / 5) 别名包含
      if (score < SCORE.aliasExact && dish.aliases.length) {
        for (let index = 0; index < dish.aliases.length; index += 1) {
          const alias = dish.aliases[index];
          const aliasCanon = dish.aliasCanon[index] ?? alias;

          if (alias === query || aliasCanon === queryCanon) {
            score = SCORE.aliasExact;
            route = "alias";
            break;
          }
          if (allowAliasContains && (alias.includes(query) || aliasCanon.includes(queryCanon))) {
            if (score < SCORE.aliasContains) {
              score = SCORE.aliasContains;
              route = "alias";
            }
          }
        }
      }

      // 6) 拼音全拼 / 7) 拼音首字母
      // 纯字母输入直接按拼音；汉字输入先转拼音，再按同音/近音算（结果标「近似」）
      const pinyinCandidates = pinyinQuery ? [query] : queryPinyin;
      if (pinyinCandidates.length) {
        const fullNames = pinyinVariants([dish.py, dish.cpy ?? "", ...dish.aliasPy]);
        const typoFull = pinyinVariants([
          ...(dish.pyTypo ?? []),
          ...(dish.cpyTypo ?? []),
          ...(dish.aliasPyTypo ?? []),
        ]);
        const initials = dedupe([dish.ini, dish.cini ?? "", ...dish.aliasIni]);
        const typoInitials = dedupe([
          ...(dish.iniTypo ?? []),
          ...(dish.ciniTypo ?? []),
          ...(dish.aliasIniTypo ?? []),
        ]);

        for (const candidate of pinyinCandidates) {
          const exactScore = pinyinQuery ? SCORE.pinyinExact : SCORE.homophoneExact;
          const prefixScore = pinyinQuery ? SCORE.pinyinPrefix : SCORE.homophonePrefix;
          const pinyinRoute: MatchRoute = pinyinQuery ? "pinyin" : "pinyinTypo";

          if (fullNames.includes(candidate)) {
            if (score < exactScore) {
              score = exactScore;
              route = pinyinRoute;
            }
          } else if (
            candidate.length >= 3 &&
            fullNames.some((value) => value.startsWith(candidate))
          ) {
            if (score < prefixScore) {
              score = prefixScore;
              route = pinyinRoute;
            }
          } else if (
            pinyinQuery &&
            candidate.length >= 5 &&
            score < SCORE.pinyinContains &&
            fullNames.some((value) => value.includes(candidate))
          ) {
            // 中文转拼音后只做精确/前缀：contains 会把「觉鱼」(jiaoyu) 误伤到「剁椒鱼头」
            score = SCORE.pinyinContains;
            route = pinyinRoute;
          }

          // 错误读音（如鳜鱼的 jueyu）只按近似算，分数一定低于正确拼音
          if (typoFull.includes(candidate)) {
            if (score < SCORE.pinyinTypoExact) {
              score = SCORE.pinyinTypoExact;
              route = "pinyinTypo";
            }
          } else if (
            candidate.length >= 3 &&
            typoFull.some((value) => value.startsWith(candidate))
          ) {
            if (score < SCORE.pinyinTypoPrefix) {
              score = SCORE.pinyinTypoPrefix;
              route = "pinyinTypo";
            }
          }

          // 首字母只对纯字母输入有意义；汉字转出来的拼音不参与首字母
          if (pinyinQuery) {
            if (initials.includes(candidate)) {
              if (score < SCORE.initialsExact) {
                score = SCORE.initialsExact;
                route = "initials";
              }
            } else if (
              candidate.length >= 3 &&
              initials.some((value) => value.startsWith(candidate))
            ) {
              if (score < SCORE.initialsPrefix) {
                score = SCORE.initialsPrefix;
                route = "initials";
              }
            }

            if (typoInitials.includes(candidate) && score < SCORE.initialsTypoExact) {
              score = SCORE.initialsTypoExact;
              route = "pinyinTypo";
            }
          }
        }
      }

      // 8.4) 近义写法：confidence 决定近似分数，note 作为可解释说明
      const nearRelation = NEAR_RELATIONS[queryCanon];
      if (nearRelation && score < SCORE.nearAlias) {
        const nearScore = Math.round(50 + nearRelation.confidence * 20);
        const targets = [dish.norm, dish.canon, ...dish.aliasCanon];
        if (
          nearRelation.targets.some((target) => targets.some((value) => value.includes(target)))
        ) {
          score = nearScore;
          route = "nearAlias";
        }
      }

      // 8.45) 语序变体：生菜蚝油 / 蚝油生菜、玉米松仁 / 松仁玉米
      if (queryLength >= 4 && score < SCORE.anagram) {
        const sortedQuery = [...queryCanon].sort().join("");
        const sortedName = [...dish.norm].sort().join("");
        if (sortedQuery === sortedName) {
          score = SCORE.anagram;
          route = "anagram";
        }
      }

      // 8.5) 词袋：清蒸鳜鱼 / 松子鳜鱼 / 清蒸桂鱼，顺序和原文不同也能命中
      if (queryTokens.length >= 2 && score < SCORE.wordBag) {
        const targets = [dish.norm, dish.canon, ...dish.aliasCanon];
        if (queryTokens.every((token) => targets.some((value) => value.includes(token)))) {
          score = SCORE.wordBag;
          route = "wordBag";
        }
      }

      if (score >= MIN_SCORE) {
        // 泛词只做同分内的弱加权：不改变分数档次，不会把「鱼香肉丝盖浇饭」
        // 抬到「鱼香肉丝」前面去。
        let tie = 0;
        if (!pinyinQuery) {
          for (const term of GENERIC) {
            if (query.includes(term) && (dish.norm.includes(term) || dish.canon.includes(term))) {
              tie = 3;
              break;
            }
          }
        }

        const shop = shops[dish.shop];
        scored.set(dish, {
          dish,
          id: dish.id,
          name: dish.name,
          canon: dish.canon,
          norm: dish.norm,
          price: dish.price,
          group: dish.group,
          shopId: shop?.id ?? "",
          shopName: shop?.name ?? "",
          score,
          route,
          tie,
          overlap,
          popularity: dish.popularity,
          key: `${dish.shop}:${dish.norm}`,
        });
      }
    }

    // 8) 编辑距离相似度：只对 Fuse 给出的候选做 Levenshtein
    if (queryLength >= 3) {
      const fuzzy = pinyinQuery
        ? queryLength >= 5
          ? fuzzyPinyin(query, queryLength)
          : new Map<PreparedDish, number>()
        : fuzzyName(query, queryLength);

      for (const [dish, score] of fuzzy) {
        if (score < MIN_SCORE) continue;
        const existing = scored.get(dish);
        if (existing && existing.score >= score) continue;

        const shop = shops[dish.shop];
        scored.set(dish, {
          dish,
          id: dish.id,
          name: dish.name,
          canon: dish.canon,
          norm: dish.norm,
          price: dish.price,
          group: dish.group,
          shopId: shop?.id ?? "",
          shopName: shop?.name ?? "",
          score,
          route: "fuzzy",
          tie: existing?.tie ?? 0,
          overlap: existing?.overlap ?? 0,
          popularity: dish.popularity,
          key: `${dish.shop}:${dish.norm}`,
        });
      }
    }

    // 同一家店同名菜只留一条（不同分组重复录入时常见）
    const unique = new Map<string, ScoredHit>();
    for (const hit of scored.values()) {
      const previous = unique.get(hit.key);
      if (!previous || hit.score > previous.score) unique.set(hit.key, hit);
    }

    const rows = [...unique.values()].sort(
      (a, b) =>
        b.score - a.score ||
        b.overlap - a.overlap ||
        b.tie - a.tie ||
        b.popularity - a.popularity ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name, "zh-Hans-CN") ||
        priceRank(a.price) - priceRank(b.price) ||
        a.shopName.localeCompare(b.shopName, "zh-Hans-CN"),
    );

    // 同义词和跨店同款合成一张卡：按 canon 分组，组里每个店一行
    const buckets = new Map<string, ScoredHit[]>();
    for (const row of rows) {
      const bucket = buckets.get(row.canon);
      if (bucket) bucket.push(row);
      else buckets.set(row.canon, [row]);
    }

    const groups: GroupedHit[] = [];
    for (const [canon, bucket] of buckets) {
      // 展示名：用户输入的字面写法 > 与原话重合最多（鲜肉包优先鲜肉小笼包）
      // > 规范写法（norm === canon）> 出现次数 > 短 > 字典序
      const literal = bucket.find((row) => row.norm === query);
      const counts = new Map<string, number>();
      for (const row of bucket) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
      const display =
        literal ??
        [...bucket].sort(
          (a, b) =>
            b.overlap - a.overlap ||
            Number(b.norm === b.canon) - Number(a.norm === a.canon) ||
            (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0) ||
            a.name.length - b.name.length ||
            a.name.localeCompare(b.name, "zh-Hans-CN"),
        )[0];
      if (!display) continue;

      // 同一家店同一个 canon 只留一条，取便宜的那条
      const byShop = new Map<string, ScoredHit>();
      for (const row of bucket) {
        const previous = byShop.get(row.shopId);
        if (!previous || priceRank(row.price) < priceRank(previous.price)) {
          byShop.set(row.shopId, row);
        }
      }

      const shops = [...byShop.values()]
        .sort(
          (a, b) =>
            b.overlap - a.overlap ||
            priceRank(a.price) - priceRank(b.price) ||
            a.shopName.localeCompare(b.shopName, "zh-Hans-CN"),
        )
        .map((row) => ({
          shopId: row.shopId,
          shopName: row.shopName,
          price: row.price,
          group: row.group,
          name: row.name,
        }));

      const aliases = dedupe(
        bucket.map((row) => row.name).filter((name) => name !== display.name),
      ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

      const best = bucket.reduce((a, b) => (b.score > a.score ? b : a));
      const minPrice = shops.reduce(
        (min, shop) => Math.min(min, priceRank(shop.price)),
        Number.POSITIVE_INFINITY,
      );

      groups.push({
        id: canon,
        name: display.name,
        canon,
        score: best.score,
        route: best.route,
        shops,
        aliases,
        tie: Math.max(...bucket.map((row) => row.tie)),
        popularity: Math.max(...bucket.map((row) => row.popularity)),
        minPrice,
        overlap: Math.max(...bucket.map((row) => row.overlap)),
      });
    }

    groups.sort(
      (a, b) =>
        b.score - a.score ||
        b.overlap - a.overlap ||
        b.tie - a.tie ||
        b.popularity - a.popularity ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name, "zh-Hans-CN") ||
        a.minPrice - b.minPrice ||
        (a.shops[0]?.shopName ?? "").localeCompare(b.shops[0]?.shopName ?? "", "zh-Hans-CN"),
    );

    // 两个字以内的菜（土豆、白菜、卤蛋、米饭…）不返回：它们要么是涮菜/浇头，
    // 要么是主食，搜出来没有决策价值；这条规则在搜索框注释里向用户说明。
    const visibleGroups = groups.filter((group) => codePointLength(group.name) > 2);

    const total = visibleGroups.length;
    const hits = visibleGroups.map(
      ({ tie: _tie, popularity: _popularity, minPrice: _minPrice, overlap: _overlap, ...hit }) =>
        hit,
    );

    const reason: SearchOutcome["reason"] =
      total === 0 && queryLength <= 2 && !knownTerm && !synonymQuery ? "short" : undefined;

    const suggestions = total === 0 && reason === undefined ? suggestNames(query, queryCanon) : [];

    return {
      hits,
      total,
      ...(reason ? { reason } : {}),
      ...(suggestions.length > 0 ? { suggestions } : {}),
    };
  };

  return {
    size: dishes.length,
    search(raw: string) {
      // ü 在拼音输入里通常打成 v，查询侧也统一一下
      const query = normalizeText(raw).replace(/ü/g, "v");
      if (!query) return { hits: [], total: 0 };

      const cached = cache.get(query);
      if (cached) return cached;

      const outcome = run(query);
      cache.set(query, outcome);
      if (cache.size > CACHE_SIZE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return outcome;
    },
  };
}
