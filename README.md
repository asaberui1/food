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

## 两种记录方式

| `dining` | 适用 | 页面表现 |
| --- | --- | --- |
| `group`（多人聚餐） | 圆台面、点菜、能算人均的店 | 标注人均与「消费记录」 |
| `single`（单人餐） | 面馆、馄饨、快餐一类 | 不写人均，写「丰俭由人」，只列菜单 |

## 新增一家餐馆

1. 新建目录 `src/content/restaurants/<slug>/`，`slug` 用英文小写短横线（例如 `yunxi-jiujia`），它会成为详情页地址 `/restaurants/yunxi-jiujia/`。
2. 把照片放进这个目录：封面竖图横图都行，环境照 1–3 张，手机原图即可（构建时自动压缩转 webp）。
3. 新建 `index.md`：

```md
---
name: 云西酒家
cuisine: 本帮菜
dining: group
priceRange: 人均约 ¥47
distance: 步行 10 分钟
address: 建华路 38 号，菜市场后面的弄堂里
hours: 11:00–14:00，17:00–21:00
summary: 一句话推荐，会显示在卡片上。
cover: ./room-wide.webp

gallery:
  - src: ./room-door.webp
    alt: 包厢门口，浅蓝墙面配深色木门

dishes:
  - name: 椒盐排条
    note: 现炸的排条裹一层薄糊，和洋葱丝、芹菜段一起上桌。
    image: ./paigu.webp

bills:
  - people: 2
    dishes: [椒盐排条, 白斩草鸡, 酒香草头]
    total: 93

tags: [多人聚餐, 本帮菜]
featured: true
---

正文写备注，支持 Markdown，会显示在详情页的「备注」区块。
```

单人餐 + 扫码点餐的写法：

```md
---
name: 一碗勾馄面
cuisine: 面食
dining: single
address: 华发路 31 号，明丰新纪苑底商
summary: 馄饨和面一碗一碗下，一个人吃刚好，丰俭由人。
order:
  url: https://zzgfs.leshuazf.com/zzg-mini-order/code-restaurant.html?qrCodeNo=xxxx
  qr: ./order-qr.png
  note: 店内扫码点餐，菜单和价格以扫码页面为准。
---
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 店名 |
| `cuisine` | 是 | 品类，首页品类标签和列表锚点都由它生成 |
| `dining` | 否 | `group`（默认）/ `single` / `both`，决定是否显示人均 |
| `priceRange` | 否 | 人均，如 `人均约 ¥47`；单人餐不填 |
| `distance` | 否 | 步行距离，如 `步行 10 分钟`；不填显示「待补充」 |
| `address` | 是 | 地址 |
| `hours` | 否 | 营业时间 |
| `summary` | 是 | 一句话推荐 |
| `cover` | 否 | 封面图；不填则用店名占位块 |
| `gallery` | 否 | 环境照数组，每项 `src` + `alt` |
| `dishes` | 否 | 推荐菜数组，`name` 必填，`price`、`note`、`image` 可选 |
| `menu` | 否 | 菜单分组，`title` + `items[]`（`name`、`price` 必填） |
| `bills` | 否 | 消费记录，可多条：`people`（人数）、`dishes`（菜名）、`total`（总价）；人均由它动态算出 |
| `order` | 否 | 扫码点餐：`url`、`qr`（二维码图片）、`note`、`tip`（小提示） |
| `tags` | 否 | 自定义标签；筛选用的标签 = 品类 + 自定义标签 + 就餐方式 |
| `featured` | 否 | 是否进首页「最近吃过」（需要至少两家才会出现该区块） |
| `sample` | 否 | 示例条目会打上「示例」角标 |

4. 删掉不需要的示例目录。

### 把点餐链接做成二维码

```bash
node scripts/qr-code.mjs "<点餐页 URL>" src/content/restaurants/<slug>/order-qr.png
```

## 改站点信息

- 站名、导航、邮箱、学校信息：`src/config/site.ts`
- 域名与子路径：`astro.config.mjs` 里的 `site` / `base`（当前部署在 `/food/`，链接前缀由 `src/lib/urls.ts` 统一处理）
- 首页文案：`src/pages/index.astro`
- 字体：中文用思源宋体（Noto Serif SC），只打包站里用到的字。`npm run build` 会自动先跑 `scripts/font-subset.mjs` 重新生成子集（需要联网，失败则沿用旧字体）
- 分享卡：`npm run share` 会为每家店生成 `public/share/<slug>.jpg`（1080×1350，带二维码）。新增餐馆后跑一次
- 统计：`src/config/site.ts` 里填 `analytics.goatcounter`（GoatCounter 的站点代码）即可启用，留空不加载
- 颜色、字体、间距：`src/styles.css` 顶部的 CSS 变量

## 部署

推送到 `main` 后，GitHub Actions（`.github/workflows/deploy.yml`）自动构建并发布到 GitHub Pages。

仓库的 Pages 设置需为 **Source: GitHub Actions**。

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
│   ├── about.astro
│   └── 404.astro
└── styles.css
```

## 许可

MIT，见 [LICENSE](./LICENSE)。设计底稿 Ombra 版权归 Andrei Alba 所有。
