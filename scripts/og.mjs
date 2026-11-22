/**
 * 生成默认分享图（首页、关于页等用）：node scripts/og.mjs
 *
 * 版式对齐网站顶部的横幅：左边印章，右边中英文品牌名；
 * 下面一行「在创智，好好吃饭」作大标题，底部四个关键词。
 * 输出 public/og.jpg（1200×630，JPEG）——PNG 存照片体积会到 600KB 左右，没必要。
 */
import sharp from "sharp";
import fs from "node:fs";

// 整体尺寸比原来的 1200×630 小一圈，比例保持 1.9:1，四周留白跟着缩
const W = 1080;
const H = 540;
const S = W / 1200; // 内容按宽度等比缩
const base = process.cwd();
const OUT = `${base}/public/og.jpg`;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d0a07" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#0d0a07" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#0d0a07" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#veil)"/>
  <rect x="${48 * S}" y="${48 * S}" width="${W - 96 * S}" height="${H - 96 * S}" fill="none" stroke="#f0e7d8" stroke-opacity="0.18"/>

  <text x="${178 * S}" y="${108 * S}" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="${36 * S}" letter-spacing="4" fill="#f0e7d8">创智食单</text>
  <text x="${180 * S}" y="${136 * S}" font-family="Menlo, monospace" font-size="${13 * S}" letter-spacing="8" fill="#b2a18d">FOOD AROUND SII</text>

  <text x="${94 * S}" y="${300 * S}" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="${96 * S}" letter-spacing="2" fill="#f0e7d8">在创智，</text>
  <text x="${94 * S}" y="${395 * S}" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="${96 * S}" letter-spacing="2" fill="#d98a34">好好吃饭</text>

  <text x="${96 * S}" y="${470 * S}" font-family="Noto Sans CJK SC, PingFang SC, sans-serif" font-size="${24 * S}" letter-spacing="2" fill="#b2a18d">环境 · 菜单 · 人均 · 推荐菜</text>
</svg>`;

const bg = await sharp(`${base}/src/assets/hero.jpg`).resize(W, H, { fit: "cover" }).toBuffer();
const logo = await sharp(`${base}/public/logo-512.png`).resize(Math.round(70 * S), Math.round(70 * S)).toBuffer();

const composed = await sharp(bg)
  .composite([
    { input: Buffer.from(svg) },
    { input: logo, top: Math.round(74 * S), left: Math.round(94 * S) },
  ])
  .toBuffer();

await sharp(composed).jpeg({ quality: 84, mozjpeg: true }).toFile(OUT);
console.log("og.jpg", Math.round(fs.statSync(OUT).size / 1024), "KB");
