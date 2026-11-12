// 모든 소스를 esbuild로 변환해 문법 오류를 찾는다. JSX도 함께 검사한다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(name)) files.push(p);
  }
})(root);
for (const file of files)
  transformSync(readFileSync(file, 'utf8'), {
    loader: file.endsWith('.jsx') ? 'jsx' : 'js',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    sourcefile: file,
  });
console.log(`소스 ${files.length}개 문법 확인`);
