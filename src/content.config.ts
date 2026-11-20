import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * 每家餐馆一个目录：src/content/restaurants/<slug>/index.md
 * 照片放在同一目录下，用相对路径引用（./cover.jpg）。
 *
 * dining 区分两种记录方式：
 * - group  多人聚餐：记人均 / 实际消费
 * - single 单人餐：不记人均，只列菜单，丰俭由人
 * - both   两种吃法都有
 */
const restaurants = defineCollection({
  loader: glob({
    pattern: "**/index.md",
    base: "./src/content/restaurants",
    generateId: ({ entry }) => entry.replace(/\/index\.md$/, ""),
  }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      cuisine: z.string(),
      dining: z.enum(["group", "single", "both"]).default("group"),
      /** 从学院大门步行过去大约几分钟 */
      walkMinutes: z.number().int().positive().optional(),
      address: z.string(),
      hours: z.string().default(""),
      summary: z.string(),
      cover: image().optional(),
      gallery: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      dishes: z
        .array(
          z.object({
            name: z.string(),
            price: z.string().optional(),
            note: z.string().optional(),
            image: image().optional(),
          }),
        )
        .default([]),
      /** 菜单总说明，显示在所有分类之前 */
      menuNote: z.string().optional(),
      menu: z
        .array(
          z.object({
            title: z.string(),
            note: z.string().optional(),
            items: z.array(z.object({ name: z.string(), price: z.string(), note: z.string().optional() })),
          }),
        )
        .default([]),
      /** 多人聚餐的实际消费记录，可记多次；人均与荤素构成都由它算出来 */
      bills: z
        .array(
          z.object({
            people: z.number().int().positive(),
            dishes: z.array(z.string()).min(1),
            total: z.number().positive(),
          }),
        )
        .default([]),
      /** 店家的扫码点餐入口（微信/支付宝小程序，网页端打不开） */
      order: z
        .object({
          url: z.string().url(),
          qr: image().optional(),
          note: z.string().optional(),
          tip: z.string().optional(),
        })
        .optional(),
      /** 收录日期，用于 RSS 与排序 */
      added: z.string().optional(),
      tags: z.array(z.string()).default([]),
    }),
});

export const collections = { restaurants };
