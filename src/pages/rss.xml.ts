import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "../config/site";

export async function GET(context: { site: URL }) {
  const shops = (await getCollection("restaurants")).sort((a, b) => {
    const left = a.data.added ?? "";
    const right = b.data.added ?? "";
    return right.localeCompare(left) || a.data.name.localeCompare(b.data.name, "zh");
  });

  return rss({
    title: siteConfig.name,
    description: siteConfig.description,
    site: new URL(import.meta.env.BASE_URL, context.site),
    items: shops.map((shop) => ({
      title: shop.data.name,
      description: `${shop.data.summary} 地址：${shop.data.address}`,
      link: `${import.meta.env.BASE_URL}restaurants/${shop.id}/`,
      pubDate: shop.data.added ? new Date(shop.data.added) : new Date(),
    })),
    customData: `<language>zh-cn</language>`,
  });
}
