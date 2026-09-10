import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({
    base: './_posts',
    pattern: '**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    layout: z.string().optional(),
    title: z.string(),
    date: z.coerce.date(),
    categories: z.union([z.string(), z.array(z.string())]).optional().default([]),
    tags: z.union([z.string(), z.array(z.string())]).optional().default([]),
    description: z.string().optional(),
    last_modified_at: z.coerce.date().optional(),
    image: z.any().optional(),
    toc: z.boolean().optional(),
    comments: z.boolean().optional(),
    published: z.boolean().optional().default(true),
    pin: z.boolean().optional(),
  }),
});

export const collections = { posts };
