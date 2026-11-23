/**
 * 生成思源宋体（Noto Serif SC）子集：node scripts/font-subset.mjs
 *
 * 1. 从 src/ 的内容与页面里收集实际用到的汉字与中文标点；
 * 2. 并入一份常用「吃」词汇，避免新增菜名时缺字；
 * 3. 按 140 字一批调用 Google Fonts 的 text= 子集接口，拿到只含这些字的 woff2；
 * 4. 全部成功后原子替换 src/assets/fonts，并生成 src/styles-fonts.css。
 *
 * 网络不可用时只打印警告、保留旧字体，不阻断构建。
 */
import { readFile, writeFile, readdir, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";

const SRC = "src";
const FONT_DIR = "src/assets/fonts";
const CSS_FILE = "src/styles-fonts.css";
const BATCH = 140;

// 以后多半会用到的字：菜名、做法、口味、场景
const EXTRA =
  "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞"
  + "餐馆菜饭面汤粥粉饺馄饨包馒饼串烧烤炒爆熘炸煎焖炖煮蒸涮卤酱腌拌醉糟酸甜苦辣咸鲜香麻椒盐葱姜蒜醋糖油辣椒花八角桂皮叶茴孜然咖喱芥末沙拉黄油芝士奶油蛋糕甜点饮品茶水咖啡牛奶豆浆果汁啤酒白酒黄酒米酒汽水冰镇常温销招牌特色推荐新品时令限量套单小份大加料不价外送堂食打包排队等位预约厢圆桌靠窗停车洗手间"
  + "早市午晚夜宵一人食朋友聚餐带走米饭盖浇牛蛙肥肠猪肝大排素鸡雪菜肉丝榨菜豌杂万州热干重庆小酸辣香菇筋品自制咸扣梅干菜外婆宫保丁土豆包菜番茄韭菜洋葱黄瓜木耳豆腐鱼香茄子白菜荠菜猪白饺炒生菜老干妈葱蛋豆角红肠肚牛肉鸡杂腰花泡椒双拼黑鱼片糟卤毛豆烧小公鸡茭白干回锅花菜西葫芦鸡蛋水煮肉片尖椒洋葱丝汤拌浇头加另算"
  + "·—、，。：；！？（）《》「」『』…";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 收集站点里出现的汉字与中文标点 */
async function collectChars() {
  const used = new Set([...EXTRA]);

  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "assets") continue;
        await walk(path);
      } else if (
        /\.(md|astro|ts|json)$/.test(entry.name) &&
        entry.name !== "dictionary.ts" &&
        entry.name !== "common-hanzi.ts" &&
        entry.name !== "alias-relations.json"
      ) {
        // 搜索词典 / 汉字拼音表只参与匹配、不会渲染，不把里面的生僻字塞进字体子集
        const text = (await readFile(path, "utf8")).replace(/<[^>]+>/g, " ");
        for (const char of text) {
          const code = char.codePointAt(0);
          if (
            (code >= 0x4e00 && code <= 0x9fff) ||
            (code >= 0x3000 && code <= 0x303f) ||
            (code >= 0xff00 && code <= 0xffef) ||
            "·—…".includes(char)
          ) {
            used.add(char);
          }
        }
      }
    }
  };

  await walk(SRC);
  return [...used];
}

/**
 * 按码点哈希分桶：新增一个汉字只会动到一个 woff2，
 * 其余文件的内容与哈希保持不变，浏览器缓存能一直用下去。
 */
function bucketize(chars, count) {
  const buckets = Array.from({ length: count }, () => []);
  for (const char of chars) {
    const cp = char.codePointAt(0);
    const index = (cp * 2654435761) % count;
    buckets[index].push(char);
  }
  return buckets.map((bucket) => bucket.sort((a, b) => a.codePointAt(0) - b.codePointAt(0)));
}

async function main() {
  const chars = await collectChars();
  const buckets = Math.max(1, Math.ceil(chars.length / BATCH));
  const batches = bucketize(chars, buckets);

  const tmpDir = `${FONT_DIR}-tmp`;
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  let css = "/* 由 scripts/font-subset.mjs 生成，不要手改 */\n";
  let total = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const text = batches[index].join("");
    const url = `https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500&text=${encodeURIComponent(text)}&display=swap`;
    const response = await fetch(url, { headers: { "User-Agent": UA } });
    const body = await response.text();
    const match = body.match(/src:\s*url\((https:[^)]+)\)\s*format\('woff2'\)/);
    if (!match) throw new Error(`第 ${index} 批没有拿到字体地址`);

    const buffer = Buffer.from(await (await fetch(match[1])).arrayBuffer());
    total += buffer.length;

    const file = `noto-serif-sc-${index}.woff2`;
    await writeFile(join(tmpDir, file), buffer);

    const range = batches[index].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase()}`).join(", ");
    css += `@font-face {
  font-family: "Noto Serif SC";
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("./assets/fonts/${file}") format("woff2");
  unicode-range: ${range};
}

`;
  }

  // 自检：站里用到的每个字都必须落在某个子集里，否则会悄悄回退到系统字体
  const covered = new Set(batches.flat());
  const missing = chars.filter((char) => !covered.has(char));
  if (missing.length) {
    throw new Error(`子集缺字：${missing.join("")}`);
  }

  await rm(FONT_DIR, { recursive: true, force: true });
  await rename(tmpDir, FONT_DIR);
  await writeFile(CSS_FILE, css);
  console.log(
    `字体子集：${chars.length} 字，${batches.length} 个文件，共 ${(total / 1024).toFixed(0)} KB（已校验无缺字）`,
  );
}

main().catch((error) => {
  console.warn(`[font-subset] 跳过：${error.message}（沿用已有字体）`);
  process.exit(0);
});
