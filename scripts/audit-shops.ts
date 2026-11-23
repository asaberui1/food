import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { GENERIC_TERMS, vegetablesIn } from "../src/lib/search/dictionary";
import { createSearchEngine } from "../src/lib/search/engine";
import { codePointLength, normalizeText } from "../src/lib/search/normalize";
import type { SearchData, SearchHit } from "../src/lib/search/types";

/**
 * 新增餐馆的收尾检查，构建后运行：
 *
 *   npm run audit:shops
 *   npm run audit:shops -- laoshihui-jiujia
 *
 * 必过项：
 * 1. 每家店都在 scripts/map-render.py 里有坐标，在 pins.json 和 map SVG 里有图钉；
 * 2. 除称重价（¥xx/斤、¥xx/两 等）外，price 只能是 ¥xx、¥xx/yy、¥xx–yy 或时价，
 *    不能出现 ¥xx/只、¥xx/碗、¥xx/根 这类量词；
 * 3. 每道菜用自己的名字、全拼、首字母都能搜到自己，且不被别的菜压在后面。
 *
 * 指定 slug 时额外跑一遍“删一个字”的模糊检查，并打印每道菜的召回情况，供人工过目。
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${root}`), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as unknown;

const slugArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const deep = Boolean(slugArg);

const dataPath = "dist/search-index.json";
let data: SearchData;
try {
  data = readJson(dataPath) as SearchData;
} catch {
  console.error(`[audit] 找不到 ${dataPath}，先跑 npm run build。`);
  process.exit(1);
}

const shops = data.shops ?? [];
const dishes = data.dishes ?? [];
if (!Array.isArray(shops) || !Array.isArray(dishes) || shops.length === 0) {
  console.error("[audit] dist/search-index.json 格式不对。");
  process.exit(1);
}

const targetShop = slugArg ? shops.find((shop) => shop.id === slugArg) : undefined;
if (slugArg && !targetShop) {
  console.error(`[audit] 没有找到 slug「${slugArg}」，现有：${shops.map((s) => s.id).join("、")}`);
  process.exit(1);
}

const errors: string[] = [];
const warnings: string[] = [];
const targetDishes = slugArg
  ? dishes.filter((dish) => shops[dish.shop]?.id === slugArg)
  : dishes;

// ---- 1. 地图 ----
const pins = readJson("src/assets/map/pins.json") as string[];
const svg = read("public/map/neighbourhood.svg");
const mapSource = read("scripts/map-render.py");
const bounds = /LON0, LON1 = ([\d.]+), ([\d.]+)[\s\S]*?LAT0, LAT1 = ([\d.]+), ([\d.]+)/.exec(
  mapSource,
);
if (!bounds) errors.push("scripts/map-render.py 里读不到地图经纬度窗口");
const [, lon0, lon1, lat0, lat1] = (bounds ?? []).map(Number);

for (const shop of shops) {
  const slug = shop.id;
  const entry = new RegExp(
    `\\("${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*"[^"]+",\\s*([\\d.]+),\\s*([\\d.]+),\\s*"([^"]+)",\\s*"([sn])"\\)`,
  ).exec(mapSource);

  if (!entry) {
    errors.push(`[地图] ${slug} 没有写进 scripts/map-render.py 的 SHOPS`);
    continue;
  }
  if (!pins.includes(slug)) errors.push(`[地图] ${slug} 不在 src/assets/map/pins.json`);
  if (!svg.includes(`data-map-slug="${slug}"`)) {
    errors.push(`[地图] ${slug} 在 public/map/neighbourhood.svg 里没有图钉（重跑 map-render.py）`);
  }

  const [, latRaw, lonRaw] = entry;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    errors.push(`[地图] ${slug} 的经纬度不是数字`);
  } else if (
    Number.isFinite(lon0) &&
    (lon < lon0 || lon > lon1 || lat < lat0 || lat > lat1)
  ) {
    errors.push(`[地图] ${slug} 的坐标 ${lat}, ${lon} 跑出了地图窗口`);
  }
}

// ---- 2. 价格格式 ----
const PRICE = /^(?:时价|¥\d+(?:\.\d+)?(?:[/–-]\d+(?:\.\d+)?)*(?:\/(?:斤|两|克|kg|千克))?)$/;
const QUANTIFIER = /[/／](?:只|碗|根|个|份|条|串|杯|盒|块)/;
const seenNames = new Map<string, number>();

for (const dish of targetDishes) {
  const shop = shops[dish.shop];
  const label = `${shop?.name ?? "?"} / ${dish.name}`;
  const nameKey = `${shop?.name ?? "?"} / ${dish.name}`;
  seenNames.set(nameKey, (seenNames.get(nameKey) ?? 0) + 1);

  if (!dish.name?.trim()) errors.push(`[菜单] ${label} 菜名为空`);
  if (!dish.price?.trim()) {
    errors.push(`[价格] ${label} 没有 price`);
    continue;
  }
  if (!PRICE.test(dish.price)) {
    const hint = QUANTIFIER.test(dish.price)
      ? "不要写「/只」「/碗」「/根」这类量词，直接写 ¥xx"
      : "只允许 ¥xx、¥xx/yy、¥xx–yy、¥xx/斤（称重）或时价";
    errors.push(`[价格] ${label}：${dish.price}；${hint}`);
  }
}

for (const [key, count] of seenNames) {
  if (count > 1) warnings.push(`[菜单] ${key} 同名菜出现 ${count} 次，确认是不是重复录入`);
}

// 推荐菜的 price 不在搜索索引里，单独从 frontmatter 查一遍
let recommendationPrices = 0;
for (const shop of slugArg ? [targetShop!] : shops) {
  const path = `src/content/restaurants/${shop.id}/index.md`;
  let frontmatter: { dishes?: { name?: string; price?: unknown }[] } = {};
  try {
    const source = read(path);
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!match) throw new Error("没有 frontmatter");
    frontmatter = (parseYaml(match[1]) ?? {}) as typeof frontmatter;
  } catch (error) {
    errors.push(`[价格] ${shop.name} 的 ${path} 读不了：${(error as Error).message}`);
    continue;
  }

  for (const dish of frontmatter.dishes ?? []) {
    if (dish.price === undefined || dish.price === null || dish.price === "") continue;
    recommendationPrices += 1;
    const price = String(dish.price);
    if (!PRICE.test(price)) {
      errors.push(`[价格] 推荐菜 ${shop.name} / ${dish.name ?? "?"}：${price}；推荐菜也只写 ¥xx`);
    }
  }
}

// ---- 3. 搜索 ----
const engine = createSearchEngine(data);
const generic = new Set(GENERIC_TERMS.map(normalizeText));
let selfChecked = 0;
let pinyinChecked = 0;
let initialsChecked = 0;
const fuzzySamples: string[] = [];

const hitHasDish = (hit: SearchHit, dish: (typeof dishes)[number], shopId: string) =>
  hit.shops.some((shop) => shop.shopId === shopId && shop.name === dish.name) ||
  hit.aliases.includes(dish.name);

for (const dish of targetDishes) {
  const shop = shops[dish.shop];
  const shopId = shop?.id ?? "";
  const label = `${shop?.name ?? "?"} / ${dish.name}`;

  if (codePointLength(dish.name) <= 2) {
    if (deep && vegetablesIn(dish.name).length === 0) {
      warnings.push(`[搜索] ${label} 是两字菜名，按现有规则不会出现在结果里`);
    }
    continue;
  }

  if (generic.has(normalizeText(dish.name))) {
    warnings.push(`[搜索] ${label} 本身是泛词，搜索会被 generic 规则挡住`);
  }

  const self = engine.search(dish.name);
  const selfHit = self.hits.find((hit) => hitHasDish(hit, dish, shopId));
  selfChecked += 1;
  if (!selfHit) {
    errors.push(`[搜索] ${label} 用自己的名字搜不到`);
    continue;
  }
  if (selfHit.score < 80) {
    errors.push(`[搜索] ${label} 自搜索只有 ${selfHit.score} 分`);
  }
  const top = self.hits[0];
  if (top && !hitHasDish(top, dish, shopId) && top.score >= selfHit.score) {
    warnings.push(
      `[搜索] ${label} 被「${top.name}」（${top.score} 分）压在后面，检查是否撞名`,
    );
  }

  if (dish.py) {
    pinyinChecked += 1;
    if (!engine.search(dish.py).hits.some((hit) => hitHasDish(hit, dish, shopId))) {
      errors.push(`[搜索] ${label} 全拼 ${dish.py} 搜不到`);
    }
  } else {
    warnings.push(`[搜索] ${label} 没有拼音，检查菜名是否含非汉字`);
  }

  if (dish.ini) {
    initialsChecked += 1;
    if (!engine.search(dish.ini).hits.some((hit) => hitHasDish(hit, dish, shopId))) {
      errors.push(`[搜索] ${label} 首字母 ${dish.ini} 搜不到`);
    }
  }

  // 新店才跑模糊抽样：替换第二个字，保持长度，看看 fuzzy 还能不能回到自己
  if (deep && codePointLength(dish.name) >= 4) {
    const chars = [...dish.name];
    chars[1] = "某";
    const typo = chars.join("");
    const found = engine.search(typo).hits;
    const matchIndex = found.findIndex((hit) => hitHasDish(hit, dish, shopId));
    if (matchIndex < 0 || matchIndex >= 3) {
      fuzzySamples.push(
        `  · 替换字「${typo}」没进前三：${found
          .slice(0, 3)
          .map((hit) => `${hit.name}(${hit.score})`)
          .join("、") || "无"}`,
      );
    }
  }
}

// ---- 输出 ----
console.log(`[地图] ${shops.length} 家店已检查`);
console.log(
  `[价格] 菜单 ${targetDishes.length} 道、推荐菜 ${recommendationPrices} 道已检查（称重价允许 ¥xx/斤、¥xx/两）`,
);
console.log(
  `[搜索] 自搜索 ${selfChecked} 道、全拼 ${pinyinChecked} 道、首字母 ${initialsChecked} 道`,
);

if (warnings.length) {
  console.log(`\n[提醒] ${warnings.length} 条（不一定错，新增店建议逐条看）`);
  for (const warning of warnings.slice(0, deep ? 50 : 12)) console.log(`  - ${warning}`);
  if (warnings.length > (deep ? 50 : 12)) console.log(`  …另有 ${warnings.length - (deep ? 50 : 12)} 条`);
}

if (deep && fuzzySamples.length) {
  console.log(`\n[模糊抽样] 删掉第二个字后没回到自己：${fuzzySamples.length} 条`);
  for (const line of fuzzySamples.slice(0, 40)) console.log(line);
}

if (errors.length) {
  console.error(`\n[失败] ${errors.length} 项：`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log("\n✓ 地图、价格格式、搜索自检全部通过");
