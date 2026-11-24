/**
 * 字体清单自检：node scripts/font-audit.mjs
 *
 * 构建会重新生成字体子集，但如果 collectChars 漏掉 frontmatter、或生成过程
 * 只替换了部分文件，页面就会悄悄回退到系统字体。这里不联网，只拿站内实际
 * 用到的字去核对 styles-fonts.css 的 unicode-range 和字体文件是否齐全。
 */
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectChars, CSS_FILE, FONT_DIR } from "./font-subset.mjs";

const execFileAsync = promisify(execFile);

const css = await readFile(CSS_FILE, "utf8");
const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => match[1]);

if (!faces.length) {
  console.error(`字体清单为空：${CSS_FILE} 里没有 @font-face`);
  process.exit(1);
}

const covered = new Set();
const files = new Set();

for (const face of faces) {
  const file = face.match(/url\("?\.\/assets\/fonts\/([^")]+)"?\)/)?.[1];
  if (!file) {
    console.error("字体清单异常：有 @font-face 没写字体文件");
    process.exit(1);
  }
  files.add(file);

  const range = face.match(/unicode-range\s*:\s*([^;]+);/)?.[1];
  if (!range) {
    console.error(`字体清单异常：${file} 没有 unicode-range`);
    process.exit(1);
  }

  for (const match of range.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi)) {
    const start = Number.parseInt(match[1], 16);
    const end = match[2] ? Number.parseInt(match[2], 16) : start;
    for (let code = start; code <= end; code += 1) covered.add(code);
  }
}

const fontFiles = (await readdir(FONT_DIR)).filter((name) => name.endsWith(".woff2"));
for (const file of files) {
  if (!fontFiles.includes(file)) {
    console.error(`字体清单缺少文件：${join(FONT_DIR, file)}`);
    process.exit(1);
  }
  const info = await stat(join(FONT_DIR, file));
  if (!info.size) {
    console.error(`字体文件为空：${join(FONT_DIR, file)}`);
    process.exit(1);
  }
}

for (const file of fontFiles) {
  if (!files.has(file)) console.warn(`提示：${file} 没有被 styles-fonts.css 引用`);
}

const chars = await collectChars();

const failMissing = (source, missing) => {
  console.error(`字体清单缺字 ${missing.length} 个（${source}）：${missing.join("")}`);
  console.error(
    missing
      .slice(0, 80)
      .map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase()} ${char}`)
      .join("\n"),
  );
  process.exit(1);
};

const missing = chars.filter((char) => !covered.has(char.codePointAt(0)));
if (missing.length) failMissing("unicode-range", missing);

// unicode-range 只说明 CSS 声明了这些字；再用 fontconfig 读一遍字体文件里的
// 实际 cmap，确认下载回来的 woff2 没有漏字。没有 fc-scan 时退回只查声明。
let cmapChecked = true;
const cmap = new Set();
try {
  for (const file of files) {
    const { stdout } = await execFileAsync(
      "fc-scan",
      ["--format", "%{charset}\n", join(FONT_DIR, file)],
      {
        env: { ...process.env, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || tmpdir() },
      },
    );
    for (const token of stdout.trim().split(/\s+/)) {
      if (!/^[0-9a-f]+(?:-[0-9a-f]+)?$/i.test(token)) continue;
      const [startHex, endHex] = token.split("-");
      const start = Number.parseInt(startHex, 16);
      const end = endHex ? Number.parseInt(endHex, 16) : start;
      for (let code = start; code <= end; code += 1) cmap.add(code);
    }
  }
  if (!cmap.size) throw new Error("fc-scan 没有返回字符集");
} catch (error) {
  cmapChecked = false;
  console.warn(`提示：fc-scan 不可用，跳过 cmap 复核（${String(error.message).split("\n")[0]}）`);
}

if (cmapChecked) {
  const cmapMissing = chars.filter((char) => !cmap.has(char.codePointAt(0)));
  if (cmapMissing.length) failMissing("cmap", cmapMissing);
}

console.log(
  `字体清单：${chars.length} 字，${faces.length} 个 @font-face / ${fontFiles.length} 个文件，0 缺字（${cmapChecked ? "unicode-range + cmap 均已核对" : "仅 unicode-range，未找到 fc-scan"}）`,
);
