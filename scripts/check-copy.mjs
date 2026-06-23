import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const roots = ['app', 'components', 'lib'];
const allowedExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const banned = [
  /we don't hold user money/i,
  /do not hold user money/i,
  /non-custodial/i,
  /200\+ countries/i,
  /guaranteed rate/i,
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (allowedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
for (const root of roots) {
  for (const file of await filesUnder(root)) {
    const text = await readFile(file, 'utf8');
    for (const pattern of banned) {
      if (pattern.test(text)) violations.push(`${relative('.', file)}: ${pattern.source}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Banned compliance copy found:\n' + violations.join('\n'));
  process.exit(1);
}

console.log('Compliance copy check passed.');
