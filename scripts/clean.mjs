import { rm } from 'node:fs/promises';

await Promise.all([
  rm('out', { force: true, recursive: true }),
  rm('dist', { force: true, recursive: true }),
]);
