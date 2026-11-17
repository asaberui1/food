# 创智食单

上海创智学院周边的餐馆指南。一家一家吃过去，记录环境、菜单、人均和推荐菜。

- 线上地址：<https://asaberui1.github.io/food/>
- 技术栈：Astro 7 + TypeScript，零客户端框架，纯静态输出
- 设计底稿：[Ombra](https://github.com/xocothemes/ombra)（MIT，Andrei Alba），改造成多店指南结构

## 本地运行

```bash
npm install
npm run dev      # http://localhost:4321/food/
npm run build    # 输出到 dist/
npm run preview
```

> Node 需要 22.12 以上。

## 新增一家餐馆

1. 新建目录 `src/content/restaurants/<slug>/`，`slug` 用英文小写短横线（例如 `laozhang-shaokao`），它会成为详情页地址 `/restaurants/laozhang-shaokao/`。
2. 把照片放进这个目录：封面用竖图或横图都行，环境照建议 2–3 张，手机原图即可（构建时会自动压缩转 webp）。
3. 新建 `index.md`：

```md
---
name: 老张烧烤
cuisine: 烧烤
priceRange: ¥50–80
distance: 步行 12 分钟
address: 徐汇区某某路 12 号（学院南门出门右转）
hours: 17:00–次日 02:00
summary: 一句话推荐，会显示在卡片上。
cover: ./cover.jpg

gallery:
  - src: ./room.jpg
    alt: 夜晚的烧烤摊，几张折叠桌支在路边

dishes:
  - name: 羊肉串
    price: ¥5/串
    note: 肥瘦相间，一次点十串比较划算

menu:
  - title: 烤串
    items:
      - { name: 羊肉串, price: ¥5 }
      - { name: 鸡翅, price: ¥8 }

tags: [烧烤, 夜宵]
featured: true
sample: false
---

正文写备注，支持 Markdown。会显示在详情页最下面的「备注」区块。
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 店名 |
| `cuisine` | 是 | 品类，首页品类标签和列表锚点都由它生成 |
| `priceRange` | 是 | 人均，写成 `¥18–28` 这样 |
| `distance` | 是 | 步行距离，写成 `步行 6 分钟` |
| `address` | 是 | 地址 |
| `hours` | 否 | 营业时间 |
| `summary` | 是 | 一句话推荐 |
| `cover` | 是 | 封面图，相对路径 |
| `gallery` | 否 | 环境照数组，每项 `src` + `alt` |
| `dishes` | 否 | 推荐菜数组，`name` 必填，`price`、`note` 可选 |
| `menu` | 否 | 菜单分组，`title` + `items[]`（`name`、`price` 必填） |
| `tags` | 否 | 标签，显示在详情页底部 |
| `featured` | 否 | 是否进首页「最近吃过」，默认 `false` |
| `sample` | 否 | 示例条目会打上「示例」角标，正式内容请设为 `false` 或删掉 |

4. 删掉不需要的示例目录 `sample-noodle`、`sample-bbq`、`sample-cafe`。

## 改站点信息

- 站名、导航、邮箱、学校信息：`src/config/site.ts`
- 域名与子路径：`astro.config.mjs` 里的 `site` / `base`（当前部署在 `/food/`，链接前缀由 `src/lib/urls.ts` 统一处理）
- 首页文案：`src/pages/index.astro`
- 社交预览图：`npm run og` 会重新生成 `public/og.png`
- 颜色、字体、间距：`src/styles.css` 顶部的 CSS 变量

## 部署

推送到 `main` 后，GitHub Actions（`.github/workflows/deploy.yml`）会自动构建并发布到 GitHub Pages。

仓库的 Pages 设置需要选 **Source: GitHub Actions**（首次部署前在 Settings → Pages 里设置）。

## 目录结构

```
src/
├── assets/                 站点级图片（首页大图等）
├── components/             Nav / Footer / ShopCard / SeoHead
├── config/site.ts          站点配置
├── content/restaurants/    每家店一个目录
├── content.config.ts       内容集合的字段校验
├── layouts/BaseLayout.astro
├── lib/urls.ts             带 /food 前缀的链接工具
├── pages/
│   ├── index.astro         首页
│   ├── restaurants/        列表页 + [slug] 详情页
│   └── about.astro
└── styles.css
```

## 许可

MIT，见 [LICENSE](./LICENSE)。设计底稿 Ombra 版权归 Andrei Alba 所有。
