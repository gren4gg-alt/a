// Every el.<name> used in main.js must be defined in the el object literal,
// and every id it looks up must exist in index.html. A one-line sed once
// deleted three properties at once because they shared a line; this makes
// that class of mistake impossible to ship.
import { readFileSync } from 'fs';
const ROOT = new URL('..', import.meta.url).pathname;
const main = readFileSync(`${ROOT}/src/main.js`, 'utf8');
const ui = readFileSync(`${ROOT}/src/ui.js`, 'utf8');
const html = readFileSync(`${ROOT}/index.html`, 'utf8');

// the el = { ... } literal
const start = main.indexOf('const el = {');
const end = main.indexOf('\n};', start);
const literal = main.slice(start, end);
const defined = new Set([...literal.matchAll(/(\w+)\s*:\s*\$\(/g)].map(m => m[1]));
const used = new Set([...main.matchAll(/\bel\.(\w+)\b/g)].map(m => m[1]));
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const looked = new Set([...main.matchAll(/\$\('([^']+)'\)/g), ...ui.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));

const missingProps = [...used].filter(k => !defined.has(k)).sort();
const unusedProps = [...defined].filter(k => !used.has(k)).sort();
const missingIds = [...looked].filter(k => !ids.has(k)).sort();

console.log(`el properties defined ${defined.size}, used ${used.size}, ids looked up ${looked.size}`);
console.log('used but NOT defined :', missingProps.length ? missingProps.join(', ') : 'none');
console.log('defined but unused   :', unusedProps.length ? unusedProps.join(', ') : 'none');
console.log('looked up but no id  :', missingIds.length ? missingIds.join(', ') : 'none');

// every id the el literal resolves must exist too
const elIds = [...literal.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const badElIds = elIds.filter(i => !ids.has(i));
console.log('el handles with no id:', badElIds.length ? badElIds.join(', ') : 'none');

const bad = missingProps.length + missingIds.length + badElIds.length;
console.log(bad ? `\n${bad} problem(s)` : '\nDOM wiring is complete');
process.exit(bad ? 1 : 0);
