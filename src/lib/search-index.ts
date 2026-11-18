import type { CollectionEntry } from "astro:content";

/** 搜索索引里的一条菜：店名 + 菜名 + 价格 + 所属分类 */
export type SearchMenuItem = { name: string; price: string; group: string };

export type SearchIndexEntry = {
  id: string;
  name: string;
  menu: SearchMenuItem[];
};

/**
 * 首页和列表页共用同一套索引结构，改字段只需要改这里。
 */
export function buildSearchIndex(shops: CollectionEntry<"restaurants">[]): SearchIndexEntry[] {
  return shops.map((shop) => ({
    id: shop.id,
    name: shop.data.name,
    menu: shop.data.menu.flatMap((group) =>
      group.items.map((item) => ({ name: item.name, price: item.price, group: group.title })),
    ),
  }));
}
