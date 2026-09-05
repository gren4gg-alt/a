import { settings, QUALITY, BINDABLE, keyLabel } from './settings.js';

// ---------------------------------------------------------------------------
// Settings UI.
//
// Kept out of main.js because it is all DOM plumbing and none of it is game
// logic. Every control writes straight through to the store and fires the
// change listener, so there is no apply button and nothing to forget to save.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

export function buildSettingsUI({ onChange, onTest }) {
  const tabs = [...document.querySelectorAll('#settings-tabs [data-tab]')];
  const panels = {
    audio: $('tab-audio'), controls: $('tab-controls'), graphics: $('tab-graphics'),
  };

  function openTab(name) {
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === name);
    for (const [k, p] of Object.entries(panels)) p.classList.toggle('hidden', k !== name);
  }
  for (const t of tabs) t.addEventListener('click', () => openTab(t.dataset.tab));

  // -- audio ---------------------------------------------------------------

  const sliders = [
    ['vol-master', 'volume', 'master', 'Everything'],
    ['vol-sfx', 'volume', 'sfx', 'Sound effects'],
    ['vol-ambience', 'volume', 'ambience', 'The drone it makes'],
    ['vol-voice', 'volume', 'voice', 'Other people'],
  ];
  for (const [id, group, key] of sliders) {
    const input = $(id);
    const out = $(`${id}-value`);
    input.value = String(Math.round(settings.data[group][key] * 100));
    out.textContent = `${input.value}%`;
    input.addEventListener('input', () => {
      settings.data[group][key] = Number(input.value) / 100;
      out.textContent = `${input.value}%`;
      settings.save();
      onChange?.();
    });
    input.addEventListener('change', () => onTest?.(key));
  }

  const micGain = $('mic-gain');
  const micGainOut = $('mic-gain-value');
  micGain.value = String(Math.round(settings.data.voice.inputGain * 100));
  micGainOut.textContent = `${micGain.value}%`;
  micGain.addEventListener('input', () => {
    settings.data.voice.inputGain = Number(micGain.value) / 100;
    micGainOut.textContent = `${micGain.value}%`;
    settings.save();
    onChange?.();
  });

  const ptt = $('ptt');
  ptt.checked = settings.data.voice.pushToTalk;
  ptt.addEventListener('change', () => {
    settings.data.voice.pushToTalk = ptt.checked;
    settings.save();
    onChange?.();
  });

  // -- controls ------------------------------------------------------------

  const list = $('bind-list');
  let capturing = null;

  function renderBinds() {
    list.innerHTML = '';
    for (const b of BINDABLE) {
      const row = document.createElement('div');
      row.className = 'bind-row';

      const label = document.createElement('span');
      label.textContent = b.label;

      const btn = document.createElement('button');
      btn.className = 'btn bind-key';
      const code = settings.data.binds[b.id];
      btn.textContent = capturing === b.id ? 'press a key…' : keyLabel(code);
      btn.classList.toggle('capturing', capturing === b.id);
      btn.classList.toggle('unbound', !code);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        capturing = capturing === b.id ? null : b.id;
        renderBinds();
      });

      row.append(label, btn);
      list.appendChild(row);
    }
  }

  // Capture at the window level in the capture phase so a bound key cannot be
  // swallowed by whatever element happens to have focus.
  window.addEventListener('keydown', (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') settings.bind(capturing, e.code);
    capturing = null;
    renderBinds();
    onChange?.();
  }, true);

  window.addEventListener('mousedown', (e) => {
    if (!capturing) return;
    // Left click is how you dismiss the capture; anything else is bindable.
    if (e.button === 0) { capturing = null; renderBinds(); return; }
    e.preventDefault();
    settings.bind(capturing, `Mouse${e.button}`);
    capturing = null;
    renderBinds();
    onChange?.();
  }, true);

  const sens = $('sensitivity');
  const sensOut = $('sensitivity-value');
  sens.value = String(Math.round(settings.data.input.sensitivity * 10));
  sensOut.textContent = (settings.data.input.sensitivity).toFixed(1);
  sens.addEventListener('input', () => {
    settings.data.input.sensitivity = Number(sens.value) / 10;
    sensOut.textContent = settings.data.input.sensitivity.toFixed(1);
    settings.save();
  });

  const invert = $('invert-y');
  invert.checked = settings.data.input.invertY;
  invert.addEventListener('change', () => {
    settings.data.input.invertY = invert.checked;
    settings.save();
  });

  const crouchToggle = $('crouch-toggle');
  crouchToggle.checked = settings.data.input.crouchToggle;
  crouchToggle.addEventListener('change', () => {
    settings.data.input.crouchToggle = crouchToggle.checked;
    settings.save();
    onChange?.();
  });

  $('reset-binds').addEventListener('click', () => {
    for (const b of BINDABLE) settings.data.binds[b.id] = b.def;
    settings.save();
    renderBinds();
    onChange?.();
  });

  // -- graphics ------------------------------------------------------------

  const qList = $('quality-list');
  function renderQuality() {
    qList.innerHTML = '';
    for (const [id, q] of Object.entries(QUALITY)) {
      const card = document.createElement('button');
      card.className = 'card' + (settings.data.graphics.quality === id ? ' selected' : '');
      const n = document.createElement('span'); n.className = 'card-name'; n.textContent = q.label;
      const bl = document.createElement('span'); bl.className = 'card-blurb'; bl.textContent = q.note;
      const meta = document.createElement('span'); meta.className = 'card-meta';
      meta.textContent = `${q.drawDistance} m sight · ${q.aa ? 'smoothed edges' : 'no edge smoothing'}`;
      card.append(n, bl, meta);
      card.addEventListener('click', () => {
        settings.data.graphics.quality = id;
        settings.save();
        renderQuality();
        onChange?.();
      });
      qList.appendChild(card);
    }
  }

  const fov = $('fov');
  const fovOut = $('fov-value');
  fov.value = String(settings.data.graphics.fov);
  fovOut.textContent = `${fov.value}°`;
  fov.addEventListener('input', () => {
    settings.data.graphics.fov = Number(fov.value);
    fovOut.textContent = `${fov.value}°`;
    settings.save();
    onChange?.();
  });

  $('reset-all').addEventListener('click', () => {
    settings.reset();
    refresh();
    onChange?.();
  });

  function refresh() {
    for (const [id, group, key] of sliders) {
      $(id).value = String(Math.round(settings.data[group][key] * 100));
      $(`${id}-value`).textContent = `${$(id).value}%`;
    }
    ptt.checked = settings.data.voice.pushToTalk;
    micGain.value = String(Math.round(settings.data.voice.inputGain * 100));
    micGainOut.textContent = `${micGain.value}%`;
    sens.value = String(Math.round(settings.data.input.sensitivity * 10));
    sensOut.textContent = settings.data.input.sensitivity.toFixed(1);
    invert.checked = settings.data.input.invertY;
    crouchToggle.checked = settings.data.input.crouchToggle;
    fov.value = String(settings.data.graphics.fov);
    fovOut.textContent = `${fov.value}°`;
    renderBinds();
    renderQuality();
  }

  refresh();
  return { openTab, refresh };
}
