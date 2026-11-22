import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GENERIC_TERMS } from "../src/lib/search/dictionary";
import { createSearchEngine } from "../src/lib/search/engine";
import { prepareSearchData, type ShopLike } from "../src/lib/search/prepare";
import type { SearchData } from "../src/lib/search/types";

/**
 * 搜索验收用例。跑：npm run test:search
 *
 * 前半段用固定小菜单验证正确性，后半段如果存在 dist/search-index.json，
 * 就在真实菜单上再跑一遍并测耗时。
 */

const shops: ShopLike[] = [
  {
    id: "yunxi",
    data: {
      name: "云西酒家",
      menu: [
        {
          title: "热菜",
          items: [
            { name: "宫保鸡丁", price: "¥28" },
            { name: "蹄髈", price: "¥58" },
            { name: "鳜鱼（清蒸）", price: "¥88" },
            { name: "肉末茄子", price: "¥26" },
            { name: "肉末粉丝", price: "¥30" },
            { name: "蚂蚁上树", price: "¥32" },
            { name: "葱姜花蛤", price: "¥38" },
            { name: "白切鸡", price: "¥48" },
            { name: "鱼香肉丝", price: "¥24" },
            { name: "蛋饺", price: "¥15" },
            { name: "蛋炒饭", price: "¥13" },
            { name: "沙律牛排", price: "¥68" },
          ],
        },
        {
          title: "主食",
          items: [
            { name: "鱼香肉丝盖浇饭", price: "¥22" },
            { name: "宫保鸡丁盖浇饭", price: "¥24" },
            { name: "西红柿炒鸡蛋", price: "¥18" },
            { name: "番茄炒蛋", price: "¥18" },
            { name: "螺蛳粉", price: "¥20" },
            { name: "鲜肉小馄饨", price: "¥15" },
            { name: "香菇 / 糯米烧卖", price: "¥10" },
            { name: "土豆丝", price: "¥12" },
            { name: "米饭", price: "¥2" },
            { name: "面条（生）", price: "¥8" },
            { name: "鸡蛋炒面", price: "¥12" },
            { name: "鲜肉水饺", price: "¥15" },
          ],
        },
      ],
    },
  },
  {
    id: "longmianwang",
    data: {
      name: "笼面王",
      menu: [
        {
          title: "主食",
          items: [
            { name: "宫爆鸡丁", price: "¥26" },
            { name: "螺丝粉", price: "¥18" },
            { name: "回锅肉盖浇饭", price: "¥23" },
            { name: "番茄蛋汤", price: "¥12" },
            { name: "番茄炒蛋", price: "¥17" },
          ],
        },
      ],
    },
  },
];

const data = prepareSearchData(shops);
const engine = createSearchEngine(data);

const search = (query: string) => engine.search(query);
const groupFor = (query: string, name: string, source = engine) =>
  source
    .search(query)
    .hits.find(
      (item) =>
        item.name === name ||
        item.aliases.includes(name) ||
        item.shops.some((shop) => shop.name === name),
    );
const hasDish = (query: string, name: string, source = engine) =>
  source
    .search(query)
    .hits.some(
      (item) =>
        item.name === name ||
        item.aliases.includes(name) ||
        item.shops.some((shop) => shop.name === name),
    );
const hit = (query: string, name: string) => groupFor(query, name);

