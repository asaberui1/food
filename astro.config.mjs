import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 收录日期当作 sitemap 的 lastmod：每家店的页面用自己的日子，其余页面用最新那天
const contentDir = "src/content/restaurants";
const addedBySlug = new Map();
let latestAdded = "";

for (const dir of readdirSync(contentDir)) {
  const source = readFileSync(join(contentDir, dir, "index.md"), "utf8");
  const matched = source.match(/^added:\s*"([^"]+)"/m);
  if (!matched) continue;
  addedBySlug.set(dir, matched[1]);
  if (matched[1] > latestAdded) latestAdded = matched[1];
}

// 站点地址：https://asaberui1.github.io/food/
// 若改仓库名，只需同步修改 base。
export default defineConfig({
  site: "https://asaberui1.github.io",
  base: "/food",
  trailingSlash: "always",
  integrations: [
    sitemap({
      serialize(item) {
        const slug = item.url.match(/\/restaurants\/([^/]+)\/$/)?.[1];
        const date = (slug && addedBySlug.get(slug)) || latestAdded;
        return date ? { ...item, lastmod: new Date(date).toISOString() } : item;
      },
    }),
  ],
  image: {
    service: {
      entrypoint: "astro/assets/services/sharp",
    },
  },
});
