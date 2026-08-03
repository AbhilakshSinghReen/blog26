import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Posts live in data/posts/. The glob loader derives each entry's `id` from the
// filename, so the filename *is* the slug from docs/design.md.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './data/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      // image() validates the file exists and hands the build an optimizable
      // asset with known dimensions (no layout shift on the homepage grid).
      thumbnail: image(),
      thumbnailAlt: z.string(),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      author: reference('authors'),
      draft: z.boolean().default(false),
      tags: z.array(z.string()).default([]),
    }),
});

// Matches the shape of data/authors/*.json as it already exists in the repo:
// flat, named, optional link fields.
const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './data/authors' }),
  schema: z.object({
    name: z.string(),
    image: z.string(),
    twitter: z.string().url().optional(),
    github: z.string().url().optional(),
    linkedin: z.string().url().optional(),
    portfolio: z.string().url().optional(),
  }),
});

export const collections = { posts, authors };
