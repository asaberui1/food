/**
 * 生成每家店的分享卡：node scripts/share-cards.mjs
 * 输出到 public/share/<slug>.jpg（1080×1350，适合微信/朋友圈）。
 * 需要本地有中文字体（macOS 自带宋体）。
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import QRCode from "qrcode";

const CONTENT = "src/content/restaurants";
const OUT = "public/share";
const SITE = "https://asaberui1.github.io/food";

const W = 1080;
const H = 1350;

function parseList(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m"));
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function parseScalar(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

async function buildCard(dir) {
  const md = await readFile(join(CONTENT, dir, "index.md"), "utf8");
  const name = parseScalar(md, "name");
  const cuisine = parseScalar(md, "cuisine");
  const cover = parseScalar(md, "cover").replace(/^\.\//, "");

  // 人均：有消费记录就按记录折算
  const bills = [...md.matchAll(/- people:\s*(\d+)[\s\S]*?total:\s*(\d+)/g)].map((m) => ({
    people: Number(m[1]),
    total: Number(m[2]),
  }));
  const avg = bills.length
    ? Math.round(bills.reduce((sum, b) => sum + b.total / b.people, 0) / bills.length)
    : null;

  // 推荐菜前三
  const dishesBlock = md.match(/^dishes:\n([\s\S]*?)^[a-z]/m);
  const dishes = dishesBlock
    ? [...dishesBlock[1].matchAll(/^\s+- name:\s*(.+)$/gm)].map((m) => m[1].trim()).slice(0, 3)
    : [];

  const url = `${SITE}/restaurants/${dir}/`;
  const qr = await QRCode.toBuffer(url, { width: 420, margin: 1, color: { dark: "#17130fff", light: "#fbf0dcff" } });

  let background = sharp({ create: { width: W, height: H, channels: 3, background: "#17130f" } });
  let hasCover = true;
  try {
    const coverBuffer = await readFile(join(CONTENT, dir, cover));
    background = sharp(coverBuffer).resize(W, H, { fit: "cover", position: "centre" });
  } catch {
    hasCover = false;
  }

  const base = await background.png().toBuffer();
  const nameY = hasCover ? 880 : 700;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#d98a34" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#17130f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d0a07" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="#0d0a07" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#0d0a07" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  ${hasCover ? "" : '<rect width="' + W + '" height="' + H + '" fill="url(#glow)"/>'}
  <rect width="${W}" height="${H}" fill="url(#veil)"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="#f0e7d8" stroke-opacity="0.18"/>

  <text x="88" y="118" font-family="Menlo, monospace" font-size="22" letter-spacing="6" fill="#b2a18d">创智食单 · 上海创智学院周边</text>

  <text x="84" y="${nameY}" font-family="Songti SC, serif" font-size="${hasCover ? 76 : 88}" fill="#f0e7d8">${escapeXml(name)}</text>
  <text x="88" y="${nameY + 56}" font-family="PingFang SC, sans-serif" font-size="30" fill="#d98a34">${escapeXml(cuisine)}${avg ? ` · 人均约 ¥${avg}` : ""}</text>
  ${dishes
    .map(
      (dish, index) =>
        `<text x="88" y="${nameY + 126 + index * 46}" font-family="Songti SC, serif" font-size="30" fill="#d9cdb8">· ${escapeXml(dish)}</text>`,
    )
    .join("")}

  <text x="88" y="1268" font-family="Menlo, monospace" font-size="20" fill="#b2a18d">asaberui1.github.io/food</text>
</svg>`;

  const overlay = Buffer.from(svg);
  const qrSize = 200;
  const qrX = W - 88 - qrSize;
  const qrY = H - 120 - qrSize;

  await sharp(base)
    .composite([
      { input: overlay },
      { input: await sharp(qr).resize(qrSize, qrSize).png().toBuffer(), left: qrX, top: qrY },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(OUT, `${dir}.jpg`));

  return `${dir}.jpg`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
}

await mkdir(OUT, { recursive: true });
const dirs = (await readdir(CONTENT, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
for (const dir of dirs) {
  const file = await buildCard(dir);
  console.log("生成", file);
}
