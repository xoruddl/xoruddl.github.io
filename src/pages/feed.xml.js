import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { excerpt, postUrl, sortPosts } from '../lib/posts';
import { SITE } from '../lib/site';

export async function GET(context) {
  const posts = sortPosts(await getCollection('posts'));
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: excerpt(post),
      pubDate: post.data.date,
      link: postUrl(post),
      categories: [...(Array.isArray(post.data.categories) ? post.data.categories : [post.data.categories]), ...(Array.isArray(post.data.tags) ? post.data.tags : [post.data.tags])].filter(Boolean),
    })),
    customData: '<language>ko-KR</language>',
  });
}
