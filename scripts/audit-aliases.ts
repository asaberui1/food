import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  ALIAS_RELATIONS,
  GENERIC_TERMS,
  INGREDIENT_TERMS,
  METHOD_TERMS,
  VEGETABLE_GROUPS,
} from "../src/lib/search/dictionary";
import { normalizeText } from "../src/lib/search/normalize";
import { canonicalize } from "../src/lib/search/synonyms";

/**
 * 构建期别名数据审计（npm run audit:aliases）。
 *
 * 硬错误（exit 1）：会导致静默覆盖/永远查不到的配置。
 * 警告（exit 0）：重复、自指、未使用的词，提示维护者处理。
 */

const root = "src/content/restaurants";
const errors: string[] = [];
const warnings: string[] = [];

const menuNames = new Set<string>();
for (const dir of fs.readdirSync(root)) {
  const file = path.join(root, dir, "index.md");
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const frontmatter = raw.split("---")[1];
  if (!frontmatter) continue;
  const data = YAML.parse(frontmatter) as {
    menu?: { items?: { name?: string }[] }[];
  };
  for (const group of data.menu ?? []) {
    for (const item of group.items ?? []) {
      const norm = normalizeText(item.name ?? "");
      if (norm) menuNames.add(norm);
    }
  }
}

const menuCanon = new Set<string>();
for (const name of menuNames) {
  menuCanon.add(name);
  menuCanon.add(canonicalize(name));
}

const exactCanonicals = new Map<string, number>();
const terms = new Map<string, { canonical: string; source: "exact" | "vegetable" }[]>();

for (const relation of ALIAS_RELATIONS.exact) {
  const canonical = normalizeText(relation.canonical);
  if (!canonical) {
    errors.push("exact 分组缺少 canonical");
    continue;
  }
  exactCanonicals.set(canonical, (exactCanonicals.get(canonical) ?? 0) + 1);

  for (const value of [relation.canonical, ...relation.members]) {
    const norm = normalizeText(value);
    if (!norm) continue;
    if (value !== norm && value.toLowerCase() !== norm) {
      warnings.push(`exact 词未规范化：${value} → ${norm}`);
    }
    const list = terms.get(norm) ?? [];
    list.push({ canonical, source: "exact" });
    terms.set(norm, list);
  }
}

for (const group of VEGETABLE_GROUPS) {
  const canonical = normalizeText(group.canonical);
  if (!canonical) {
    errors.push("蔬菜分组缺少 canonical");
    continue;
  }
  for (const value of [group.canonical, ...group.aliases]) {
    const norm = normalizeText(value);
    if (!norm) continue;
    if (value !== norm && value.toLowerCase() !== norm) {
      warnings.push(`蔬菜词未规范化：${value} → ${norm}`);
    }
    const list = terms.get(norm) ?? [];
    list.push({ canonical, source: "vegetable" });
    terms.set(norm, list);
  }
}

for (const [canonical, count] of exactCanonicals) {
  if (count > 1) errors.push(`exact canonical 重复：${canonical} × ${count}`);
}

for (const [term, entries] of terms) {
  if (entries.length <= 1) continue;
  const canonicals = [...new Set(entries.map((entry) => entry.canonical))];
  if (canonicals.length > 1) {
    errors.push(`同名词映射到不同 canonical：${term} → ${canonicals.join(" / ")}`);
  } else {
    warnings.push(`重复词：${term}（${entries.map((entry) => entry.source).join(" + ")}）`);
  }
}

const nearKeys = new Set<string>();
for (const relation of ALIAS_RELATIONS.near) {
  const from = normalizeText(relation.from);
  if (!from) {
    errors.push("near 缺少 from");
    continue;
  }
  if (nearKeys.has(from)) errors.push(`near from 重复：${relation.from}`);
  nearKeys.add(from);

  if (!Number.isFinite(relation.confidence) || relation.confidence < 0 || relation.confidence > 1) {
    errors.push(`near confidence 越界：${relation.from} = ${relation.confidence}`);
  }
  if (!relation.targets.length) errors.push(`near 没有 targets：${relation.from}`);
  let hasMenuTarget = false;
  for (const target of relation.targets) {
    const norm = normalizeText(target);
    if (!norm) {
      errors.push(`near target 为空：${relation.from}`);
      continue;
    }
    if (norm === from) warnings.push(`near 自指 target：${relation.from} → ${target}`);
    if ([...menuCanon].some((name) => name.includes(norm))) hasMenuTarget = true;
  }
  if (!hasMenuTarget) warnings.push(`near 的 targets 在当前菜单都找不到：${relation.from}`);
}


const termSections = [
  { name: "做法词", values: METHOD_TERMS },
  { name: "食材词", values: INGREDIENT_TERMS },
  { name: "泛类别词", values: GENERIC_TERMS },
] as const;

for (const section of termSections) {
  const seen = new Map<string, number>();
  for (const value of section.values) {
    const norm = normalizeText(value);
    if (!norm) {
      errors.push(`${section.name}存在空词`);
      continue;
    }
    if (value !== norm) warnings.push(`${section.name}未规范化：${value} → ${norm}`);
    seen.set(norm, (seen.get(norm) ?? 0) + 1);
  }
  for (const [term, count] of seen) {
    if (count > 1) warnings.push(`${section.name}内部重复：${term} × ${count}`);
  }
}

for (let i = 0; i < termSections.length; i += 1) {
  for (let j = i + 1; j < termSections.length; j += 1) {
    const left = new Set(termSections[i].values.map(normalizeText));
    const overlap = termSections[j].values.map(normalizeText).filter((term) => left.has(term));
    const allowedCrossRole = new Set(["砂锅", "干锅"]);
    for (const term of overlap) {
      if (allowedCrossRole.has(term)) continue;
      warnings.push(`跨词表重复角色：${term}（${termSections[i].name} + ${termSections[j].name}）`);
    }
  }
}

console.log(
  `[alias] exact ${ALIAS_RELATIONS.exact.length} 组；near ${ALIAS_RELATIONS.near.length} 条；` +
    `蔬菜 ${VEGETABLE_GROUPS.length} 组；做法/食材/类别 ${
      METHOD_TERMS.length
    }/${INGREDIENT_TERMS.length}/${GENERIC_TERMS.length} 条`,
);
for (const warning of warnings) console.warn(`  ⚠ ${warning}`);
for (const error of errors) console.error(`  ✗ ${error}`);

if (errors.length) {
  console.error(`\n别名审计失败：${errors.length} 个错误，${warnings.length} 个警告`);
  process.exitCode = 1;
} else {
  console.log(`✓ 别名审计通过（${warnings.length} 个警告）`);
}
