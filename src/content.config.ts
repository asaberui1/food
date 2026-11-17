import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

/**
 * 每家餐馆一个目录：src/content/restaurants/<slug>/index.md
 * 照片放在同一目录下，用相对路径引用（./cover.jpg）。
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
      priceRange: z.string(),
      distance: z.string(),
      address: z.string(),
      hours: z.string().default(""),
      summary: z.string(),
      cover: image(),
      gallery: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      dishes: z
        .array(z.object({ name: z.string(), price: z.string().optional(), note: z.string().optional() }))
        .default([]),
      menu: z
        .array(
          z.object({
            title: z.string(),
            items: z.array(z.object({ name: z.string(), price: z.string(), note: z.string().optional() })),
          }),
        )
        .default([]),
      tags: z.array(z.string()).default([]),
      featured: z.boolean().default(false),
      sample: z.boolean().default(false),
    }),
});

export const collections = { restaurants };
