import { SYNONYM_GROUPS } from "./dictionary";
import { normalizeText } from "./normalize";

/**
 * 同义词词典的 trie。
 *
 * 用“最长匹配”而不是简单 replace：先命中的词整体替换，替换结果不再参与后续匹配，
 * 所以「洋芋艿」不会被拆成「洋芋」+「艿」，也不会把「皮蛋」里的「蛋」再换一次。
 */

type TrieNode = {
  children: Map<string, TrieNode>;
  /** SYNONYM_GROUPS 的下标 */
  group?: number;
};

const ROOT: TrieNode = { children: new Map() };

/** 词典里出现过的规范词/别名，用来判断两个字到底是不是“具体名词” */
export const KNOWN_TERMS = new Set<string>();

for (let group = 0; group < SYNONYM_GROUPS.length; group += 1) {
  for (const term of SYNONYM_GROUPS[group]) {
    const norm = normalizeText(term);
    if (!norm) continue;
    KNOWN_TERMS.add(norm);
    let node = ROOT;
    for (const char of norm) {
      let next = node.children.get(char);
      if (!next) {
        next = { children: new Map() };
        node.children.set(char, next);
      }
      node = next;
    }
    node.group = group;
  }
}

export type SynonymMatch = {
  /** 在 code point 数组里的起点 */
  index: number;
  length: number;
  text: string;
  canonical: string;
  group: number;
};

export function findSynonymMatches(value: string): SynonymMatch[] {
  const chars = Array.from(value);
  const matches: SynonymMatch[] = [];
  let index = 0;

  while (index < chars.length) {
    let node = ROOT;
    let bestGroup: number | undefined;
    let bestLength = 0;

    for (let end = index; end < chars.length; end += 1) {
      const next = node.children.get(chars[end]);
      if (!next) break;
      node = next;
      if (node.group !== undefined) {
        bestGroup = node.group;
        bestLength = end - index + 1;
      }
    }

    if (bestGroup !== undefined && bestLength > 0) {
      const canonical = normalizeText(SYNONYM_GROUPS[bestGroup][0]);
      matches.push({
        index,
        length: bestLength,
        text: chars.slice(index, index + bestLength).join(""),
        canonical,
        group: bestGroup,
      });
      index += bestLength;
    } else {
      index += 1;
    }
  }

  return matches;
}

/** 把同义词都换成规范词，得到用于精确/前缀/包含匹配的 canon */
export function canonicalize(value: string): string {
  const matches = findSynonymMatches(value);
  if (!matches.length) return value;

  const chars = Array.from(value);
  const out: string[] = [];
  let cursor = 0;

  for (const match of matches) {
    out.push(chars.slice(cursor, match.index).join(""), match.canonical);
    cursor = match.index + match.length;
  }
  out.push(chars.slice(cursor).join(""));

  return out.join("");
}

/**
 * 只替换一处同义词得到的别名，用来补拼音召回。
 * 例：「西红柿炒鸡蛋」→「番茄炒鸡蛋」「西红柿炒蛋」。
 * 中文匹配其实已经被 canonicalize 覆盖，这里主要是让 fanqiechaojidan 这类
 * 输入也能命中。
 */
export function aliasVariants(value: string): string[] {
  const matches = findSynonymMatches(value);
  if (!matches.length) return [];

  const chars = Array.from(value);
  const variants = new Set<string>();

  for (const match of matches) {
    for (const term of SYNONYM_GROUPS[match.group]) {
      const replacement = normalizeText(term);
      if (!replacement || replacement === match.text) continue;
      const variant =
        chars.slice(0, match.index).join("") +
        replacement +
        chars.slice(match.index + match.length).join("");
      if (variant !== value) variants.add(variant);
    }
  }

  return [...variants];
}
