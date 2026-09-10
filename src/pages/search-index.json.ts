import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { asList, excerpt, formatDate, postUrl, readingMinutes, sortPosts, taxonomySlug } from '../lib/posts';

export const GET: APIRoute = async () => {
  const posts = sortPosts(await getCollection('posts'));
  const items = posts.map((post) => ({
    title: post.data.title,
    url: postUrl(post),
    date: formatDate(post.data.date),
    minutes: readingMinutes(post),
    categories: asList(post.data.categories).map((name) => ({ name, url: `/categories/${taxonomySlug(name)}/` })),
    tags: asList(post.data.tags),
    excerpt: excerpt(post),
  }));

  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
