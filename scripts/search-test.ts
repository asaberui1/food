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
            { name: "椒盐蹄膀", price: "¥58" },
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
            { name: "牙鲆鱼", price: "¥88" },
            { name: "黄颡鱼", price: "¥68" },
            { name: "龙头鱼", price: "¥48" },
            { name: "红烧鳊鱼", price: "¥38" },
            { name: "清蒸鲳鱼", price: "¥58" },
            { name: "小炒肉", price: "¥26" },
            { name: "白切草鸡", price: "¥52" },
            { name: "土豆", price: "¥8" },
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
            { name: "饸饹面", price: "¥15" },
          ],
        },
      ],
    },
  },
  {
    id: "shishu",
    data: {
      name: "时蔬测试",
      menu: [
        {
          title: "田园时蔬",
          items: [
            { name: "清炒时蔬", price: "¥18" },
            { name: "蒜泥空心菜", price: "¥18" },
            { name: "蚝油生菜", price: "¥18" },
            { name: "蒜泥米苋", price: "¥20" },
            { name: "酒香草头", price: "¥25" },
            { name: "酒香豆苗", price: "¥22" },
            { name: "马兰头香干", price: "¥16" },
            { name: "香菇青菜", price: "¥20" },
            { name: "清炒鸡毛菜", price: "¥18" },
            { name: "生菜", price: "¥9" },
            { name: "荠菜肉大馄饨", price: "¥15" },
            { name: "生菜牛肉炒饭", price: "¥16" },
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
const foundFragment = (query: string, fragment: string, source = engine) =>
  source
    .search(query)
    .hits.some(
      (item) =>
        item.name.includes(fragment) ||
        item.aliases.some((alias) => alias.includes(fragment)) ||
        item.shops.some((shop) => shop.name.includes(fragment)),
    );

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

check("肉沫粉条 / 肉末粉条 命中肉末粉丝和蚂蚁上树", () => {
  for (const query of ["肉沫粉条", "肉末粉条"]) {
    assert.equal(hit(query, "肉末粉丝")?.score, 100, query);
    assert.equal(hit(query, "蚂蚁上树")?.score, 100, query);
  }
});

check("辣椒炒肉命中小炒肉", () => {
  assert.equal(hit("辣椒炒肉", "小炒肉")?.score, 100);
});

check("鱼类各地叫法互搜", () => {
  assert.equal(hit("鸦片鱼", "牙鲆鱼")?.score, 100);
  assert.equal(hit("黄辣丁", "黄颡鱼")?.score, 100);
  assert.equal(hit("昂刺鱼", "黄颡鱼")?.score, 100);
  assert.equal(hit("九肚鱼", "龙头鱼")?.score, 100);
  assert.equal(hit("豆腐鱼", "龙头鱼")?.score, 100);
  assert.equal(hit("扁鱼", "红烧鳊鱼")?.score, 80);
  assert.equal(hit("昌鱼", "清蒸鲳鱼")?.score, 80);
});

check("输入「盖浇饭」不返回一堆 xxx 盖浇饭", () => {
  const outcome = search("盖浇饭");
  assert.equal(outcome.hits.length, 0);
  assert.equal(outcome.reason, "generic");
});

check("具体到「回锅肉盖浇饭」仍然能精确命中", () => {
  assert.equal(hit("回锅肉盖浇饭", "回锅肉盖浇饭")?.score, 100);
});

check("输入蹄膀的近义词/错别字命中「椒盐蹄膀」", () => {
  for (const query of ["蹄髈", "蹄膀", "蹄胖", "蹄旁", "蹄榜", "肘子", "猪肘", "猪肘子"]) {
    assert.equal(hit(query, "椒盐蹄膀")?.score, 80, query);
  }
});

check("输入「白斩鸡」「白切鸡」都命中「白切草鸡」", () => {
  assert.equal(hit("白斩鸡", "白切草鸡")?.score, 100);
  assert.equal(hit("白切鸡", "白切草鸡")?.score, 100);
});

check("做法的两个字也能搜：清蒸", () => {
  assert.equal(hit("清蒸", "鳜鱼（清蒸）")?.score, 80);
});

check("做法 + 鱼顺序不同也能搜：清蒸鳜鱼", () => {
  assert.equal(hit("清蒸鳜鱼", "鳜鱼（清蒸）")?.score, 66);
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

check("中文同音字「觉鱼」「绝鱼」「厥鱼」都能命中「鳜鱼」", () => {
  for (const query of ["觉鱼", "绝鱼", "厥鱼"]) {
    assert.ok(hasDish(query, "鳜鱼（清蒸）"), query);
  }
});

check("中文同音字「鱼香肉私」按拼音命中「鱼香肉丝」", () => {
  assert.equal(hit("鱼香肉私", "鱼香肉丝")?.score, 62);
});

check("汉字查询表包含多音字", () => {
  assert.ok(data.pinyinTable["觉"]?.includes("jue"));
  assert.ok(data.pinyinTable["鳜"]?.includes("gui"));
});

check("拼音表覆盖菜单里出现的所有汉字", () => {
  for (const dish of data.dishes) {
    for (const char of dish.norm) {
      if (/\p{Script=Han}/u.test(char)) {
        assert.ok(data.pinyinTable[char], `${dish.name} 缺 ${char}`);
      }
    }
  }
});

check("pinyin-pro 读错的「饸饹」按 he-le 纠正，he-ge 算近似", () => {
  assert.equal(hit("helemian", "饸饹面")?.score, 70);
  assert.equal(hit("hele", "饸饹面")?.score, 68);
  const typo = hit("hege", "饸饹面");
  assert.ok(typo);
  assert.ok(typo.score < 68);
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

check("两个字以内的菜名不出现在结果里", () => {
  for (const query of ["土豆", "鸡丁"]) {
    const outcome = search(query);
    assert.ok(
      outcome.hits.every((item) => [...item.name].length > 2),
      query,
    );
  }
});

check("泛词「饭」「面」「汤」不返回菜单", () => {
  for (const query of ["饭", "面", "汤"]) {
    assert.equal(search(query).hits.length, 0, query);
  }
});

check("引擎返回全部结果，total 与 hits 一致", () => {
  const outcome = search("鸡");
  assert.equal(outcome.hits.length, outcome.total);
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
    if ([...dish.name].length <= 2) continue;
    const found = groupFor(dish.name, dish.name);
    assert.ok(found, dish.name);
    assert.equal(found.score, 100, dish.name);
  }
});

check("每条菜用自己的全拼和首字母都能搜到自己", () => {
  for (const dish of data.dishes) {
    if ([...dish.name].length <= 2) continue;
    assert.ok(hasDish(dish.py, dish.name), `${dish.name} / ${dish.py}`);
    assert.ok(hasDish(dish.ini, dish.name), `${dish.name} / ${dish.ini}`);
  }
});

console.log("时蔬类目");
check("「时蔬」命中所有叶菜，不把荠菜馄饨、生菜炒饭算进来", () => {
  for (const query of ["时蔬", "蔬菜"]) {
    for (const name of ["清炒时蔬", "蒜泥空心菜", "蚝油生菜", "蒜泥米苋", "酒香草头", "马兰头香干", "香菇青菜", "清炒鸡毛菜", "生菜"]) {
      assert.ok(hasDish(query, name), `${query} / ${name}`);
    }
    assert.ok(!hasDish(query, "荠菜肉大馄饨"), query);
    assert.ok(!hasDish(query, "生菜牛肉炒饭"), query);
  }
  assert.equal(hit("时蔬", "蒜泥空心菜")?.route, "vegetable");
  assert.equal(hit("时蔬", "蒜泥空心菜")?.score, 72);
});

check("各地叫法都能搜到对应的上海叶菜", () => {
  const pairs: [string, string][] = [
    ["蕹菜", "蒜泥空心菜"],
    ["通菜", "蒜泥空心菜"],
    ["藤藤菜", "蒜泥空心菜"],
    ["苋菜", "蒜泥米苋"],
    ["瓢儿白", "香菇青菜"],
    ["青菜", "香菇青菜"],
    ["苜蓿", "酒香草头"],
    ["金花菜", "酒香草头"],
    ["马兰", "马兰头香干"],
    ["小青菜", "清炒鸡毛菜"],
    ["豌豆苗", "酒香豆苗"],
  ];
  for (const [query, name] of pairs) {
    assert.ok(hasDish(query, name), `${query} / ${name}`);
  }
});

check("搜某一种叶菜，其他时蔬是低置信度近似", () => {
  const near = hit("空心菜", "蒜泥米苋");
  assert.ok(near);
  assert.equal(near.route, "nearAlias");
  assert.equal(near.score, 52);
  const generic = hit("空心菜", "清炒时蔬");
  assert.ok(generic);
  assert.equal(generic.score, 52);
});

check("两字叶菜在时蔬查询里保留", () => {
  assert.ok(hasDish("生菜", "生菜"));
  assert.ok(hasDish("时蔬", "生菜"));
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
    const pinyinTable = built.pinyinTable ?? {};

    const realChecks: [string, string][] = [
      ["宫爆鸡丁", "宫保鸡丁盖浇饭"],
      ["番茄炒蛋", "西红柿炒鸡蛋"],
      ["桂鱼", "鳜鱼（茄汁、红烧、干烧）"],
      ["螺丝粉", "螺蛳粉"],
      ["云吞", "鲜肉大馄饨（10只）"],
      ["shalvniupai", "沙律牛排"],
      ["shaluniupai", "沙律牛排"],
      ["觉鱼", "鳜鱼（茄汁、红烧、干烧）"],
      ["绝鱼", "鳜鱼（茄汁、红烧、干烧）"],
      ["鱼香肉私", "鱼香肉丝"],
      ["黄颡鱼", "昂刺鱼（红烧、雪菜烧、烧汤）"],
      ["鳊鱼", "红烧扁鱼"],
      ["辣椒炒肉", "农家小炒肉"],
      ["肉沫粉条", "肉沫粉丝煲"],
      ["锅仔", "农家咸鸭锅仔"],
      ["鲜肉包", "鲜肉小笼包"],
      ["肉包", "鲜肉小笼包"],
      ["清蒸", "桂鱼（清蒸、红烧，松子、茄汁加 8 元）"],
      ["松子", "桂鱼（清蒸、红烧，松子、茄汁加 8 元）"],
      ["清蒸鳜鱼", "桂鱼（清蒸、红烧，松子、茄汁加 8 元）"],
      ["白斩鸡", "白切草鸡"],
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

    const realAliasChecks: [string, string][] = [
      ["西葫芦炒蛋", "西葫芦炒鸡蛋"],
      ["洋葱炒鸡蛋", "洋葱炒蛋"],
      ["小葱炒鸡蛋", "小葱跑蛋"],
      ["蛤蜊蒸水蛋", "蛤蜊炖蛋"],
      ["肉末蒸蛋", "肉糜炖蛋"],
      ["海带骨头汤", "海带排骨汤"],
      ["羊杂碎汤", "羊杂汤"],
      ["牛肉火锅", "牛肉锅"],
      ["牛杂火锅", "牛杂锅"],
      ["清远鸡煲", "清远鸡锅"],
      ["老鹅煲", "老鹅锅"],
      ["皮蛋瘦肉粥", "皮蛋肉丝粥"],
      ["大米粥", "白米粥"],
      ["小米稀饭", "小米粥"],
      ["红烧狮子头", "狮子头"],
      ["四喜丸子", "狮子头"],
      ["尖椒肉丝", "青椒肉丝"],
      ["雪里蕻", "雪菜"],
      ["雪里红", "雪菜"],
      ["柿子椒", "青椒"],
      ["包心菜", "包菜"],
      ["豌豆苗", "豆苗"],
      ["拍黄瓜", "凉拌黄瓜"],
      ["豆腐干", "香干炒肉"],
      ["香干", "香干炒肉"],
      ["豆干", "香干炒肉"],
      ["素鸡", "香菜拌素鸡"],
      ["豆腐皮", "豆腐皮"],
      ["豆腐丝", "豆腐皮"],
      ["煎鸡蛋", "荷包蛋"],
      ["酒酿圆子", "酒酿小圆子"],
      ["猪排面", "大排面"],
      ["清远鸡锅仔", "清远鸡锅"],
      ["生菜蚝油", "蚝油生菜"],
      ["玉米松仁", "松仁玉米"],
      ["武昌鱼", "红烧扁鱼"],
      ["团头鲂", "红烧扁鱼"],
      ["汤包", "鲜肉汤包"],
      ["灌汤包", "鲜肉汤包"],
      ["花菇", "香菇"],
      ["蚬子", "花蛤"],
      ["粿条", "河粉"],
      ["骨头汤", "海带排骨汤"],
      ["鱼泡", "干锅鱼籽鱼鳔"],
    ];

    for (const [query, fragment] of realAliasChecks) {
      assert.ok(foundFragment(query, fragment, real), `「${query}」没有命中「${fragment}」`);
      passed += 1;
    }
    console.log(`  ✓ 同菜异名/近义修订：${realAliasChecks.length} 组`);

    const shishu = real.search("时蔬");
    for (const name of ["清炒时蔬", "蒜泥空心菜", "蚝油生菜", "蒜泥米苋", "酒香草头", "马兰头香干", "香菇青菜", "生菜"]) {
      assert.ok(shishu.hits.some((item) => item.name === name), `时蔬 / ${name}`);
    }
    assert.ok(!shishu.hits.some((item) => item.name.includes("馄饨")), "时蔬不应收入荠菜馄饨");
    assert.equal(real.search("空心菜").hits.find((item) => item.name === "蒜泥米苋")?.route, "nearAlias");
    console.log(`  ✓ 「时蔬」命中 ${shishu.total} 道叶菜，其他叶菜按低置信度近似`);

    assert.equal(real.search("煎鸡蛋").hits[0]?.route, "nearAlias");
    assert.equal(real.search("生菜蚝油").hits[0]?.route, "anagram");
    const tofuFuzzy = real.search("冰川瘸子").hits[0];
    assert.equal(tofuFuzzy?.name, "冰川茄子");
    assert.equal(tofuFuzzy?.route, "fuzzy");

    assert.equal(real.search("鲜肉包").hits[0]?.name, "鲜肉小笼包");
    const suggest = real.search("酸菜鱼面").suggestions ?? [];
    assert.ok(suggest.includes("酸菜鱼"), "零结果建议应包含酸菜鱼");
    assert.ok(suggest.length <= 3, "零结果建议最多 3 个");
    assert.equal(real.search("骨头汤").hits[0]?.route, "nearAlias");

    for (const query of ["土豆", "白菜", "鸡蛋"]) {
      assert.ok(
        real.search(query).hits.every((item) => [...item.name].length > 2),
        `${query} 返回了两字以内的菜`,
      );
    }
    console.log("  ✓ 真实索引：两字以内的菜名不返回");

    const many = real.search("土豆");
    assert.ok(many.total > 10, "真实索引「土豆」应超过 10 道");
    assert.equal(many.hits.length, many.total);
    console.log(`  ✓ 「土豆」返回 ${many.total} 道，引擎未截断`);

    // 菜单更新后的自检：每条菜名、拼音、首字母都应能搜到自己
    const genericNames = new Set(GENERIC_TERMS);
    const exactMisses: string[] = [];
    const pinyinMisses: string[] = [];
    const initialsMisses: string[] = [];
    for (const dish of built.dishes) {
      if ([...dish.name].length <= 2) continue;
      if (!genericNames.has(dish.norm) && !hasDish(dish.name, dish.name, real)) {
        exactMisses.push(dish.name);
      }
      if (dish.py && !hasDish(dish.py, dish.name, real)) pinyinMisses.push(dish.name);
      if (dish.ini && !hasDish(dish.ini, dish.name, real)) initialsMisses.push(dish.name);
    }
    assert.equal(exactMisses.length, 0, `菜名自检失败：${exactMisses.slice(0, 5).join("、")}`);
    assert.equal(pinyinMisses.length, 0, `拼音自检失败：${pinyinMisses.slice(0, 5).join("、")}`);
    assert.equal(
      initialsMisses.length,
      0,
      `首字母自检失败：${initialsMisses.slice(0, 5).join("、")}`,
    );

    for (const dish of built.dishes) {
      for (const char of dish.norm) {
        if (/\p{Script=Han}/u.test(char)) {
          assert.ok(pinyinTable[char], `${dish.name} 的「${char}」不在拼音表`);
        }
      }
    }
    console.log(`  ✓ 真实索引自检：${built.dishes.length} 条菜名 / 拼音 / 首字母 / 拼音表覆盖`);
    passed += 1;

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
