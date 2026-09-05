// Four difficulties. Each one scales the maze, the ghost, and what the run pays.
//
// Ghost speeds are all below the player's sprint (5.0 m/s) and around or above
// the walk (3.1 m/s), so you can always outrun it in a straight line but never
// while navigating. That gap is the whole game.
//
// tunnelChance is the fraction of extra crawl connections laid on top of the
// maze. They are the one place the ghost cannot follow, so the harder houses
// get MORE of them, not fewer — otherwise a faster ghost in a bigger house is
// just unfair rather than frightening.
//
// trapInterval is seconds between a snare being left behind. It is divided by
// ghostCount at runtime so three of them do not carpet the house three times
// faster than one did.
//
// cooldown is seconds between knives, PER GHOST. At 1.0 with roughly one ghost
// per seven rooms, standing in the open in line of sight is fatal in about a
// second — which is the intent, but it means the counterplay is entirely
// breaking line of sight rather than out-running the throw.
//
// ghostShare is how many hunters the house holds, as a fraction of its rooms.
// A fixed count barely registered once houses got large: you could walk for
// minutes without meeting anything.
//
// closetShare and boardShare are fractions of the room count. Closets scale
// hard with difficulty: at one ghost per seven rooms there has to be somewhere
// to get off the floor, and the harder houses are where you need it.
//
// hearsVoice lets them hear your microphone. On the harder houses, shouting
// down the corridor is a real decision — the proximity chat that keeps you
// coordinated is the same channel that gives you away.

export const DIFFICULTIES = [
  {
    id: 'quiet',
    closetShare: 0.1,
    boardShare: 0.12,
    ghostShare: 0.15,
    hearsVoice: false,
    label: 'Quiet',
    blurb: 'A small house. It knows you are here, but it is patient.',
    grid: [6, 8],
    loopChance: 0.20,
    tunnelChance: 0.30,
    trapInterval: 0,
    lightChance: 0.62,
    ghost: { speed: 2.0, sight: 13, hearing: 7, throwRange: 11, cooldown: 1.0, knifeSpeed: 11, hearsVoice: false },
    lootCount: 6,
    payoutBase: 60,
    payoutMultiplier: 1.0,
    parSeconds: 150,
    fogDensity: 0.072,
  },
  {
    id: 'restless',
    closetShare: 0.15,
    boardShare: 0.15,
    ghostShare: 0.15,
    hearsVoice: false,
    label: 'Restless',
    blurb: 'Longer halls. Fewer lamps still burning.',
    grid: [8, 11],
    loopChance: 0.15,
    tunnelChance: 0.32,
    trapInterval: 0,
    lightChance: 0.50,
    ghost: { speed: 2.4, sight: 16, hearing: 9, throwRange: 13, cooldown: 1.0, knifeSpeed: 13, hearsVoice: false },
    lootCount: 9,
    payoutBase: 110,
    payoutMultiplier: 1.7,
    parSeconds: 260,
    fogDensity: 0.082,
  },
  {
    id: 'hunted',
    closetShare: 0.25,
    boardShare: 0.18,
    ghostShare: 0.15,
    hearsVoice: true,
    label: 'Hunted',
    blurb: 'It stopped wandering a while ago.',
    grid: [10, 13],
    loopChance: 0.10,
    tunnelChance: 0.38,
    trapInterval: 26,
    lightChance: 0.40,
    ghost: { speed: 2.8, sight: 19, hearing: 12, throwRange: 15, cooldown: 1.0, knifeSpeed: 15, hearsVoice: true },
    lootCount: 12,
    payoutBase: 180,
    payoutMultiplier: 2.6,
    parSeconds: 400,
    fogDensity: 0.090,
  },
  {
    id: 'starving',
    closetShare: 0.3,
    boardShare: 0.22,
    ghostShare: 0.15,
    hearsVoice: true,
    label: 'Starving',
    blurb: 'Almost every room is dark. It is faster than you remember.',
    grid: [11, 17],
    loopChance: 0.06,
    tunnelChance: 0.45,
    trapInterval: 17,
    lightChance: 0.30,
    ghost: { speed: 3.2, sight: 23, hearing: 15, throwRange: 18, cooldown: 1.0, knifeSpeed: 17, hearsVoice: true },
    lootCount: 16,
    payoutBase: 300,
    payoutMultiplier: 4.0,
    parSeconds: 620,
    fogDensity: 0.098,
  },
];

export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];
}
