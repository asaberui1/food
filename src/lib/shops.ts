import type { CollectionEntry } from "astro:content";

/** 就餐方式对应的标签 */
const DINING_TAGS: Record<string, string[]> = {
  group: ["多人聚餐"],
  single: ["单人餐"],
  both: ["单人餐", "多人聚餐", "四六分餐馆"],
};

/** 卡片上显示的就餐方式 */
export const DINING_LABEL: Record<string, string> = {
  group: "多人聚餐",
  single: "单人餐",
  both: "聚餐 / 单人餐",
};

/**
 * 一家店的全部标签 = 品类 + 自定义标签 + 就餐方式标签。
 * 一家店可以有多个标签（比如既是本帮菜也是家常菜）。
 */
export function tagsOf(shop: CollectionEntry<"restaurants">): string[] {
  return [...new Set([shop.data.cuisine, ...shop.data.tags, ...(DINING_TAGS[shop.data.dining] ?? [])])];
}
