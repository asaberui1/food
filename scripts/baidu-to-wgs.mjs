#!/usr/bin/env node
/**
 * 百度 BD09MC → 华泾本地 WGS84。
 *
 * 用法：
 *   npm run geo -- <百度 x> <百度 y>
 *
 * 百度地图 POI 的 x/y 是 BD09MC（厘米）。整数部分直接贴进来即可。
 * 系数是用华泾一带已收录门店的百度 POI 与 OSM/WGS84 坐标拟合的局部仿射，
 * 只适合学院周边 4 公里；更远的店要重新用 7 个地标拟合。
 */
const [xArg, yArg] = process.argv.slice(2);
const x = Number(xArg);
const y = Number(yArg);

if (!Number.isFinite(x) || !Number.isFinite(y)) {
  console.error("用法：npm run geo -- <百度 x> <百度 y>");
  console.error("例：npm run geo -- 1352112932 362776274");
  process.exit(1);
}

// 2026-11 用云西、胡记、牛麦香、西北红四家店拟合；四家残差均 < 1 米
const lon = 8.98344497e-8 * x + 2.17746871e-12 * y - 1.73395801e-2;
const lat = -1.09445161e-12 * x + 7.70310253e-8 * y + 3.18534801;

const CAMPUS = { lat: 31.126958, lon: 121.43693 };
const meters = Math.hypot(
  (lat - CAMPUS.lat) * 110574,
  (lon - CAMPUS.lon) * 111320 * Math.cos((lat * Math.PI) / 180),
);
const minutes = Math.round(meters / 75);

console.log(`WGS84：${lat.toFixed(6)}, ${lon.toFixed(6)}`);
console.log(`距学院：约 ${Math.round(meters)} 米，步行约 ${minutes} 分钟`);
console.log("");
console.log("贴到 scripts/map-render.py 的 SHOPS：");
console.log(`    ("<slug>", "<店名>", ${lat.toFixed(6)}, ${lon.toFixed(6)}, "<街道>", "s"),`);
