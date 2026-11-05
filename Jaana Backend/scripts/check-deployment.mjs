import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This script is a local safety check. It never logs in to Cloudflare,
// changes the database or publishes the website.
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(backend, 'dist');
const config = path.join(backend, 'wrangler.jsonc');

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function requireFile(relativePath) {
  const file = path.join(output, relativePath);
  if (!(await exists(file))) throw new Error(`Missing generated file: dist/${relativePath}`);
}

if (!(await exists(output))) {
  throw new Error('dist/ does not exist. Run npm.cmd run build first.');
}

const wrangler = await readFile(config, 'utf8');
if (!/"pages_build_output_dir"\s*:\s*"\.\/dist"/.test(wrangler)) {
  throw new Error('wrangler.jsonc must publish the generated ./dist directory.');
}
if (!/"binding"\s*:\s*"DB"/.test(wrangler)) {
  throw new Error('wrangler.jsonc must expose the D1 database as the DB binding.');
}
if (/00000000-0000-0000-0000-000000000000|replace-with|your-database-id/i.test(wrangler)) {
  throw new Error('wrangler.jsonc still contains a placeholder database ID.');
}

for (const file of [
  'index.html',
  'calculator.html',
  'admin.html',
  'favicon.ico',
  '404.html',
  '_headers',
  '_routes.json',
  'assets/js/service-carousel.js',
  'assets/js/booking.js',
  'assets/images/favicon-mascot.svg',
]) {
  await requireFile(file);
}

const forbiddenNames = new Set([
  '.dev.vars',
  '.env',
  '.staff-bootstrap.sql',
  '.staff-recovery.sql',
  'wrangler.jsonc',
]);
const forbiddenFolders = new Set(['functions', 'migrations', 'server', 'tests', 'node_modules']);

async function inspect(folder, relative = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const entryRelative = path.posix.join(relative, entry.name);
    if (forbiddenNames.has(entry.name) || forbiddenFolders.has(entry.name)) {
      throw new Error(`Server-only file or folder was copied to dist/: ${entryRelative}`);
    }
    if (entry.isDirectory()) await inspect(path.join(folder, entry.name), entryRelative);
  }
}

await inspect(output);
console.log('Deployment check passed: dist/ contains the required public files and no known server-only files.');
