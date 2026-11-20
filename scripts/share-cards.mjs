/**
 * 生成每家店的分享卡：node scripts/share-cards.mjs
 * 输出到 public/share/<slug>.jpg（1080×1350，适合微信/朋友圈）。
 * 需要本地有中文字体（macOS 自带宋体）。
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import sharp from "sharp";
import QRCode from "qrcode";

const CONTENT = "src/content/restaurants";
const OUT = "public/share";
const QR_OUT = "public/qr";
const SITE = "https://asaberui1.github.io/food";

const W = 1080;
const H = 1440;

function parseList(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m"));
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function parseScalar(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/** 没有中文字体时，librsvg 会用 last-resort 字体把汉字画成「53 4E」这种码位方块 */
function hasCjkFont() {
  try {
    const out = execSync("fc-list :lang=zh", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().length > 0;
  } catch {
    return true; // macOS 一般没有 fc-list，系统自带宋体/苹方
  }
}

async function buildCard(dir) {
  const md = await readFile(join(CONTENT, dir, "index.md"), "utf8");
  const name = parseScalar(md, "name");
  const cuisine = parseScalar(md, "cuisine");
  const cover = parseScalar(md, "cover").replace(/^\.\//, "");
  const address = parseScalar(md, "address");

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
  await mkdir(QR_OUT, { recursive: true });
  await writeFile(join(QR_OUT, `${dir}.png`), await QRCode.toBuffer(url, { width: 600, margin: 1, color: { dark: "#17130fff", light: "#fbf0dcff" } }));

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
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d0a07" stop-opacity="0"/>
      <stop offset="38%" stop-color="#0d0a07" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#0b0806" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  <rect y="700" width="${W}" height="${H - 700}" fill="url(#veil)"/>

  <text x="84" y="1046" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="84" fill="#f9f2e6">${escapeXml(name)}</text>
  <text x="88" y="1112" font-family="Noto Sans CJK SC, PingFang SC, Noto Sans SC, sans-serif" font-size="34" fill="#f0b979">${escapeXml(cuisine)}${avg ? ` · 人均约 ¥${avg}` : ""}</text>
  <text x="88" y="1164" font-family="Noto Sans CJK SC, PingFang SC, Noto Sans SC, sans-serif" font-size="32" fill="rgba(240,231,216,0.76)">${escapeXml(address)}</text>
  ${dishes
    .map(
      (dish, index) =>
        `<text x="88" y="${1226 + index * 54}" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="34" fill="rgba(236,226,206,0.94)">· ${escapeXml(dish)}</text>`,
    )
    .join("")}

  <text x="${W - 88}" y="${1440 - 120 + 42}" text-anchor="end" font-family="Noto Sans CJK SC, PingFang SC, Noto Sans SC, sans-serif" font-size="22" fill="rgba(240,231,216,0.6)">创智食单</text>
</svg>`;

  const overlay = Buffer.from(svg);
  const qrSize = 168;
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

if (!hasCjkFont()) {
  throw new Error("没找到中文字体，分享卡会变成码位方块：先装 fonts-noto-cjk 再生成");
}

await mkdir(OUT, { recursive: true });
const dirs = (await readdir(CONTENT, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
for (const dir of dirs) {
  const file = await buildCard(dir);
  console.log("生成", file);
}
