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

const NOTICE = [
  ['title', 'IF YOU ARE READING THIS'],
  ['rule', 'The door out wants four things. Find them.'],
  ['rule', 'Each one sits by a screen. Beat the screen, take the object,'],
  ['rule', 'carry it back and set it in one of the four holders.'],
  ['gap', ''],
  ['warn', 'THE SCREENS ARE LOUD. Everything in here hears them.'],
  ['rule', 'Walk away from one at any time. Esc, or click off it.'],
  ['gap', ''],
  ['rule', 'It cannot see through walls. It cannot hear you standing still.'],
  ['rule', 'Running is loud. On a bad night, so is talking.'],
  ['gap', ''],
  ['rule', 'Closets hide one person. A lit peephole means taken.'],
  ['rule', 'Crawl holes are too low for it to follow. Crouch.'],
  ['gap', ''],
  ['rule', 'If it puts you down, someone has to come and lift you up.'],
  ['warn', 'NOBODY LEAVES UNTIL EVERYONE IS AT THE DOOR.'],
];

export function createNoticeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#cfc3a6';
  ctx.fillRect(0, 0, 900, 640);

  // Age it, or it reads as a UI panel bolted to a wall.
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#6a5636';
  for (let i = 0; i < 120; i++) {
    const r = 8 + Math.random() * 46;
    ctx.beginPath();
    ctx.arc(Math.random() * 900, Math.random() * 640, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = '#6a5a3e';
  ctx.lineWidth = 5;
  ctx.strokeRect(18, 18, 864, 604);

  let y = 92;
  for (const [kind, text] of NOTICE) {
    if (kind === 'gap') { y += 16; continue; }
    if (kind === 'title') {
      ctx.fillStyle = '#2e2415';
      ctx.font = '700 40px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(text, 52, y);
      y += 50;
      ctx.fillStyle = '#6a5a3e';
      ctx.fillRect(52, y - 22, 796, 3);
      y += 22;
    } else if (kind === 'warn') {
      ctx.fillStyle = '#8c2f1c';
      ctx.font = '600 25px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(text, 52, y);
      y += 34;
    } else {
      ctx.fillStyle = '#3a2f1d';
      ctx.font = '300 25px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(text, 52, y);
      y += 32;
    }
  }

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
