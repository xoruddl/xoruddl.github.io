import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { asList, postUrl, sortPosts, taxonomySlug } from '../lib/posts';
import { SITE } from '../lib/site';

const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (char) => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
})[char] ?? char);

export const GET: APIRoute = async () => {
  const posts = sortPosts(await getCollection('posts'));
  const categories = [...new Set(posts.flatMap((post) => asList(post.data.categories)))];
  const tags = [...new Set(posts.flatMap((post) => asList(post.data.tags)))];
  const staticPaths = ['/', '/categories/', '/tags/', '/archives/', '/about/', '/search/'];

  const entries: Array<{ path: string; lastmod?: string }> = [
    ...staticPaths.map((path) => ({ path })),
    ...categories.map((category) => ({ path: `/categories/${taxonomySlug(category)}/` })),
    ...tags.map((tag) => ({ path: `/tags/${taxonomySlug(tag)}/` })),
    ...posts.map((post) => ({
      path: postUrl(post),
      lastmod: (post.data.last_modified_at ?? post.data.date).toISOString(),
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(({ path, lastmod }) => `  <url>\n    <loc>${escapeXml(new URL(path, SITE.url).href)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`)
    .join('\n')}\n</urlset>\n`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
