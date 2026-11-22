import type { SearchEngine } from "./engine";
import { normalizeText } from "./normalize";
import type { SearchData, SearchHit, SearchOutcome } from "./types";

/**
 * 搜索对话框的交互层。
 *
 * 性能约定：
 * - 索引只在第一次点开搜索时 fetch，首屏不下载
 * - Fuse + 搜索引擎是动态 import 的独立 chunk，同样只在点开时加载
 * - 输入 150ms 防抖，单次搜索只做内存匹配
 * - 拼音在构建期就算好了，这里没有 pinyin-pro
 */

const DEBOUNCE_MS = 150;

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 400 });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

async function fetchIndex(url: string): Promise<SearchData> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`search index ${response.status}`);

  const data = (await response.json()) as SearchData;
  if (!data || data.version !== 1 || !Array.isArray(data.shops) || !Array.isArray(data.dishes)) {
    throw new Error("search index is malformed");
  }
  return data;
}

function priceNumber(price: string): number | null {
  const match = price.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function groupPriceLabel(hit: SearchHit): string {
  const prices = hit.shops
    .map((shop) => priceNumber(shop.price))
    .filter((value): value is number => value !== null);

  if (!prices.length) return "时价";

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const hasMarketPrice = prices.length < hit.shops.length;

  if (min === max) return hasMarketPrice ? `¥${min} 起` : `¥${min}`;
  return `¥${min}–${max}`;
}

function approximationBadge(): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "search-result__approx";
  badge.textContent = "近似";
  return badge;
}

function shopLink(
  base: string,
  hit: SearchHit,
  shop: SearchHit["shops"][number],
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "search-result__shop";
  link.dataset.resultLink = "1";
  link.href = `${base}restaurants/${shop.shopId}/#menu-title`;
  link.setAttribute("aria-label", `${shop.name}，${shop.shopName}，${shop.price}`);

  const name = document.createElement("span");
  name.className = "search-result__shop-name";
  name.textContent = shop.shopName;

  const price = document.createElement("span");
  price.className = "search-result__price";
  price.textContent = shop.price;

  link.append(name, price);
  return link;
}

function buildResult(hit: SearchHit, base: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "search-result";
  const approximate = hit.route === "fuzzy" || hit.route === "pinyinTypo";

  if (hit.shops.length === 1) {
    const shop = hit.shops[0];

    const link = document.createElement("a");
    link.className = "search-result__name";
    link.dataset.resultLink = "1";
    link.href = `${base}restaurants/${shop.shopId}/#menu-title`;
    link.setAttribute("aria-label", `${hit.name}，${shop.price}，${shop.shopName}`);

    const name = document.createElement("span");
    name.className = "search-result__dish";
    name.textContent = hit.name;

    const price = document.createElement("span");
    price.className = "search-result__price";
    price.textContent = shop.price;

    link.append(name, price);

    const meta = document.createElement("p");
    meta.className = "search-result__meta";
    meta.textContent = shop.group ? `${shop.shopName} · ${shop.group}` : shop.shopName;
    if (approximate) meta.append(" ", approximationBadge());

    item.append(link, meta);
    return item;
  }

  const head = document.createElement("div");
  head.className = "search-result__head";

  const title = document.createElement("span");
  title.className = "search-result__title";

  const name = document.createElement("span");
  name.className = "search-result__dish";
  name.textContent = hit.name;
  title.append(name);

  if (approximate) title.append(approximationBadge());

  const count = document.createElement("span");
  count.className = "search-result__same";
  count.textContent = `${hit.shops.length} 家`;

  const price = document.createElement("span");
  price.className = "search-result__price";
  price.textContent = groupPriceLabel(hit);
  head.append(title, count, price);

  const shops = document.createElement("ul");
  shops.className = "search-result__shops";
  shops.setAttribute("aria-label", "卖这道菜的店");
  for (const shop of hit.shops) {
    const row = document.createElement("li");
    row.append(shopLink(base, hit, shop));
    shops.append(row);
  }

  item.append(head, shops);

  if (hit.aliases.length) {
    const aliases = document.createElement("p");
    aliases.className = "search-result__alias";
    aliases.textContent = `包含${hit.aliases.join("、")}等菜品`;
    item.append(aliases);
  }

  return item;
}

