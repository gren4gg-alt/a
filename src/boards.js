import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Blackboards, and the notice by the front door.
//
// Boards sync as STROKES, not as images. A stroke is a colour, a width and a
// run of normalised points — a few hundred bytes for something that would be a
// 200 KB PNG. They go on the reliable channel because a lost one leaves a gap
// in someone's handwriting forever, and they replay in arrival order on every
// machine, so nobody needs to send a whole board.
//
// Everything is normalised 0..1 so the surface you draw on and the surface it
// appears on do not have to be the same size.
// ---------------------------------------------------------------------------

export const CHALK = ['#e8e3d4', '#f0c07a', '#8fd6ff', '#f08a8a'];
const BOARD_W = 768;
const BOARD_H = 512;

export function createBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_W;
  canvas.height = BOARD_H;
  const ctx = canvas.getContext('2d');
  clearBoard(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx, texture, strokes: [] };
}

function clearBoard(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, BOARD_H);
  g.addColorStop(0, '#1d2622');
  g.addColorStop(1, '#141b18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  // Ghosts of everything wiped off it before you got here.
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#cfe0d4';
  ctx.lineWidth = 9;
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    const y = Math.random() * BOARD_H;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(BOARD_W * 0.3, y + 30, BOARD_W * 0.7, y - 30, BOARD_W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Paint one stroke. Same code on every machine, so boards stay identical. */
export function paintStroke(board, stroke) {
  const { ctx } = board;
  const pts = stroke.p;
  if (!pts || pts.length < 2) return;

  ctx.save();
  if (stroke.c === -1) {
    // Eraser: paint the board back over itself.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#18211d';
    ctx.lineWidth = stroke.w * 3.5;
  } else {
    ctx.strokeStyle = CHALK[stroke.c] ?? CHALK[0];
    ctx.lineWidth = stroke.w;
    ctx.globalAlpha = 0.9;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0] * BOARD_W, pts[1] * BOARD_H);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * BOARD_W, pts[i + 1] * BOARD_H);
  ctx.stroke();
  ctx.restore();

  board.texture.needsUpdate = true;
}

export function applyStroke(board, stroke) {
  if (stroke.clear) {
    board.strokes.length = 0;
    clearBoard(board.ctx);
    board.texture.needsUpdate = true;
    return;
  }
  board.strokes.push(stroke);
  paintStroke(board, stroke);
}

// ---------------------------------------------------------------------------
// The drawing overlay.
// ---------------------------------------------------------------------------

export class BoardEditor {
  /**
   * @param host emptied and filled with the editor
   * @param board the board being edited, drawn into live
   * @param onStroke called once per completed stroke, for the network
   */
  constructor(host, board, onStroke) {
    this.board = board;
    this.onStroke = onStroke;
    this.colour = 0;
    this.width = 4;
    this.drawing = false;
    this.points = [];

    host.innerHTML = '';
    const frame = document.createElement('div');
    frame.className = 'bd';

    const tools = document.createElement('div');
    tools.className = 'bd-tools';
    CHALK.forEach((hex, i) => {
      const b = document.createElement('button');
      b.className = 'bd-chalk' + (i === 0 ? ' on' : '');
      b.style.background = hex;
      b.addEventListener('click', () => {
        this.colour = i;
        [...tools.children].forEach((c) => c.classList.remove('on'));
        b.classList.add('on');
      });
      tools.appendChild(b);
    });
    const eraser = document.createElement('button');
    eraser.className = 'bd-chalk bd-eraser';
    eraser.textContent = 'Erase';
    eraser.addEventListener('click', () => {
      this.colour = -1;
      [...tools.children].forEach((c) => c.classList.remove('on'));
      eraser.classList.add('on');
    });
    tools.appendChild(eraser);

    const wipe = document.createElement('button');
    wipe.className = 'btn quiet bd-wipe';
    wipe.textContent = 'Wipe it';
    wipe.addEventListener('click', () => {
      const stroke = { clear: true };
      applyStroke(board, stroke);
      this.onStroke(stroke);
    });

    // The board is mirrored onto its own canvas so the surface you draw on is
    // the surface that appears on the wall, at the same aspect.
    const view = document.createElement('canvas');
    view.className = 'bd-surface';
    view.width = BOARD_W;
    view.height = BOARD_H;
    this.view = view;
    this.vctx = view.getContext('2d');

    frame.append(tools, view, wipe);
    host.appendChild(frame);
    this._bind();
    this.refresh();
  }

