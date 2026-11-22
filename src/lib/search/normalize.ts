/**
 * 查询和菜名的统一标准化：全半角统一、转小写、去掉空格和标点。
 *
 * 只保留字母、数字和汉字，所以「宫保鸡丁（微辣）」和「宫保鸡丁 微辣」都会变成
 * 「宫保鸡丁微辣」，输入法带来的全角空格、顿号、括号也不会影响命中。
 */
export function normalizeText(value: string): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** 纯字母查询才走拼音召回，避免把「gbjd2」这类输入当成拼音 */
export function isPinyinQuery(value: string): boolean {
  return /^[a-z]+$/.test(value);
}
