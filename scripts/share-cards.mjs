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
const QR_SIZE = 235; // 47 个模块 × 5px，二维码和中心垫片都按整模块对齐

function parseList(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m"));
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function parseScalar(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/** 菜单里的菜名 → 价格，推荐菜也复用同一份价格表 */
function parsePrices(text) {
  const prices = new Map();
  for (const m of text.matchAll(/\{\s*name:\s*([^,}]+),\s*price:\s*([^}]+)\s*\}/g)) {
    prices.set(m[1].trim(), m[2].trim());
  }
  for (const m of text.matchAll(/\n\s*- name:\s*(.+)\n\s*price:\s*(.+)/g)) {
    prices.set(m[1].trim(), m[2].trim());
  }
  return prices;
}

function dishPrice(prices, name) {
  if (prices.has(name)) return prices.get(name);
  const base = name.replace(/（.*$/, "");
  const bases = [base, base.replaceAll("鳜", "桂"), base.replaceAll("桂", "鳜")];
  for (const [key, value] of prices) {
    if (bases.some((candidate) => key.startsWith(candidate))) return value;
  }
  return "";
}

const QR_LOGO = "public/logo-192.png";
let logoBuffer;

/** 二维码中心压一个「创智食单」logo；H 级容错，垫片按二维码模块对齐，避免切出半格 */
async function qrWithSeal(url, size) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const totalModules = qr.modules.size + 2; // 左右各 1 模块 quiet zone
  // 取整模块像素，二维码宽高都落在模块边界上，垫片才不会切出半格
  const modulePx = Math.max(2, Math.round(size / totalModules));
  const qrPx = totalModules * modulePx;
  const raw = await QRCode.toBuffer(url, {
    width: qrPx,
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: "#17130fff", light: "#fbf0dcff" },
  });

  logoBuffer ??= await readFile(QR_LOGO);
  const logoModules = Math.max(3, Math.round(totalModules * 0.32));
  const borderModules = 1;
  const plateModules = logoModules + borderModules * 2;
  const startModule = Math.floor((totalModules - plateModules) / 2);
  const sealSize = logoModules * modulePx;
  const plateSize = plateModules * modulePx;
  const plateOffset = startModule * modulePx;
  const seal = await sharp(logoBuffer).resize(sealSize, sealSize, { fit: "cover" }).png().toBuffer();
  // 垫片和二维码浅色模块同色，边缘对齐整模块
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${plateSize}" height="${plateSize}"><rect width="${plateSize}" height="${plateSize}" fill="#fbf0dc"/></svg>`,
  );

  return sharp(raw)
    .composite([
      { input: plate, left: plateOffset, top: plateOffset },
      { input: seal, left: plateOffset + borderModules * modulePx, top: plateOffset + borderModules * modulePx },
    ])
    .png()
    .toBuffer();
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
  const prices = parsePrices(md);
  const qr = await qrWithSeal(url, QR_SIZE);
  await mkdir(QR_OUT, { recursive: true });
  await writeFile(join(QR_OUT, `${dir}.png`), await qrWithSeal(url, 600));

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
  const nameSize = fitFontSize(name, W - 168, 84);

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

  <text x="84" y="1046" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="${nameSize}" fill="#f9f2e6">${escapeXml(name)}</text>
  <text x="88" y="1112" font-family="Noto Sans CJK SC, PingFang SC, Noto Sans SC, sans-serif" font-size="34" fill="#f0b979">${escapeXml(cuisine)}${avg ? ` · 人均约 ¥${avg}` : ""}</text>
  <text x="88" y="1164" font-family="Noto Sans CJK SC, PingFang SC, Noto Sans SC, sans-serif" font-size="32" fill="rgba(240,231,216,0.76)">${escapeXml(address)}</text>
  ${dishes
    .map((dish, index) => {
      const price = dishPrice(prices, dish);
      const y = 1226 + index * 54;
      const units = [...dish].reduce(
        (sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.58),
        0,
      );
      const leaderStart = 88 + 44 + units * 28 + 12;
      const leaderEnd = 630;
      const dotCount = Math.max(0, Math.floor((leaderEnd - leaderStart) / 16) + 1);
      const dots = price
        ? Array.from({ length: dotCount }, (_, i) =>
            `<circle cx="${(leaderEnd - i * 16).toFixed(1)}" cy="${y - 11}" r="2.2" fill="rgba(236,226,206,0.5)"/>`,
          ).join("")
        : "";
      const priceText = price
        ? `${dots}<text x="700" y="${y}" text-anchor="end" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', sans-serif" font-size="31" fill="rgba(236,226,206,0.94)">${escapeXml(price)}</text>`
        : "";
      return `<text x="88" y="${y}" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="34" fill="rgba(236,226,206,0.94)">· ${escapeXml(dish)}</text>${priceText}`;
    })
    .join("")}

  <text x="${W - 88}" y="${1440 - 120 + 42}" text-anchor="end" font-family="Noto Serif CJK SC, Noto Serif SC, Songti SC, serif" font-size="30" font-weight="600" fill="#f9f2e6" letter-spacing="1">创智食单</text>
</svg>`;

  const overlay = Buffer.from(svg);
  const qrSize = QR_SIZE;
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

/** 中文按 1 个字宽、拉丁字母按 0.58 估，超宽就缩字号，最低 44px */
function fitFontSize(text, maxWidth, maxSize = 84) {
  const units = [...String(text)].reduce(
    (sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.58),
    0,
  );
  if (!units) return maxSize;
  return Math.max(44, Math.min(maxSize, Math.floor(maxWidth / units)));
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
