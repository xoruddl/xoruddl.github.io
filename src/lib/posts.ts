import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export const PAGE_SIZE = 10;

export function pageUrl(page: number): string {
  return page === 1 ? '/' : `/page${page}/`;
}

export function asList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function postSlug(post: Post): string {
  return post.id
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/-+$/, '');
}

export function postUrl(post: Post): string {
  return `/posts/${postSlug(post)}/`;
}

export function taxonomySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
    .replace(/-+/g, '-');
}

export function sortPosts(posts: Post[]): Post[] {
  return [...posts]
    .filter((post) => post.data.published !== false)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(date);
}

export function excerpt(post: Post, length = 150): string {
  if (post.data.description) return post.data.description;
  const plain = (post.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? `${plain.slice(0, length).trim()}…` : plain;
}

export function readingMinutes(post: Post): number {
  const words = (post.body ?? '').replace(/```[\s\S]*?```/g, ' ').trim().length;
  return Math.max(1, Math.ceil(words / 500));
}
