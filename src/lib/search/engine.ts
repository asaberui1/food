import Fuse from "fuse.js";
import { GENERIC_TERMS } from "./dictionary";
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
  /** 编辑距离相似度上限，实际按 70 * (1 - 距离/长度) 折算 */
  fuzzyMax: 70,
  /** 食材别称预留位：等 ingredients 真正录入再启用 */
  ingredient: 40,
} as const;

const MIN_SCORE = 40;
const MAX_RESULTS = 10;
const CACHE_SIZE = 50;
const FUZZY_CANDIDATES = 40;
const PINYIN_FUZZY_CANDIDATES = 30;

const GENERIC = new Set(GENERIC_TERMS.map(normalizeText));

type ScoredHit = SearchHit & {
  tie: number;
  popularity: number;
  key: string;
};

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
): Closest | null {
  let best: Closest | null = null;
  const queryLength = codePointLength(query);

  for (const target of targets) {
    if (!target) continue;
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

export type SearchEngine = {
  search: (raw: string) => SearchOutcome;
  size: number;
};

export function createSearchEngine(data: SearchData): SearchEngine {
  const shops = data.shops;
  const dishes = data.dishes;

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

  const fuzzyName = (query: string, queryCanon: string, queryLength: number) => {
    const maxDistance = queryLength <= 4 ? 1 : 2;
    // 短名字只接受“同长度替换”，避免红烧肉把红烧牛肉也捞进来（那是另一道菜）
    const sameLengthOnly = queryLength <= 4;
    const found = nameFuse.search(queryCanon, { limit: FUZZY_CANDIDATES });
    const results = new Map<PreparedDish, number>();

    for (const result of found) {
      const dish = result.item;
      const targets = dedupe([dish.norm, dish.canon, ...dish.aliases, ...dish.aliasCanon]);
      const match = closest(query, targets, maxDistance, sameLengthOnly);
      if (!match) continue;

      const score = fuzzyScore(query, match);
      if (score < MIN_SCORE) continue;

      const previous = results.get(dish);
      if (previous === undefined || score > previous) results.set(dish, score);
    }

    return results;
  };

  const fuzzyPinyin = (query: string, queryLength: number) => {
    const maxDistance = queryLength >= 10 ? 2 : 1;
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

  const run = (query: string): SearchOutcome => {
    if (!query) return { hits: [], total: 0 };

    const queryCanon = canonicalize(query);
    const queryLength = codePointLength(query);
    const pinyinQuery = isPinyinQuery(query);
    const generic = GENERIC.has(query);
    // 1 个字一律不用“包含”；2 个字默认也不用，避免「饭」「面」「鸡丁」把整本菜单捞出来。
    // 例外是词典里的具体名词：「馄饨」「烧卖」「土豆」「洋芋」「花甲」——
    // 它们本身指向明确食材/品类，允许用来包含匹配「鲜肉小馄饨」「香菇糯米烧卖」。
    // 「盖浇饭」这类泛词即使 3 个字也仍然被 generic 拦住。
    const synonymQuery = queryCanon !== query;
    const knownTerm = KNOWN_TERMS.has(query) || KNOWN_TERMS.has(queryCanon);
    const allowContains =
      !generic && (queryLength >= 3 || (queryLength >= 2 && (synonymQuery || knownTerm)));

    const scored = new Map<PreparedDish, ScoredHit>();

    for (const dish of dishes) {
      let score = 0;
      let route: MatchRoute = "name";

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
          if (allowContains && (alias.includes(query) || aliasCanon.includes(queryCanon))) {
            if (score < SCORE.aliasContains) {
              score = SCORE.aliasContains;
              route = "alias";
            }
          }
        }
      }

      // 6) 拼音全拼 / 7) 拼音首字母：只在输入是纯字母时启用
      if (pinyinQuery) {
        const fullNames = dedupe([dish.py, dish.cpy ?? ""]);
        const initials = dedupe([dish.ini, dish.cini ?? ""]);
        const aliasFull = dish.aliasPy;
        const aliasInitials = dish.aliasIni;

        if (fullNames.includes(query) || aliasFull.includes(query)) {
          if (score < SCORE.pinyinExact) {
            score = SCORE.pinyinExact;
            route = "pinyin";
          }
        } else if (queryLength >= 3) {
          const prefixHit =
            fullNames.some((value) => value.startsWith(query)) ||
            aliasFull.some((value) => value.startsWith(query));
          if (prefixHit && score < SCORE.pinyinPrefix) {
            score = SCORE.pinyinPrefix;
            route = "pinyin";
          } else if (
            queryLength >= 5 &&
            score < SCORE.pinyinContains &&
            (fullNames.some((value) => value.includes(query)) ||
              aliasFull.some((value) => value.includes(query)))
          ) {
            score = SCORE.pinyinContains;
            route = "pinyin";
          }
        }

        if (initials.includes(query) || aliasInitials.includes(query)) {
          if (score < SCORE.initialsExact) {
            score = SCORE.initialsExact;
            route = "initials";
          }
        } else if (queryLength >= 3) {
          const initialsHit =
            initials.some((value) => value.startsWith(query)) ||
            aliasInitials.some((value) => value.startsWith(query));
          if (initialsHit && score < SCORE.initialsPrefix) {
            score = SCORE.initialsPrefix;
            route = "initials";
          }
        }
      }

      if (score >= MIN_SCORE) {
        // 泛词只做同分内的弱加权：不改变分数档次，不会把「鱼香肉丝盖浇饭」
        // 抬到「鱼香肉丝」前面去。
        let tie = 0;
        if (!generic && !pinyinQuery) {
          for (const term of GENERIC) {
            if (query.includes(term) && (dish.norm.includes(term) || dish.canon.includes(term))) {
              tie = 3;
              break;
            }
          }
        }

        const shop = shops[dish.shop];
        scored.set(dish, {
          id: dish.id,
          name: dish.name,
          price: dish.price,
          group: dish.group,
          shopId: shop?.id ?? "",
          shopName: shop?.name ?? "",
          score,
          route,
          tie,
          popularity: dish.popularity,
          key: `${dish.shop}:${dish.norm}`,
        });
      }
    }

    // 8) 编辑距离相似度：只对 Fuse 给出的候选做 Levenshtein
    if (queryLength >= 3 && !generic) {
      const fuzzy = pinyinQuery
        ? queryLength >= 5
          ? fuzzyPinyin(query, queryLength)
          : new Map<PreparedDish, number>()
        : fuzzyName(query, queryCanon, queryLength);

      for (const [dish, score] of fuzzy) {
        if (score < MIN_SCORE) continue;
        const existing = scored.get(dish);
        if (existing && existing.score >= score) continue;

        const shop = shops[dish.shop];
        scored.set(dish, {
          id: dish.id,
          name: dish.name,
          price: dish.price,
          group: dish.group,
          shopId: shop?.id ?? "",
          shopName: shop?.name ?? "",
          score,
          route: "fuzzy",
          tie: existing?.tie ?? 0,
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

    const sorted = [...unique.values()].sort(
      (a, b) =>
        b.score - a.score ||
        b.tie - a.tie ||
        b.popularity - a.popularity ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name, "zh-Hans-CN"),
    );

    const total = sorted.length;
    const hits = sorted
      .slice(0, MAX_RESULTS)
      .map(({ tie: _tie, popularity: _popularity, key: _key, ...hit }) => hit);

    return {
      hits,
      total,
      ...(total === 0 && generic ? { reason: "generic" as const } : {}),
    };
  };

  return {
    size: dishes.length,
    search(raw: string) {
      const query = normalizeText(raw);
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
