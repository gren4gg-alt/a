// Every net.on(...) registration must balance its own parentheses.
//
// This exists because a missing close on a guard wrapper — net.on(MSG.X,
// fromHost((d) => { ... });  instead of ...}));  — still PARSES. The stray
// depth is absorbed by a later close, and the effect is that one handler is
// silently passed as an argument to the next. `node --check` is happy and the
// game is quietly broken.
//
// Comments are stripped before scanning, because an apostrophe in prose
// ("a client's chalk") otherwise looks like the start of a string literal.
import { readFileSync } from 'fs';

const file = new URL('../src/main.js', import.meta.url);
const raw = readFileSync(file, 'utf8');

function stripComments(src) {
  let out = '', i = 0, str = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (str) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === str) str = null;
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; out += ' '; i++; continue; }
    out += c; i++;
  }
  return out;
}

const src = stripComments(raw);
const bad = [];
let total = 0;

for (const m of src.matchAll(/net\.on\(/g)) {
  total++;
  let depth = 0, j = m.index + m[0].length - 1;
  for (; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') { depth--; if (depth === 0) break; }
  }
  const line = raw.slice(0, m.index).split('\n').length;
  if (depth !== 0) { bad.push(`line ${line}: never closes`); continue; }
  if (src.slice(j, j + 2) !== ');') {
    bad.push(`line ${line}: closes as "${raw.slice(j, j + 3).replace(/\n/g, '\\n')}" not ");"`);
  }
}

console.log(`net.on registrations: ${total}`);
console.log(bad.length ? `unbalanced: ${bad.length}` : 'every handler balances on its own');
for (const b of bad) console.log('  ' + b);
process.exit(bad.length ? 1 : 0);
