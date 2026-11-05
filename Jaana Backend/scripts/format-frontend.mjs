import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

// Restrict this command to frontend source; API code and existing migrations are untouched.
const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDirectory = path.dirname(backendDirectory);
const files = ['index.html', 'calculator.html', 'Jaana Backend/dashboard/admin.html'];

for (const directory of [
  'assets/js',
  'assets/css',
  'Jaana Backend/dashboard/js',
  'Jaana Backend/dashboard/css',
]) {
  for (const name of await readdir(path.join(projectDirectory, directory))) {
    if (/\.(js|css)$/.test(name)) files.push(path.join(directory, name));
  }
}

for (const name of [
  'booking-flow.test.mjs',
  'calculator.test.mjs',
  'frontend-contract.test.mjs',
  'service-carousel.test.mjs',
]) {
  const relativePath = path.join('Jaana Backend/tests', name);
  try {
    await readFile(path.join(projectDirectory, relativePath));
    files.push(relativePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const checkOnly = process.argv.includes('--check');
let unformattedFiles = 0;
for (const relativePath of files) {
  const absolutePath = path.join(projectDirectory, relativePath);
  const source = await readFile(absolutePath, 'utf8');
  const configuration = await prettier.resolveConfig(absolutePath);
  const options = { ...configuration, filepath: absolutePath };
  if (checkOnly) {
    if (!(await prettier.check(source, options))) {
      console.error(`Needs formatting: ${relativePath}`);
      unformattedFiles += 1;
    }
  } else {
    await writeFile(absolutePath, await prettier.format(source, options));
  }
}

console.log(`${checkOnly ? 'Checked' : 'Formatted'} ${files.length} frontend files.`);
if (unformattedFiles) process.exitCode = 1;
