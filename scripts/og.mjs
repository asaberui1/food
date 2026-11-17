import sharp from "sharp";
import fs from "node:fs";

const W = 1200, H = 630;
const base = process.cwd();

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d0a07" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#0d0a07" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#0d0a07" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#veil)"/>
  <rect x="48" y="48" width="${W-96}" height="${H-96}" fill="none" stroke="#f0e7d8" stroke-opacity="0.18"/>
  <text x="96" y="150" font-family="Menlo, monospace" font-size="20" letter-spacing="6" fill="#b2a18d">上海创智学院 · 周边</text>
  <text x="92" y="330" font-family="Songti SC, STSong, serif" font-size="132" fill="#f0e7d8">创智食单</text>
  <line x1="96" y1="372" x2="300" y2="372" stroke="#d98a34" stroke-width="3"/>
  <text x="96" y="440" font-family="Songti SC, STSong, serif" font-size="44" fill="#d98a34">在创智，好好吃饭</text>
  <text x="96" y="520" font-family="PingFang SC, sans-serif" font-size="24" fill="#b2a18d">环境 · 菜单 · 人均 · 推荐菜</text>
</svg>`;

const bg = await sharp(`${base}/src/assets/hero.webp`).resize(W, H, { fit: "cover" }).toBuffer();
await sharp(bg).composite([{ input: Buffer.from(svg) }]).png().toFile(`${base}/public/og.png`);
console.log("ok", fs.statSync(`${base}/public/og.png`).size);
