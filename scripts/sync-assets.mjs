import { cp, mkdir, rm } from 'node:fs/promises';

const target = new URL('../public/assets/', import.meta.url);
const source = new URL('../assets/', import.meta.url);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
