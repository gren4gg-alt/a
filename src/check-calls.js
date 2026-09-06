// Every audio.X(), voice.X() and interact.X() called from main.js must exist on
// the class that provides it.
//
// This exists because a single careless slice once removed three methods at
// once — the player footstep it was aiming at, plus creak and terminalNoise
// that happened to sit inside the same span. Nothing catches that: the module
// parses, the game boots, and it throws only when somebody finally uses a
// terminal, mid-run, several sessions later.
import { readFileSync } from 'fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const main = read('../src/main.js');

const targets = [
  ['audio', '../src/audio.js'],
  ['voice', '../src/voice.js'],
];

let bad = 0;
for (const [name, path] of targets) {
  const src = read(path);
  // methods declared at class-body indentation, plus getters
  const defined = new Set([
    ...[...src.matchAll(/^\s{2}(?:async\s+)?(?:get\s+|set\s+)?([a-zA-Z_]\w*)\s*\(/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^\s{4}this\.([a-zA-Z_]\w*)\s*=\s*(?:\(|function)/gm)].map((m) => m[1]),
  ]);
  const called = new Set(
    [...main.matchAll(new RegExp(`\\b${name}\\.([a-zA-Z_]\\w*)\\s*\\(`, 'g'))].map((m) => m[1]),
  );
  const missing = [...called].filter((c) => !defined.has(c)).sort();
  console.log(`${name}: ${called.size} called, ${defined.size} defined` +
    (missing.length ? ` -> MISSING ${missing.join(', ')}` : ' -> all present'));
  bad += missing.length;
}

process.exit(bad ? 1 : 0);
