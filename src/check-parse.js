// Does every module actually parse?
//
// `node --check` is not enough, and the way it is not enough is nasty: V8
// compiles function bodies LAZILY, so an early error inside a function -- a
// redeclared identifier, a duplicate parameter -- is not seen at all. A file
// can pass --check and still throw SyntaxError the moment the browser loads
// it. That is exactly how `update(now, dt)` shipped alongside a `const dt`
// already living in the body.
//
// Dynamic import() parses the whole module up front, before it goes looking
// for anything the module imports. So a SyntaxError comes back if and only if
// the file is genuinely broken, while ERR_MODULE_NOT_FOUND just means we got
// as far as `three`, which is not installed here and is not the point.
//
//   node check-parse.js
//
// No dependencies, same as the other checks in here.

import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = process.argv[2] ?? path.dirname(new URL(import.meta.url).pathname);
const files = (await readdir(dir))
  .filter((f) => f.endsWith('.js') && !f.startsWith('check-'))
  .sort();

const broken = [];

for (const file of files) {
  try {
    await import(pathToFileURL(path.join(dir, file)).href);
  } catch (err) {
    // The module parsed; we only failed to find something it imports, or it
    // threw while running its top level. Neither is a parse error.
    if (err instanceof SyntaxError) {
      broken.push([file, err.message.split('\n')[0]]);
    }
  }
}

for (const [file, message] of broken) console.log(`  FAIL  ${file}  ${message}`);

console.log(broken.length
  ? `\n${broken.length} file(s) will not parse`
  : `every one of ${files.length} modules parses in full`);

process.exit(broken.length ? 1 : 0);
