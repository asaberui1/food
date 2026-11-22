import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { prepareSearchData } from "../lib/search/prepare";

/**
 * 搜索索引单独出成 JSON：首页和列表页都只在点开搜索时才 fetch。
 *
 * 预处理（标准化、同义词规范化、拼音、别名）全部在这里完成，产物是
 * 浏览器可以直接建索引的扁平数组；客户端不再加载 pinyin-pro。
 */
export const GET: APIRoute = async () => {
  const shops = await getCollection("restaurants");
  return new Response(JSON.stringify(prepareSearchData(shops)), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
