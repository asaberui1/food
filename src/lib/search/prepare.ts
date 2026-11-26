import { pinyin } from "pinyin-pro";
import { COMMON_HANZI, RARE_HANZI } from "./common-hanzi";
import { PINYIN_OVERRIDES, SYNONYM_GROUPS } from "./dictionary";
import { normalizeText } from "./normalize";
import { aliasVariants, canonicalize } from "./synonyms";
import type { PreparedDish, SearchData } from "./types";

/**
 * 构建期预处理（只跑一次，产物是 search-index.json）。
 *
 * pinyin-pro 在这里生成拼音并写进索引，浏览器端不加载拼音库：
 * 首屏零成本，点开搜索也不需要为 1000 多条菜现算拼音。
 */

export type ShopLike = {
  id: string;
  data: {
    name: string;
    menu: {
      title: string;
      items: { name: string; price: string }[];
    }[];
  };
};

const HAN = /\p{Script=Han}+/gu;
const MAX_ALIASES = 12;

/** 拼音里的 ü 统一写成 v：用户键盘上只有 v，没有 ü */
function asciiPinyin(value: string): string {
  return value
    .replace(/ü/g, "v")
    .replace(/Ü/g, "v")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

type PinyinResult = {
  full: string;
  initials: string;
  /** pinyin-pro 读错、但确实有人这么读的拼音，按“近似”计分 */
  typoFull: string[];
  typoInitials: string[];
};

function pinyinOf(value: string): PinyinResult {
  const norm = normalizeText(value);
  const han = norm.match(HAN)?.join("") ?? "";
  if (!han) return { full: "", initials: "", typoFull: [], typoInitials: [] };

  let full = asciiPinyin(pinyin(han, { toneType: "none", type: "array" }).join(""));
  let initials = asciiPinyin(
    pinyin(han, {
      pattern: "first",
      toneType: "none",
      type: "array",
    }).join(""),
  );

  const typoFull = new Set<string>();
  const typoInitials = new Set<string>();

  for (const override of PINYIN_OVERRIDES) {
    const term = normalizeText(override.term);
    if (!term || !norm.includes(term)) continue;

    const normalFull = asciiPinyin(pinyin(term, { toneType: "none", type: "array" }).join(""));
    const normalInitials = asciiPinyin(
      pinyin(term, { pattern: "first", toneType: "none", type: "array" }).join(""),
    );
    if (!normalFull || !full.includes(normalFull)) continue;

    full = full.replaceAll(normalFull, override.correct);
    if (normalInitials) initials = initials.replaceAll(normalInitials, override.correctInitials);

    override.misread.forEach((misread, index) => {
      typoFull.add(full.replaceAll(override.correct, misread));
      const misreadInitials = override.misreadInitials[index];
      if (misreadInitials) {
        typoInitials.add(initials.replaceAll(override.correctInitials, misreadInitials));
      }
    });
  }

  return {
    full,
    initials,
    typoFull: [...typoFull].filter((item) => item && item !== full),
    typoInitials: [...typoInitials].filter((item) => item && item !== initials),
  };
}

function aliasesFor(norm: string): string[] {
  const found = new Set<string>();
  for (const variant of aliasVariants(norm)) found.add(variant);
  found.delete(norm);
  return [...found].slice(0, MAX_ALIASES);
}

const HAN_CHAR = /\p{Script=Han}/u;

function buildPinyinTable(dishes: PreparedDish[]): Record<string, string[]> {
  const chars = new Set<string>([...COMMON_HANZI, ...RARE_HANZI]);

  for (const dish of dishes) {
    for (const value of [dish.norm, dish.canon, ...dish.aliases]) {
      for (const char of value) if (HAN_CHAR.test(char)) chars.add(char);
    }
  }
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      for (const char of normalizeText(term)) if (HAN_CHAR.test(char)) chars.add(char);
    }
  }

  const table: Record<string, string[]> = {};
  for (const char of chars) {
    const readings = pinyin(char, { multiple: true, toneType: "none", type: "array" })
      .map((reading) => asciiPinyin(reading))
      .filter((reading) => /^[a-z]+$/.test(reading));
    const unique = [...new Set(readings)].slice(0, 4);
    if (unique.length) table[char] = unique;
  }
  return table;
}

export function prepareSearchData(shops: ShopLike[]): SearchData {
  const dishes: PreparedDish[] = [];
  let counter = 0;

  shops.forEach((shop, shopIndex) => {
    for (const [groupIndex, group] of shop.data.menu.entries()) {
      for (const item of group.items) {
        const norm = normalizeText(item.name);
        if (!norm) continue;

        const canon = canonicalize(norm);
        const namePinyin = pinyinOf(item.name);
        const canonPinyin = canon === norm ? null : pinyinOf(canon);
        const aliases = aliasesFor(norm);

        const aliasCanon: string[] = [];
        const aliasPy: string[] = [];
        const aliasIni: string[] = [];
        const aliasPyTypo: string[] = [];
        const aliasIniTypo: string[] = [];

        for (const alias of aliases) {
          aliasCanon.push(canonicalize(alias));
          const aliasPinyin = pinyinOf(alias);
          aliasPy.push(aliasPinyin.full);
          aliasIni.push(aliasPinyin.initials);
          aliasPyTypo.push(...aliasPinyin.typoFull);
          aliasIniTypo.push(...aliasPinyin.typoInitials);
        }

        dishes.push({
          id: `${shop.id}:${counter}`,
          shop: shopIndex,
          name: item.name,
          price: item.price,
          group: group.title,
          groupIndex,
          norm,
          canon,
          py: namePinyin.full,
          ini: namePinyin.initials,
          ...(namePinyin.typoFull.length ? { pyTypo: namePinyin.typoFull } : {}),
          ...(namePinyin.typoInitials.length ? { iniTypo: namePinyin.typoInitials } : {}),
          ...(canonPinyin
            ? {
                cpy: canonPinyin.full,
                cini: canonPinyin.initials,
                ...(canonPinyin.typoFull.length ? { cpyTypo: canonPinyin.typoFull } : {}),
                ...(canonPinyin.typoInitials.length ? { ciniTypo: canonPinyin.typoInitials } : {}),
              }
            : {}),
          aliases,
          aliasCanon,
          aliasPy,
          aliasIni,
          ...(aliasPyTypo.length ? { aliasPyTypo } : {}),
          ...(aliasIniTypo.length ? { aliasIniTypo } : {}),
          ingredients: [],
          popularity: 0,
        });

        counter += 1;
      }
    }
  });

  return {
    version: 1,
    shops: shops.map((shop) => ({ id: shop.id, name: shop.data.name })),
    dishes,
    pinyinTable: buildPinyinTable(dishes),
  };
}
