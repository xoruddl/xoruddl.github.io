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

// 목록·사이드바처럼 좁은 자리에서 쓰는 "2026. 9. 18." 형식.
export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(date);
}

// 코드 블록 밖에서 처음 나오는 이미지를 목록 썸네일로 쓴다. 없으면 썸네일 없이 표시한다.
export function thumbnail(post: Post): string | undefined {
  const body = (post.body ?? '').replace(/```[\s\S]*?```/g, ' ');
  const src = body.match(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/)?.[1] ?? body.match(/<img\s[^>]*src=["']([^"']+)["']/)?.[1];
  if (!src) return undefined;
  return src.replace(/^(\.\.\/)+assets\//, '/assets/');
}

export interface CategoryNode {
  name: string;
  count: number;
  children: { name: string; count: number }[];
}

function compareCategoryNames(a: string, b: string): number {
  const aStartsWithLatin = /^[A-Za-z]/.test(a);
  const bStartsWithLatin = /^[A-Za-z]/.test(b);
  if (aStartsWithLatin !== bStartsWithLatin) return aStartsWithLatin ? -1 : 1;
  return a.localeCompare(b, aStartsWithLatin ? 'en' : 'ko', { sensitivity: 'base' });
}

// categories: [상위, 하위] 형식의 순서를 카테고리 트리로 사용한다.
export function categoryTree(posts: Post[]): CategoryNode[] {
  const counts = new Map<string, number>();
  const groups = new Map<string, string[]>();

  for (const post of posts) {
    const path = asList(post.data.categories);
    for (const category of path) counts.set(category, (counts.get(category) ?? 0) + 1);
    for (let index = 0; index < path.length - 1; index += 1) {
      const children = groups.get(path[index]) ?? [];
      if (!children.includes(path[index + 1])) children.push(path[index + 1]);
      groups.set(path[index], children);
    }
  }

  const childNames = new Set([...groups.values()].flat());
  return [...counts]
    .filter(([name]) => !childNames.has(name))
    .sort(([a], [b]) => compareCategoryNames(a, b))
    .map(([name, count]) => ({
      name,
      count,
      children: (groups.get(name) ?? [])
        .map((child) => ({ name: child, count: counts.get(child) ?? 0 }))
        .sort((a, b) => compareCategoryNames(a.name, b.name)),
    }));
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
