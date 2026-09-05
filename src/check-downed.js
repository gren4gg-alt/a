// Static checks on the downed / last-stand flow: these are DOM-and-state paths
// that cannot be driven headlessly, so verify the wiring is actually present
// rather than assuming a patch landed. That is exactly what went wrong before.
import { readFileSync } from 'fs';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ok = (n, c) => console.log((c ? '  ok  ' : '  FAIL') + '  ' + n);

const fn = (name) => {
  const i = main.indexOf(`function ${name}(`);
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let j = i; j < main.length; j++) {
    if (main[j] === '{') { depth++; started = true; }
    else if (main[j] === '}') { depth--; if (started && depth === 0) return main.slice(i, j + 1); }
  }
  return '';
};

console.log('-- solo give up --');
const down = fn('applyDownLocal');
ok('applyDownLocal exists', down.length > 0);
ok('it toggles the give-up button', /el\.giveUp\.classList\.toggle/.test(down));
ok('hidden only in multiplayer', /toggle\('hidden',\s*isNet\(\)\)/.test(down));
ok('and seeds the timer text', /el\.downedTimer\.textContent/.test(down));
ok('the button exists in the HTML', html.includes('id="give-up"'));
ok('a handler is attached', /el\.giveUp\.addEventListener/.test(main));
const handler = main.slice(main.indexOf("el.giveUp.addEventListener"), main.indexOf("el.giveUp.addEventListener") + 220);
ok('it refuses to fire in multiplayer', /isNet\(\)/.test(handler) && /endRun\(false\)/.test(handler));

console.log('\n-- the countdown moves for a client --');
const sim = fn('simulate');
ok('clients decrement their own copy', /!isHost\(\)\s*&&\s*!run\.vote/.test(sim));
ok('and it is frozen while the vote is open', /!run\.vote/.test(sim));

console.log('\n-- all down opens the vote --');
const last = fn('hostCheckLastStand');
ok('hostCheckLastStand exists', last.length > 0);
ok('fires when everyone standing is down', /live\.every\(\(pl\) => pl\.downed\)/.test(last));
ok('and when nobody is left at all', /!live\.length/.test(last));
ok('does nothing without ads', /!adsEnabled\(\)/.test(last));
ok('is called from the host block', /hostCheckLastStand\(\);/.test(sim));
ok('will not re-open over itself', /run\.vote/.test(last));

console.log('\n-- solo never gets the group vote --');
ok('solo is handled before the vote opens', /if \(!isNet\(\)\)/.test(last));
ok('and solo still ends when the timer runs out',
   /if \(!isNet\(\)\) \{ if \(allGone\) endRun\(false\); return; \}/.test(last));
const esc = fn('checkEscape');
ok('checkEscape no longer ends runs itself', !/endRun\(false\)/.test(esc));
ok('and bails once the run is over', /if \(run\.over\) return;/.test(esc));

console.log('\n-- the two overlays never both show --');
const openVote = fn('openVoteUI');
ok('opening the vote hides the downed panel', /el\.downed\.classList\.add\('hidden'\)/.test(openVote));
const groupRevive = fn('applyGroupRevive');
ok('a group revive clears give-up too', /el\.giveUp\.classList\.add\('hidden'\)/.test(groupRevive));

console.log('\n-- the vote is unanimous or nothing --');
const record = fn('hostRecordVote');
ok('every player must have agreed', /allPlayers\(\)\.every/.test(record));
const close = fn('hostCloseVote');
ok('refusing ends the run', /endRun\(false\)/.test(close));
ok('agreeing revives everyone', /applyGroupRevive\(\)/.test(close));
ok('both options are offered in the HTML',
   html.includes('id="vote-watch"') && html.includes('id="vote-quit"'));

console.log('\n-- bleed-out is paused during the vote --');
ok('the host returns before ticking timers',
   sim.indexOf('run.vote') < sim.indexOf('for (const [id, t] of run.downTimers)'));
