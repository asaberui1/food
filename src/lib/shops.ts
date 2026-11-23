import type { CollectionEntry } from "astro:content";

/** 就餐方式对应的标签 */
const DINING_TAGS: Record<string, string[]> = {
  group: ["多人聚餐"],
  single: ["单人餐"],
  both: ["单人餐", "四六分餐馆"],
};

/** 卡片上显示的就餐方式 */
export const DINING_LABEL: Record<string, string> = {
  group: "多人聚餐",
  single: "单人餐",
  both: "聚餐 / 单人餐",
};

/**
 * 一家店的全部标签 = 品类 + 自定义标签 + 就餐方式标签。
 * 品类可以用「、」「·」「/」分隔多个，例如「湘菜、徽菜、本帮菜」。
 */
export function cuisinesOf(shop: CollectionEntry<"restaurants">): string[] {
  return shop.data.cuisine
    .split(/[、,，/·]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function tagsOf(shop: CollectionEntry<"restaurants">): string[] {
  return [...new Set([...cuisinesOf(shop), ...shop.data.tags, ...(DINING_TAGS[shop.data.dining] ?? [])])];
}

/** 全站标签：品类在前，其次自定义标签，最后就餐方式 */
export function allTagsOf(shops: CollectionEntry<"restaurants">[]): string[] {
  const cuisines = [...new Set(shops.flatMap((shop) => cuisinesOf(shop)))];
  const extra = [...new Set(shops.flatMap((shop) => shop.data.tags))].filter((tag) => !cuisines.includes(tag));
  const dining = ["单人餐", "多人聚餐", "四六分餐馆"].filter((tag) =>
    shops.some((shop) => tagsOf(shop).includes(tag)),
  );
  return [...cuisines, ...extra, ...dining];
}
