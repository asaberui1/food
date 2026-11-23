import relations from "../../data/alias-relations.json";
import vegetables from "../../data/vegetables.json";
import { normalizeText } from "./normalize";

/**
 * 同菜异名/近义关系数据。
 *
 * 关系不再散落在代码里的字符串数组中，而是数据文件：
 * - exact: 可安全规范化的同义词（canonical + members）
 * - near: 相关但不是严格同义的写法（targets + confidence + note）
 *
 * exact 关系用于 canonicalize；near 关系用于带「近似」标签的召回。
 */

export type AliasRelationKind = "exact" | "near";

export type ExactAliasRelation = {
  canonical: string;
  members: readonly string[];
  kind: "exact";
  confidence: number;
  note: string;
};

export type NearAliasRelation = {
  from: string;
  targets: readonly string[];
  confidence: number;
  note: string;
};

export const ALIAS_RELATIONS = relations as {
  version: number;
  exact: readonly ExactAliasRelation[];
  near: readonly NearAliasRelation[];
};

export type VegetableGroup = {
  canonical: string;
  aliases: readonly string[];
  note: string;
};

export const VEGETABLE_GROUPS = vegetables.groups as readonly VegetableGroup[];

export const VEGETABLE_CATEGORY_TERMS: ReadonlySet<string> = new Set(
  vegetables.categoryTerms.map(normalizeText),
);

/** 菜名里的蔬菜叫法 → 规范名；用于「时蔬」类目召回和近义蔬菜扩散 */
const VEGETABLE_CANONICAL = new Map<string, string>();
for (const group of VEGETABLE_GROUPS) {
  for (const term of [group.canonical, ...group.aliases]) {
    VEGETABLE_CANONICAL.set(normalizeText(term), normalizeText(group.canonical));
  }
}

export function vegetableCanonical(value: string): string | undefined {
  return VEGETABLE_CANONICAL.get(normalizeText(value));
}

export function vegetablesIn(value: string): string[] {
  const norm = normalizeText(value);
  const found = new Set<string>();
  for (const [term, canonical] of VEGETABLE_CANONICAL) {
    if (norm.includes(term)) found.add(canonical);
  }
  return [...found];
}

export function isVegetableCategory(value: string): boolean {
  return VEGETABLE_CATEGORY_TERMS.has(normalizeText(value));
}

/**
 * 两字菜名里，本身就算一道菜的（肴蹄、河鳗、烧麦…）放出来；
 * 涮菜、浇头、配料（光面、土豆、卤蛋…）仍然按原规则隐藏。
 */
const STANDALONE_TWO_CHAR = new Set(
  ["肴蹄", "河鳗", "河虾", "甲鱼", "草虾", "青蟹", "炝饼", "烧麦", "麻饼", "羊糕"].map(normalizeText),
);

export function isStandaloneTwoChar(value: string): boolean {
  return STANDALONE_TWO_CHAR.has(normalizeText(value));
}

export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ...ALIAS_RELATIONS.exact.map((relation) => [relation.canonical, ...relation.members]),
  ...VEGETABLE_GROUPS.map((group) => [group.canonical, ...group.aliases]),
];

export type NearRelation = {
  targets: readonly string[];
  confidence: number;
  note: string;
};

export const NEAR_RELATIONS: Readonly<Record<string, NearRelation>> = Object.fromEntries(
  ALIAS_RELATIONS.near.map((relation) => [
    relation.from,
    {
      targets: relation.targets,
      confidence: relation.confidence,
      note: relation.note,
    },
  ]),
);

export const DISH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // 目前别名都能用同义词组表达；保留这个入口给以后没法拆词的整菜别名。
};

/**
 * pinyin-pro 读错/多音字纠正表。
 *
 * 规范读音写在 correct 里；pinyin-pro 给出的错误读音进 misread，
 * 搜索时按“近似”计分（低于正确拼音，但高于普通模糊匹配），
 * 这样既尊重规范读音，也不会让按错读输入的人完全搜不到。
 */
export type PinyinOverride = {
  term: string;
  correct: string;
  correctInitials: string;
  misread: readonly string[];
  misreadInitials: readonly string[];
};

export const PINYIN_OVERRIDES: readonly PinyinOverride[] = [
  {
    term: "鳜鱼",
    correct: "guiyu",
    correctInitials: "gy",
    misread: ["jueyu"],
    misreadInitials: ["jy"],
  },
  {
    term: "饸饹",
    correct: "hele",
    correctInitials: "hl",
    misread: ["hege"],
    misreadInitials: ["hg"],
  },
];

export const GENERIC_TERMS: readonly string[] = [
  "饭",
  "面",
  "汤",
  "粉",
  "粥",
  "饼",
  "馍",
  "饺",
  "包",
  "盖浇饭",
  "盖饭",
  "盖浇面",
  "浇头",
  "套餐",
  "单人餐",
  "小吃",
  "主食",
  "快餐",
  "家常菜",
  "小炒",
  "炒菜",
  "汤面",
  "拌面",
  "炒面",
  "炒饭",
  "泡饭",
  "汤饭",
  "砂锅",
  "煲仔",
  "干锅",
  "面食",
  "米粉",
  "河粉",
  "粉丝",
  "米饭",
  "白饭",
  "稀饭",
  "面条",
  "挂面",
  "米线",
  "粉条",
  "饺子",
  "包子",
  "馒头",
  "花卷",
  "烧饼",
];
