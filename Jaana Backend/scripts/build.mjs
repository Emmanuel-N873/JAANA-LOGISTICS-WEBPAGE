import { mkdir, readFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.dirname(backend);
const output = path.resolve(backend, 'dist');
if (path.dirname(output) !== backend || path.basename(output) !== 'dist') throw new Error('Unsafe output path');
// Rebuild only the verified generated-output directory, never the source tree.
await rm(output, { recursive: true, force: true });
const pending = ['index.html', 'admin.html', '_routes.json', '_headers'];
const backendAssets = new Set(['admin.html', 'admin.css', 'admin.js', 'admin-accounts.js', '_routes.json', '_headers']);
const copied = new Set();
while (pending.length) {
  const file = pending.shift();
  if (copied.has(file)) continue;
  const sourceRoot = backendAssets.has(file) ? backend : frontend;
  const source = path.resolve(sourceRoot, file);
  if (!source.startsWith(sourceRoot + path.sep) || file.startsWith('dist/') || file.startsWith('Jaana Backend/')) throw new Error('Invalid asset path');
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  await copyFile(source, path.join(output, file));
  copied.add(file);
  if (!/\.(html|css)$/.test(file)) continue;
  const contents = await readFile(source, 'utf8');
  for (const match of contents.matchAll(/(?:src|href)="([^"#]+)"|url\(['"]?([^'")]+)['"]?\)/g)) {
    const asset = match[1] || match[2];
    if (/^(?:[a-z]+:|\/\/|#)/i.test(asset)) continue;
    pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), asset.replace(/^\//, ''))));
  }
}
console.log(`Prepared ${copied.size} public assets in dist/. Server code, database and secrets are excluded.`);
