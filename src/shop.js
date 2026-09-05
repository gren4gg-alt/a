import { CHARACTERS, characterById, DEFAULT_CHARACTER } from './characters.js';

// ---------------------------------------------------------------------------
// Who you own.
//
// Kept deliberately small: a set of ids in localStorage, and one function that
// spends. There is no server, so this is trust-based by construction — a player
// who wants everything unlocked can edit their own storage, and that is fine.
// The purpose of the price is to give the shards a reason to exist, not to
// defend anything.
// ---------------------------------------------------------------------------

const KEY = 'darkhouse.owned.v1';

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function write(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* memory only */ }
}

let owned = read();
owned.add(DEFAULT_CHARACTER);

export function owns(id) {
  return characterById(id).price === 0 || owned.has(id);
}

export function ownedList() {
  return CHARACTERS.filter((c) => owns(c.id));
}

export function priceOf(id) {
  return characterById(id).price ?? 0;
}

/**
 * @returns {'bought'|'owned'|'poor'}
 */
export function buy(id, bank) {
  if (owns(id)) return 'owned';
  const price = priceOf(id);
  if (bank.read() < price) return 'poor';
  bank.write(bank.read() - price);
  owned.add(id);
  write(owned);
  return 'bought';
}

/** Used when a saved character was somehow lost, or on a fresh browser. */
export function firstOwned() {
  return ownedList()[0]?.id ?? DEFAULT_CHARACTER;
}

export function resetOwned() {
  owned = new Set([DEFAULT_CHARACTER]);
  write(owned);
}
