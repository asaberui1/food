import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildSearchIndex } from "../lib/search-index";

/** 搜索索引单独出成 JSON，首页和列表页按需 fetch，不再内联进 HTML */
export const GET: APIRoute = async () => {
  const shops = await getCollection("restaurants");
  return new Response(JSON.stringify(buildSearchIndex(shops)), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
