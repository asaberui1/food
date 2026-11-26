import type { CollectionEntry } from "astro:content";

export type Bill = CollectionEntry<"restaurants">["data"]["bills"][number];

const POT = /(锅仔|锅底|锅（)/;
const SOUP = /(汤|羹)/;
const MEAT = /(肉|鸡|鸭|鹅|牛|羊|猪|鱼|虾|蟹|肚|肠|排|丸|蛙|螺|肝|腰|肫|鳝|蹄|骨|筋|舌|血|翅|脑|吊龙)/;
const VEG = /(菜|豆腐|山药|木耳|茄|土豆|黄瓜|韭|葱|萝卜|藕|笋|菌|菇|玉米|花菜|白菜|菠菜|豆芽|干丝|面筋|皮蛋|花生)/;

// 个别菜名按关键字判断会出错，单独指定
const OVERRIDES: Record<string, "pot" | "soup" | "meat" | "veg"> = {
  辣酱三丁: "meat",
  农家一碗香: "meat",
  八宝辣酱: "meat", // 八样料里有鸡丁、鸭胗丁、虾仁丁
  香菜拌素鸡: "veg", // 名字带「鸡」，其实是素鸡
  糟香门腔: "meat", // 门腔是猪舌
  草头圈子: "meat", // 圈子是猪大肠
  小炒马桥干: "veg", // 马桥干是豆腐干
};

const NUMERALS = [
  "零",
  "一",
  "两",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
];

function numeral(count: number): string {
  return NUMERALS[count] ?? String(count);
}

function kindOf(dish: string): "pot" | "soup" | "meat" | "veg" {
  if (OVERRIDES[dish]) return OVERRIDES[dish];
  if (POT.test(dish)) return "pot";
  if (SOUP.test(dish)) return "soup";
  if (MEAT.test(dish)) return "meat";
  if (VEG.test(dish)) return "veg";
  return "veg";
}

/** 把一次消费的菜名归成「几锅几荤几素几汤」 */
export function billComposition(bill: Bill): string {
  const counts = { pot: 0, meat: 0, veg: 0, soup: 0 };
  for (const dish of bill.dishes) counts[kindOf(dish)] += 1;

  const parts: string[] = [];
  if (counts.pot) parts.push(`${numeral(counts.pot)}锅`);
  if (counts.meat) parts.push(`${numeral(counts.meat)}荤`);
  if (counts.veg) parts.push(`${numeral(counts.veg)}素`);
  if (counts.soup) parts.push(`${numeral(counts.soup)}汤`);
  return parts.join("") || "—";
}

export function billPerPerson(bill: Bill): number {
  return Math.round(bill.total / bill.people);
}

/** 人均按所有消费记录动态折算 */
export function averagePerPerson(bills: Bill[]): number | null {
  if (!bills.length) return null;
  const sum = bills.reduce((total, bill) => total + bill.total / bill.people, 0);
  return Math.round(sum / bills.length);
}

/** 卡片和详情页上的「人均」文案 */
export function priceLabel(shop: CollectionEntry<"restaurants">): string {
  const average = averagePerPerson(shop.data.bills);
  if (average) return `人均约 ¥${average}`;
  return shop.data.dining === "single" ? "丰俭由人" : "待补充";
}
