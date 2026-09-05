// ---------------------------------------------------------------------------
// Characters.
//
// Every ability hooks something the game already simulates, rather than adding
// a parallel system:
//
//   flare    -> the house shader's second light slot, plus ghost.lastSeen
//   sprint   -> the player's speed constants
//   stillness-> the ghost's hearing and sight checks
//   sense    -> the loot beads that already exist for teammates
//   brace    -> the host's knockdown path
//   shove    -> the ghost's own stun timer
//
// Passives are free and always on. Actives are one key, one cooldown, no
// resource bar — this is a game about walking and panicking, not about managing
// meters.
// ---------------------------------------------------------------------------

export const CHARACTERS = [
  {
    id: 'lamplighter',
    price: 0,
    name: 'The Lamplighter',
    tag: 'Sees further, gives it away',
    color: 0xffb066,
    accent: 0xff7a2a,
    silhouette: 'lantern',
    passive: 'Your flashlight reaches half again as far.',
    ability: 'Flare',
    abilityText: 'Drop a burning light. It lights the room for 20 seconds and pulls the ghost towards it.',
    cooldown: 50,
    stats: { flashlightRange: 1.5 },
  },
  {
    id: 'runner',
    price: 900,
    name: 'The Runner',
    tag: 'Faster than it, briefly',
    color: 0x7fd6ff,
    accent: 0x2f9fd8,
    silhouette: 'lean',
    passive: 'You run 15% faster and your footsteps carry less.',
    ability: 'Bolt',
    abilityText: 'Four seconds of speed nothing in the house can match.',
    cooldown: 32,
    stats: { sprintScale: 1.15, loudnessScale: 0.7 },
  },
  {
    id: 'nurse',
    price: 1400,
    name: 'The Nurse',
    tag: 'Gets people back up',
    color: 0x9fffc8,
    accent: 0x3fbf8a,
    silhouette: 'satchel',
    passive: 'You pick people up in well under half the time, and you last far longer on the floor.',
    ability: 'Second wind',
    abilityText: 'Get yourself up off the floor. Once per run, and only once.',
    cooldown: 0,
    stats: { reviveScale: 0.42, bleedScale: 1.9 },
  },
  {
    id: 'scavenger',
    price: 1100,
    name: 'The Scavenger',
    tag: 'Knows where the money is',
    color: 0xffe58f,
    accent: 0xc9a63c,
    silhouette: 'hooked',
    passive: 'Anything worth taking glows through walls within 18 metres.',
    ability: 'Read the house',
    abilityText: 'Every remaining item and the way out light up for 8 seconds, whatever is between you.',
    cooldown: 40,
    stats: { lootSense: 18 },
  },
  {
    id: 'quiet',
    price: 2200,
    name: 'The Quiet One',
    tag: 'Hard to notice at all',
    color: 0xd0a8ff,
    accent: 0x8055c8,
    silhouette: 'hooded',
    passive: 'Running does not make you loud.',
    ability: 'Go still',
    abilityText: 'Six seconds during which the ghost cannot see or hear you at all. Moving is allowed. Breathing is optional.',
    cooldown: 45,
    stats: { loudnessScale: 0.35 },
  },
  {
    id: 'warden',
    price: 1800,
    name: 'The Warden',
    tag: 'Takes the hit',
    color: 0xff8fa8,
    accent: 0xc2455f,
    silhouette: 'broad',
    passive: 'The first knife each run knocks the wind out of you instead of putting you down.',
    ability: 'Shove',
    abilityText: 'Put it on the floor for five seconds. You have to be close enough to regret it.',
    cooldown: 55,
    stats: { braces: 1, bleedScale: 1.5 },
  },
];

// The Lamplighter is free forever: there has to be someone to play as before
// anyone has earned anything, and a torch that reaches further is the least
// situational of the six.
export const DEFAULT_CHARACTER = CHARACTERS[0].id;

export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

// ---------------------------------------------------------------------------
// Runtime state for whichever character the local player took.
// ---------------------------------------------------------------------------

export class Loadout {
  constructor(character) {
    this.char = character;
    this.stats = { ...defaultStats(), ...character.stats };
    this.cooldown = 0;
    this.active = 0;          // seconds of ability left
    this.used = 0;
    this.bracesLeft = this.stats.braces;
  }

  get ready() { return this.cooldown <= 0 && !(this.char.cooldown === 0 && this.used > 0); }
  get isActive() { return this.active > 0; }

  tick(dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.active > 0) this.active = Math.max(0, this.active - dt);
  }

  fire() {
    if (!this.ready) return false;
    this.used++;
    this.cooldown = this.char.cooldown;
    this.active = ABILITY_DURATION[this.char.id] ?? 0;
    return true;
  }

  /** Does the ghost's hearing check apply to this player right now? */
  get undetectable() { return this.char.id === 'quiet' && this.isActive; }

  /** Consume a brace instead of going down. Returns true if the hit was eaten. */
  absorbHit() {
    if (this.bracesLeft > 0) { this.bracesLeft--; return true; }
    return false;
  }
}

export const ABILITY_DURATION = {
  lamplighter: 20,
  runner: 4,
  nurse: 0,
  scavenger: 8,
  quiet: 6,
  warden: 5,
};

function defaultStats() {
  return {
    flashlightRange: 1.0,
    sprintScale: 1.0,
    loudnessScale: 1.0,
    reviveScale: 1.0,
    bleedScale: 1.0,
    lootSense: 0,
    braces: 0,
  };
}
