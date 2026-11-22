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

function buildResult(hit: SearchHit, base: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "search-result";

  const link = document.createElement("a");
  link.className = "search-result__name";
  link.href = `${base}restaurants/${hit.shopId}/#menu-title`;
  link.setAttribute("aria-label", `${hit.name}，${hit.price}，${hit.shopName}`);

  const name = document.createElement("span");
  name.className = "search-result__dish";
  name.textContent = hit.name;

  const price = document.createElement("span");
  price.className = "search-result__price";
  price.textContent = hit.price;

  link.append(name, price);

  const meta = document.createElement("p");
  meta.className = "search-result__meta";
  meta.textContent = hit.group ? `${hit.shopName} · ${hit.group}` : hit.shopName;

  if (hit.route === "fuzzy") {
    const approximate = document.createElement("span");
    approximate.className = "search-result__approx";
    approximate.textContent = "近似";
    meta.append(" ", approximate);
  }

  item.append(link, meta);
  return item;
}

export function mountSearch(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-search-dialog]");
  if (!dialog || dialog.dataset.mounted === "1") return;
  dialog.dataset.mounted = "1";

  const base = dialog.dataset.base || "/";
  const indexUrl = dialog.dataset.indexUrl || `${base}search-index.json?v=1`;

  const input = dialog.querySelector<HTMLInputElement>("[data-search]");
  const results = dialog.querySelector<HTMLUListElement>("[data-results]");
  const empty = dialog.querySelector<HTMLElement>("[data-search-empty]");
  const status = dialog.querySelector<HTMLElement>("[data-search-status]");
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-search-close]");

  if (!input || !results || !empty || !status || !closeButton) return;

  let opener: HTMLElement | null = null;
  let enginePromise: Promise<SearchEngine> | null = null;
  let ready = false;
  let composing = false;
  let timer = 0;
  let ticket = 0;

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
        ? `找到 ${outcome.total} 道，先看前 ${hits.length} 道。`
        : `找到 ${outcome.total} 道。`;

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

    window.clearTimeout(timer);
    ticket += 1;
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

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener("close", () => {
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
      const first = results.querySelector<HTMLAnchorElement>(".search-result__name");
      if (first) {
        event.preventDefault();
        first.click();
      }
    } else if (event.key === "ArrowDown") {
      const first = results.querySelector<HTMLAnchorElement>(".search-result__name");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  results.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const links = [...results.querySelectorAll<HTMLAnchorElement>(".search-result__name")];
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
