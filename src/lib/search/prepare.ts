import { pinyin } from "pinyin-pro";
import { DISH_ALIASES } from "./dictionary";
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

function pinyinOf(value: string): { full: string; initials: string } {
  const han = value.match(HAN)?.join("") ?? "";
  if (!han) return { full: "", initials: "" };

  const full = pinyin(han, { toneType: "none", type: "array" }).join("");
  const initials = pinyin(han, {
    pattern: "first",
    toneType: "none",
    type: "array",
  }).join("");

  return { full, initials };
}

function aliasesFor(norm: string): string[] {
  const found = new Set<string>();
  for (const variant of aliasVariants(norm)) found.add(variant);
  for (const alias of DISH_ALIASES[norm] ?? []) {
    const clean = normalizeText(alias);
    if (clean) found.add(clean);
  }
  found.delete(norm);
  return [...found].slice(0, MAX_ALIASES);
}

export function prepareSearchData(shops: ShopLike[]): SearchData {
  const dishes: PreparedDish[] = [];
  let counter = 0;

  shops.forEach((shop, shopIndex) => {
    for (const group of shop.data.menu) {
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

        for (const alias of aliases) {
          aliasCanon.push(canonicalize(alias));
          const aliasPinyin = pinyinOf(alias);
          aliasPy.push(aliasPinyin.full);
          aliasIni.push(aliasPinyin.initials);
        }

        dishes.push({
          id: `${shop.id}:${counter}`,
          shop: shopIndex,
          name: item.name,
          price: item.price,
          group: group.title,
          norm,
          canon,
          py: namePinyin.full,
          ini: namePinyin.initials,
          ...(canonPinyin ? { cpy: canonPinyin.full, cini: canonPinyin.initials } : {}),
          aliases,
          aliasCanon,
          aliasPy,
          aliasIni,
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
  };
}