export function mountSearch(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-search-dialog]");
  if (!dialog || dialog.dataset.mounted === "1") return;
  dialog.dataset.mounted = "1";

  const base = dialog.dataset.base || "/";
  const indexUrl = dialog.dataset.indexUrl || `${base}search-index.json?v=3`;

  const input = dialog.querySelector<HTMLInputElement>("[data-search]");
  const results = dialog.querySelector<HTMLUListElement>("[data-results]");
  const empty = dialog.querySelector<HTMLElement>("[data-search-empty]");
  const status = dialog.querySelector<HTMLElement>("[data-search-status]");
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-search-close]");
  const help = dialog.querySelector<HTMLDetailsElement>("details.search-help");
  const inner = dialog.querySelector<HTMLElement>(".search-dialog__inner");

  if (!input || !results || !empty || !status || !closeButton) return;

  let opener: HTMLElement | null = null;
  let enginePromise: Promise<SearchEngine> | null = null;
  let ready = false;
  let composing = false;
  let timer = 0;
  let ticket = 0;

  const resetDialogHeight = (): void => {
    if (!inner) return;
    inner.style.minHeight = "";
    inner.style.maxHeight = "";
    dialog.style.maxHeight = "";
  };

  // tooltip 比对话框高时，把对话框撑到 tooltip 底部 + 20px，并留出视口上限。
  // 收起时清掉内联高度，对话框回到原来的 82vh。
  const fitDialogToHelp = (): void => {
    if (!inner || !help) return;
    const pop = help.querySelector<HTMLElement>(".search-help__pop");
    if (!pop) return;

    window.setTimeout(() => {
      if (!help.open) return;
      const popRect = pop.getBoundingClientRect();
      const innerRect = inner.getBoundingClientRect();
      const required = Math.ceil(popRect.bottom - innerRect.top + 20);
      if (required <= innerRect.height + 1) return;

      const cap = Math.max(320, window.innerHeight - 32);
      const height = Math.min(required, cap);
      dialog.style.maxHeight = `${cap}px`;
      inner.style.maxHeight = `${cap}px`;
      inner.style.minHeight = `${height}px`;
    }, 0);
  };

  const ensureEngine = (): Promise<SearchEngine> => {
    if (!enginePromise) {
      enginePromise = (async () => {
        const data = await fetchIndex(indexUrl);
        await idle();
        const { createSearchEngine } = await import("./engine");
        const engine = createSearchEngine(data);
        ready = true;
        if (!input.value.trim()) status.textContent = "";
        return engine;
      })().catch((error: unknown) => {
        enginePromise = null;
        status.textContent = "菜单没载入成功，稍后再试。";
        throw error;
      });
    }
    return enginePromise;
  };

  const render = (outcome: SearchOutcome, raw: string): void => {
    results.replaceChildren();
    const hits = outcome.hits;

    if (!hits.length) {
      empty.hidden = false;
      empty.textContent =
        outcome.reason === "generic"
          ? `「${raw.trim()}」是个大类，范围太大。换具体菜名试试，比如「鱼香肉丝盖浇饭」。`
          : outcome.reason === "short"
            ? "没有找到。两个字有点短，补全菜名试试，比如「宫保鸡丁」。"
            : "没有找到。可以试试别名、拼音或首字母，比如「gbjd」「番茄炒蛋」。";
      status.textContent = "";
      return;
    }

    empty.hidden = true;
    status.textContent =
      outcome.total > hits.length
        ? `找到 ${outcome.total} 道菜，先看前 ${hits.length} 道。`
        : `找到 ${outcome.total} 道菜。`;

    for (const hit of hits) results.append(buildResult(hit, base));
  };

  const runSearch = async (): Promise<void> => {
    const raw = input.value;
    const query = normalizeText(raw);
    const current = ++ticket;

    if (!query) {
      results.replaceChildren();
      empty.hidden = true;
      status.textContent = "";
      results.removeAttribute("aria-busy");
      return;
    }

    results.setAttribute("aria-busy", "true");

    try {
      const engine = await ensureEngine();
      if (current !== ticket) return;
      const outcome = engine.search(raw);
      if (current !== ticket) return;
      render(outcome, raw);
    } catch {
      if (current === ticket) {
        results.replaceChildren();
        empty.hidden = true;
      }
    } finally {
      if (current === ticket) results.removeAttribute("aria-busy");
    }
  };

  const schedule = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void runSearch();
    }, DEBOUNCE_MS);
  };

  const open = (trigger?: Element | null): void => {
    opener =
      trigger instanceof HTMLElement
        ? trigger
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    document.documentElement.classList.add("search-open");

    window.clearTimeout(timer);
    ticket += 1;
    if (help) help.open = false;
    resetDialogHeight();
    input.value = "";
    results.replaceChildren();
    empty.hidden = true;
    results.removeAttribute("aria-busy");
    status.textContent = ready ? "" : "正在载入菜单…";

    window.setTimeout(() => input.focus({ preventScroll: true }), 30);
    void ensureEngine().catch(() => {});
  };

  const close = (): void => {
    window.clearTimeout(timer);
    ticket += 1;
    if (help) help.open = false;
    resetDialogHeight();
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

  document.querySelectorAll("[data-search-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      open(button);
    });
  });

  closeButton.addEventListener("click", close);

  help?.addEventListener("toggle", () => {
    if (help.open) fitDialogToHelp();
    else resetDialogHeight();
  });

  window.addEventListener("resize", () => {
    if (!help?.open) return;
    resetDialogHeight();
    fitDialogToHelp();
  });

  dialog.addEventListener("click", (event) => {
    const target = event.target;

    if (help?.open) {
      // 第一次点浮层外只收浮层；点关闭按钮除外
      if (target instanceof Node && !help.contains(target) && target !== closeButton) {
        help.open = false;
        if (target === dialog) return;
      }
    }

    if (target === dialog) close();
  });

  dialog.addEventListener("cancel", (event) => {
    if (!help?.open) return;
    event.preventDefault();
    help.open = false;
    help.querySelector<HTMLElement>("summary")?.focus();
  });

  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("search-open");
    resetDialogHeight();
    if (opener && typeof opener.focus === "function") opener.focus();
  });

  input.addEventListener("compositionstart", () => {
    composing = true;
  });

  input.addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });

  input.addEventListener("input", () => {
    if (!composing) schedule();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = results.querySelector<HTMLAnchorElement>("[data-result-link]");
      if (first) {
        event.preventDefault();
        first.click();
      }
    } else if (event.key === "ArrowDown") {
      const first = results.querySelector<HTMLAnchorElement>("[data-result-link]");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  results.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const links = [...results.querySelectorAll<HTMLAnchorElement>("[data-result-link]")];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;

    if (next >= 0 && next < links.length) {
      event.preventDefault();
      links[next].focus();
    } else if (next < 0) {
      event.preventDefault();
      input.focus();
    }
  });

  if (new URLSearchParams(window.location.search).get("search") === "1") open();
}
