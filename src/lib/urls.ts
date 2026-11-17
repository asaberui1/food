/**
 * GitHub Pages 项目站点部署在 /food/ 下，站内绝对链接必须带上前缀。
 * BASE_URL 由 astro.config.mjs 的 `base` 注入，本地开发时为 "/"。
 */
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

/** 拼接站内路径：withBase("/restaurants/") -> "/food/restaurants/" */
export function withBase(path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 站内链接是否处于当前页面（用于导航高亮） */
export function isActive(current: string, href: string): boolean {
  if (href === "/") {
    return current === "/" || current === withBase("/");
  }
  const target = withBase(href);
  return current === target || current.startsWith(target);
}