  refresh() {
    this.vctx.clearRect(0, 0, BOARD_W, BOARD_H);
    this.vctx.drawImage(this.board.canvas, 0, 0);
  }

  _bind() {
    const at = (e) => {
      const r = this.view.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    const down = (e) => {
      this.drawing = true;
      this.points = at(e);
      this.view.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!this.drawing) return;
      const [x, y] = at(e);
      const n = this.points.length;
      // Skip micro-movements: a stroke is points on the wire, and sampling
      // every pixel of a slow drag would send hundreds for one letter.
      if (Math.hypot(x - this.points[n - 2], y - this.points[n - 1]) < 0.004) return;
      this.points.push(x, y);
      this._preview();
    };
    const up = () => {
      if (!this.drawing) return;
      this.drawing = false;
      if (this.points.length >= 4) {
        const stroke = { c: this.colour, w: this.width, p: this.points.map((v) => Math.round(v * 1000) / 1000) };
        applyStroke(this.board, stroke);
        this.onStroke(stroke);
      }
      this.points = [];
      this.refresh();
    };

    this.view.addEventListener('pointerdown', down);
    this.view.addEventListener('pointermove', move);
    this.view.addEventListener('pointerup', up);
    this.view.addEventListener('pointercancel', up);
    this.view.addEventListener('pointerleave', up);
  }

  /** Draw the in-progress line without committing it to the board. */
  _preview() {
    this.refresh();
    const pts = this.points;
    const c = this.vctx;
    c.save();
    c.strokeStyle = this.colour === -1 ? '#18211d' : CHALK[this.colour];
    c.lineWidth = this.colour === -1 ? this.width * 3.5 : this.width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(pts[0] * BOARD_W, pts[1] * BOARD_H);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] * BOARD_W, pts[i + 1] * BOARD_H);
    c.stroke();
    c.restore();
  }
}

// ---------------------------------------------------------------------------
// The notice by the front door.
//
// Drawn once at generation. It is the rules, on the wall of the room you start
// in, so a new player does not have to have read a menu to know what the house
// wants from them.
// ---------------------------------------------------------------------------

/**
 * The notice by the front door, as a list of lines.
 *
 * Built per house rather than sat in a constant, because half of what it says
 * is only true on some of them: a Quiet house has no traps to warn about and
 * cannot hear you talking, and telling a first-timer otherwise is worse than
 * saying nothing. The board sizes itself to whatever comes back, so adding a
 * line here is the whole job — no measuring, no re-cutting the plane.
 *
 * @param difficulty an entry from DIFFICULTIES, or nothing for the common set
 * @param level      the generated level, for the counts it can quote exactly
 */
export function noticeLines(difficulty = null, level = null) {
  const relics = level?.holders?.length ?? 4;
  const ghosts = level?.ghostCount ?? 0;
  const out = [
    ['title', 'IF YOU ARE READING THIS'],
    ['rule', `The door out wants ${relics === 4 ? 'four' : relics} things. Find them.`],
    ['rule', 'Each one sits by a screen. Beat the screen, take the object,'],
    ['rule', 'carry it back and set it in one of the holders.'],
    ['gap', ''],
    ['warn', 'THE SCREENS ARE LOUD. Everything in here hears them.'],
    ['rule', 'Walk away from one at any time \u2014 you lose only your progress.'],
    ['gap', ''],
    ['warn', 'THIS ROOM IS THE ONE PLACE THEY WILL NOT COME.'],
    ['rule', 'Stand in here and nothing out there knows you exist.'],
    ['gap', ''],
    ['rule', 'It cannot see through walls. It cannot hear you standing still.'],
    ['rule', 'Running is loud.'],
  ];

  // Only true on the houses where it is true.
  if (difficulty?.hearsVoice) {
    out.push(['warn', 'IT CAN HEAR YOUR VOICE IN HERE. Talking carries.']);
  }
  out.push(['gap', '']);
  out.push(['rule', 'Closets hide one person. A lit peephole means taken.']);
  out.push(['rule', 'Crawl holes are too low for it to follow. Crouch.']);

  if (difficulty?.trapInterval) {
    out.push(['gap', '']);
    out.push(['warn', 'IT LEAVES THINGS ON THE FLOOR. Watch where you run.']);
  }
  if (ghosts > 1) {
    out.push(['gap', '']);
    out.push(['rule', `There is more than one of them. We counted ${ghosts}.`]);
  }

  out.push(['gap', '']);
  out.push(['rule', 'If it puts you down, someone has to come and lift you up.']);
  out.push(['warn', 'NOBODY LEAVES UNTIL EVERYONE IS AT THE DOOR.']);
  return out;
}

