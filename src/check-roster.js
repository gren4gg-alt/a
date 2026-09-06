// Every path that can put somebody in the roster must carry a session id, and
// must first evict anybody already holding that session id.
//
// This exists because the two paths — 'joined' and MSG.HELLO — race. HELLO
// rides the reliable channel and 'joined' waits for both channels, so on a good
// day HELLO wins and on a bad day it does not. When the losing path was the
// only one that knew about session ids, an entry created by the other one could
// never be recognised as a reconnect, and the same person appeared twice.
//
// Nothing about that is visible from a stack trace or a parse. It is a property
// of the handlers, so it is checked as one.
import { readFileSync } from 'fs';

const ROOT = new URL('..', import.meta.url).pathname;
const main = readFileSync(`${ROOT}/src/main.js`, 'utf8');
const net = readFileSync(`${ROOT}/src/net.js`, 'utf8');

const fail = [];
const ok = [];
const check = (label, condition) => (condition ? ok : fail).push(label);

/** The body of a handler, from its registration to the matching close. */
function handlerBody(source, opener) {
  const start = source.indexOf(opener);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

const joined = handlerBody(main, "net.on('joined'");
const hello = handlerBody(main, 'net.on(MSG.HELLO');

check("the 'joined' handler exists", !!joined);
check('the HELLO handler exists', !!hello);

for (const [label, body] of [['joined', joined], ['HELLO', hello]]) {
  if (!body) continue;
  check(`${label} evicts a stale session before adding anyone`,
    body.includes('hostDropStaleSession'));
  check(`${label} destructures sid off the payload`,
    /\{[^}]*\bsid\b[^}]*\}/.test(body.split('\n')[0]));
  // Either it pushes a new entry carrying sid, or it repairs an existing one.
  check(`${label} stores the session id on the entry`,
    /roster\.push\(\{[^}]*\bsid\b/.test(body) || /\.sid\s*(\?\?)?=/.test(body));
}

// The wire has to carry it in the first place. Connection metadata alone is not
// enough: HELLO is a message, and it arrives before 'joined' announces.
check('HELLO is sent with a session id',
  /MSG\.HELLO,\s*\{[^}]*\bsid\b/.test(net));
check('connection metadata carries a session id',
  /metadata:\s*\{[^}]*sid:\s*sessionId\(\)/.test(net));

// The fallback used to write to `this`, which is undefined in a module — so
// with storage blocked it threw and no join carried a session id at all.
check('sessionId does not use `this`',
  !/function sessionId\(\)[\s\S]*?\n\}/.exec(net)?.[0].includes('this.'));

// A session id is the host's business. Handing a persistent browser identifier
// to five strangers is not something to reintroduce by accident.
check('the lobby broadcast does not ship session ids',
  !/roster:\s*session\.roster\.map[\s\S]{0,240}?\bsid:/.test(main));

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);
console.log(fail.length
  ? `\n${fail.length} roster check(s) failed`
  : `\nall ${ok.length} roster checks pass`);
process.exit(fail.length ? 1 : 0);
