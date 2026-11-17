import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// 站点地址：https://asaberui1.github.io/food/
// 若改仓库名，只需同步修改 base。
export default defineConfig({
  site: "https://asaberui1.github.io",
  base: "/food",
  trailingSlash: "always",
  integrations: [sitemap()],
  image: {
    service: {
      entrypoint: "astro/assets/services/sharp",
    },
  },
});