let passed = 0;
function check(label: string, callback: () => void): void {
  callback();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log("预处理");
check("每条菜都有 id / norm / canon / 拼音", () => {
  for (const dish of data.dishes) {
    assert.ok(dish.id);
    assert.ok(dish.norm);
    assert.ok(dish.canon);
    assert.ok(dish.py);
    assert.ok(dish.ini);
    assert.equal(dish.aliases.length, dish.aliasCanon.length);
    assert.equal(dish.aliases.length, dish.aliasPy.length);
    assert.equal(dish.aliases.length, dish.aliasIni.length);
    assert.deepEqual(dish.ingredients, []);
    assert.equal(dish.popularity, 0);
  }
});

check("拼音全拼与首字母正确", () => {
  const gongbao = data.dishes.find((dish) => dish.name === "宫保鸡丁");
  assert.ok(gongbao);
  assert.equal(gongbao.py, "gongbaojiding");
  assert.equal(gongbao.ini, "gbjd");
});

console.log("多路召回与排序");
check("输入「宫爆鸡丁」命中「宫保鸡丁」", () => {
  assert.equal(hit("宫爆鸡丁", "宫保鸡丁")?.score, 100);
  assert.equal(hit("宫爆鸡丁", "宫爆鸡丁")?.score, 100);
});

check("输入「宫保鸡丁」命中「宫爆鸡丁」", () => {
  assert.equal(hit("宫保鸡丁", "宫爆鸡丁")?.score, 100);
});

check("输入「gongbaojiding」命中两道宫保鸡丁", () => {
  assert.ok(hasDish("gongbaojiding", "宫保鸡丁"));
  assert.ok(hasDish("gongbaojiding", "宫爆鸡丁"));
  assert.equal(hit("gongbaojiding", "宫保鸡丁")?.score, 70);
});

check("输入「gbjd」命中两道宫保鸡丁", () => {
  assert.ok(hasDish("gbjd", "宫保鸡丁"));
  assert.ok(hasDish("gbjd", "宫爆鸡丁"));
  assert.equal(hit("gbjd", "宫保鸡丁")?.score, 60);
});

check("输入「番茄炒蛋」命中「西红柿炒鸡蛋」", () => {
  assert.equal(hit("番茄炒蛋", "西红柿炒鸡蛋")?.score, 100);
  assert.equal(hit("西红柿炒鸡蛋", "番茄炒蛋")?.score, 100);
});

check("输入「盖浇饭」不返回一堆 xxx 盖浇饭", () => {
  const outcome = search("盖浇饭");
  assert.equal(outcome.hits.length, 0);
  assert.equal(outcome.reason, "generic");
});

check("具体到「回锅肉盖浇饭」仍然能精确命中", () => {
  assert.equal(hit("回锅肉盖浇饭", "回锅肉盖浇饭")?.score, 100);
});

check("输入「蹄膀」命中「蹄髈」", () => {
  assert.equal(hit("蹄膀", "蹄髈")?.score, 100);
});

check("输入「桂鱼」命中「鳜鱼（清蒸）」", () => {
  const found = hit("桂鱼", "鳜鱼（清蒸）");
  assert.ok(found);
  assert.ok(found.score >= 90);
});

check("输入「肉沫茄子」命中「肉末茄子」", () => {
  assert.equal(hit("肉沫茄子", "肉末茄子")?.score, 100);
});

check("输入「蚂蚁上树」也命中「肉末粉丝」", () => {
  assert.equal(hit("蚂蚁上树", "肉末粉丝")?.score, 100);
});

check("输入「白斩鸡」命中「白切鸡」", () => {
  assert.equal(hit("白斩鸡", "白切鸡")?.score, 100);
});

check("输入「fanqiechaodan」命中「西红柿炒鸡蛋」", () => {
  assert.equal(hit("fanqiechaodan", "西红柿炒鸡蛋")?.score, 70);
});

check("输入「螺丝粉」命中「螺蛳粉」", () => {
  assert.equal(hit("螺丝粉", "螺蛳粉")?.score, 100);
});

check("输入「云吞」命中「鲜肉小馄饨」", () => {
  assert.ok(hit("云吞", "鲜肉小馄饨"));
});

check("输入「馄饨」本身也命中「鲜肉小馄饨」", () => {
  assert.ok(hit("馄饨", "鲜肉小馄饨"));
});

check("输入「烧卖」命中「香菇 / 糯米烧卖」", () => {
  assert.ok(hit("烧卖", "香菇 / 糯米烧卖"));
});

check("输入「花甲」命中「葱姜花蛤」", () => {
  assert.ok(hit("花甲", "葱姜花蛤"));
});

check("输入「稍麦」命中「香菇 / 糯米烧卖」", () => {
  assert.ok(hit("稍麦", "香菇 / 糯米烧卖"));
});

check("输入「洋芋」命中「土豆丝」", () => {
  assert.ok(hit("洋芋", "土豆丝"));
});

check("输入「番茄」命中「西红柿炒鸡蛋」", () => {
  assert.ok(hit("番茄", "西红柿炒鸡蛋"));
});

check("输入「gongbaojidin」（少个 g）仍然命中", () => {
  assert.ok(hit("gongbaojidin", "宫保鸡丁"));
});

check("ü 的拼音 u/v 两种写法都命中「沙律牛排」", () => {
  for (const query of ["shalvniupai", "shaluniupai", "shalüniupai"]) {
    assert.equal(hit(query, "沙律牛排")?.score, 70, query);
  }
});

check("pinyin-pro 读错的「鳜鱼」按近似计分，低于正确拼音", () => {
  const correct = hit("guiyu", "鳜鱼（清蒸）");
  const misread = hit("jueyu", "鳜鱼（清蒸）");
  const misreadFull = hit("jueyuqingzheng", "鳜鱼（清蒸）");
  assert.ok(correct);
  assert.ok(misread);
  assert.ok(misreadFull);
  assert.ok(correct.score >= 68);
  assert.ok(misread.score < correct.score);
  assert.ok(misreadFull.score < correct.score);
  assert.ok(misreadFull.score >= 40);
});

check("输入「鸡蛋」时鸡蛋菜排在蛋饺、蛋炒饭前面", () => {
  const outcome = search("鸡蛋");
  const top = outcome.hits.filter((item) => item.score === 90);
  assert.ok(top.length > 0);
  assert.ok(top.every((item) => item.name.startsWith("鸡蛋")));
  assert.equal(hit("鸡蛋", "西红柿炒鸡蛋")?.score, 80);
  assert.equal(hit("鸡蛋", "蛋饺"), undefined);
  assert.equal(hit("鸡蛋", "蛋炒饭"), undefined);
});

check("泛类别「米饭」「面条」即使真有同名菜也返回空", () => {
  for (const query of ["米饭", "面条", "饺子", "包子", "馒头"]) {
    const outcome = search(query);
    assert.equal(outcome.hits.length, 0, query);
    assert.equal(outcome.reason, "generic", query);
  }
});

check("「水饺」是具体菜，不是泛类别", () => {
  assert.ok(hit("水饺", "鲜肉水饺"));
});

check("同名菜聚合成一张卡，按价格从低到高，并列出别名", () => {
  const group = groupFor("番茄炒蛋", "番茄炒蛋");
  assert.ok(group);
  assert.deepEqual(
    group.shops.map((shop) => shop.price),
    ["¥17", "¥18"],
  );
  assert.equal(group.shops.length, 2);
  assert.deepEqual(group.aliases, ["西红柿炒鸡蛋"]);
});

check("输入两个字的具体食材「鸡丁」能命中「宫保鸡丁」", () => {
  assert.equal(hit("鸡丁", "宫保鸡丁")?.score, 80);
});

check("泛词「饭」「面」「汤」不返回菜单", () => {
  for (const query of ["饭", "面", "汤"]) {
    assert.equal(search(query).hits.length, 0, query);
  }
});

check("结果最多 10 条", () => {
  const outcome = search("鸡");
  assert.ok(outcome.hits.length <= 10);
});

check("空查询不返回结果", () => {
  assert.equal(search("   ").hits.length, 0);
});

check("泛词表里的每一个词都返回空", () => {
  for (const term of GENERIC_TERMS) {
    const outcome = search(term);
    assert.equal(outcome.hits.length, 0, term);
    assert.equal(outcome.reason, "generic", term);
  }
});

check("每条菜用自己的名字都能精确搜到自己", () => {
  const generic = new Set(GENERIC_TERMS);
  for (const dish of data.dishes) {
    if (generic.has(dish.norm)) continue;
    const found = groupFor(dish.name, dish.name);
    assert.ok(found, dish.name);
    assert.equal(found.score, 100, dish.name);
  }
});

check("每条菜用自己的全拼和首字母都能搜到自己", () => {
  for (const dish of data.dishes) {
    assert.ok(hasDish(dish.py, dish.name), `${dish.name} / ${dish.py}`);
    assert.ok(hasDish(dish.ini, dish.name), `${dish.name} / ${dish.ini}`);
  }
});

console.log("性能");
check("搜索缓存生效", () => {
  const first = search("宫保鸡丁");
  const second = search("宫保鸡丁");
  assert.equal(first, second);
});

const benchQueries = [
  "宫保鸡丁",
  "gbjd",
  "gongbaojiding",
  "番茄炒蛋",
  "土豆",
  "云吞",
  "红烧肉",
  "鱼香肉丝",
  "盖浇饭",
  "面",
  "蹄膀",
  "桂鱼",
];

const started = performance.now();
for (const query of benchQueries) search(query);
const average = (performance.now() - started) / benchQueries.length;
console.log(`  · 小菜单 ${engine.size} 条，平均 ${average.toFixed(3)}ms`);
assert.ok(average < 30, `单次搜索 ${average.toFixed(2)}ms，超过 30ms`);

// 真实索引存在时再跑一遍（构建后运行才有意义）
const builtPath = fileURLToPath(new URL("../dist/search-index.json", import.meta.url));
if (existsSync(builtPath)) {
  const built = JSON.parse(readFileSync(builtPath, "utf8")) as Partial<SearchData>;
  if (!Array.isArray(built.shops) || !Array.isArray(built.dishes)) {
    console.log("  · dist/search-index.json 还是旧格式，先跑 npm run build");
  } else {
    const real = createSearchEngine(built as SearchData);

    const realChecks: [string, string][] = [
      ["宫爆鸡丁", "宫保鸡丁盖浇饭"],
      ["番茄炒蛋", "西红柿炒鸡蛋"],
      ["桂鱼", "鳜鱼（茄汁、红烧、干烧）"],
      ["螺丝粉", "螺蛳粉"],
      ["云吞", "鲜肉大馄饨"],
      ["shalvniupai", "沙律牛排"],
      ["shaluniupai", "沙律牛排"],
      ["盖浇饭", "回锅肉盖浇饭"],
    ];

    console.log("真实索引");
    for (const [query, expected] of realChecks) {
      if (query === "盖浇饭") {
        const outcome = real.search(query);
        const genericDishes = outcome.hits.filter((item) => item.name.includes("盖浇饭"));
        assert.equal(genericDishes.length, 0, "泛词不应该返回 xxx 盖浇饭");
        console.log(`  ✓ 泛词「${query}」返回 ${outcome.hits.length} 条，没有整排盖浇饭`);
        continue;
      }

      const found = groupFor(query, expected, real);
      assert.ok(found, `「${query}」没有命中「${expected}」`);
      console.log(`  ✓ ${query} → ${expected}（${found.score} 分）`);
      passed += 1;
    }

    const bench = [
      "宫保鸡丁",
      "gbjd",
      "gongbaojiding",
      "番茄炒蛋",
      "土豆",
      "云吞",
      "红烧肉",
      "鱼香肉丝",
      "盖浇饭",
      "面",
      "蹄膀",
      "桂鱼",
      "酸辣土豆丝",
      "鲜肉小馄饨",
      "葱姜花蛤",
      "麻辣豆腐",
    ];
    const realStarted = performance.now();
    for (const query of bench) real.search(query);
    const realAverage = (performance.now() - realStarted) / bench.length;
    console.log(`  · 真实菜单 ${real.size} 条，平均 ${realAverage.toFixed(3)}ms`);
    assert.ok(realAverage < 30, `真实菜单单次搜索 ${realAverage.toFixed(2)}ms，超过 30ms`);
    passed += 1;
  }
}

console.log(`\n${passed} 项通过`);