// How each kind of line is drawn, and how much room it needs underneath.
const NOTICE_STYLE = {
  title: { font: '700 40px "IBM Plex Sans", system-ui, sans-serif', fill: '#2e2415', after: 50, rule: true },
  warn:  { font: '600 25px "IBM Plex Sans", system-ui, sans-serif', fill: '#8c2f1c', after: 34 },
  rule:  { font: '300 25px "IBM Plex Sans", system-ui, sans-serif', fill: '#3a2f1d', after: 32 },
  gap:   { after: 16 },
};

const NOTICE_PAD = 52;       // left and right margin inside the border
const NOTICE_TOP = 92;       // baseline of the first line
const NOTICE_BOTTOM = 46;    // clear space under the last line

/**
 * Draw the notice, sized to its own contents.
 *
 * The old version painted into a hardcoded 900x640 and was hung on a
 * hardcoded 1.5 x 1.07 plane, so any edit to the text either overflowed the
 * canvas or left a slab of blank paper. Now the canvas is measured from the
 * lines themselves and the caller is handed the aspect ratio to cut the plane
 * to, which means adding a line is a one-line change and nothing else moves.
 *
 * @returns {{texture: THREE.CanvasTexture, width: number, height: number, aspect: number}}
 */
export function createNoticeTexture(lines = noticeLines()) {
  const measure = document.createElement('canvas').getContext('2d');

  // Pass one: how wide does the widest line want to be, and how tall is the
  // stack? Nothing is drawn yet.
  let widest = 0;
  let height = NOTICE_TOP;
  for (const [kind, text] of lines) {
    const st = NOTICE_STYLE[kind] ?? NOTICE_STYLE.rule;
    if (st.font && text) {
      measure.font = st.font;
      widest = Math.max(widest, measure.measureText(text).width);
    }
    height += st.after;
    if (st.rule) height += 22;
  }
  height += NOTICE_BOTTOM;

  // Round up to keep the texture on friendly numbers, and hold a sane floor so
  // a very short notice is still a readable object on a wall.
  const width = Math.max(700, Math.ceil((widest + NOTICE_PAD * 2) / 16) * 16);
  height = Math.max(360, Math.ceil(height / 16) * 16);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#cfc3a6';
  ctx.fillRect(0, 0, width, height);

  // Age it, or it reads as a UI panel bolted to a wall. Blot count follows the
  // area so a tall notice is not noticeably cleaner than a short one.
  const blots = Math.round((width * height) / 4800);
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#6a5636';
  for (let i = 0; i < blots; i++) {
    const r = 8 + Math.random() * 46;
    ctx.beginPath();
    ctx.arc(Math.random() * width, Math.random() * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = '#6a5a3e';
  ctx.lineWidth = 5;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  let y = NOTICE_TOP;
  for (const [kind, text] of lines) {
    const st = NOTICE_STYLE[kind] ?? NOTICE_STYLE.rule;
    if (st.font && text) {
      ctx.fillStyle = st.fill;
      ctx.font = st.font;
      ctx.fillText(text, NOTICE_PAD, y);
    }
    y += st.after;
    if (st.rule) {
      ctx.fillStyle = '#6a5a3e';
      ctx.fillRect(NOTICE_PAD, y - 22, width - NOTICE_PAD * 2, 3);
      y += 22;
    }
  }

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, width, height, aspect: width / height };
}
