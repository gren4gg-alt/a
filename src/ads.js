import { AD_CONFIG } from './adsconfig.js';

// ---------------------------------------------------------------------------
// One interface, three backends.
//
// showRewarded() always resolves, never rejects, with one of:
//   'viewed'      — genuinely watched to the end; pay out
//   'dismissed'   — skipped or closed early; pay nothing
//   'unavailable' — no fill, blocked, or not configured; pay nothing, and say
//                   so rather than pretending an ad played
//
// Callers must treat 'unavailable' as its own case. An ad blocker is the normal
// state for a large share of players, and a game that silently does nothing
// when the button is pressed looks broken.
// ---------------------------------------------------------------------------

let scriptState = 'idle';   // idle | loading | ready | failed
let lastMenuAd = 0;

export const adsEnabled = () => AD_CONFIG.provider !== 'off';

export function menuCooldownLeft() {
  const left = AD_CONFIG.menuCooldown - (Date.now() - lastMenuAd) / 1000;
  return Math.max(0, Math.ceil(left));
}

export function markMenuAdWatched() { lastMenuAd = Date.now(); }

// ---------------------------------------------------------------------------

function loadAdSense() {
  if (scriptState !== 'idle') return scriptState;
  scriptState = 'loading';
  const { client, frequencyHint } = AD_CONFIG.adsense;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.dataset.adFrequencyHint = frequencyHint;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  s.onload = () => {
    scriptState = 'ready';
    try {
      window.adConfig?.({ preloadAdBreaks: 'on', sound: 'on' });
    } catch { /* the shim below covers it */ }
  };
  // The overwhelmingly common failure is an ad blocker, not a bad id.
  s.onerror = () => { scriptState = 'failed'; };
  document.head.appendChild(s);

  // Google's own recommended shims, so calls made before the script lands are
  // queued rather than thrown away.
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adBreak || ((o) => { window.adsbygoogle.push(o); });
  window.adConfig = window.adConfig || ((o) => { window.adsbygoogle.push(o); });
  return scriptState;
}

export function initAds() {
  if (AD_CONFIG.provider === 'adsense') loadAdSense();
}

function adsenseRewarded(name) {
  return new Promise((resolve) => {
    if (scriptState === 'failed') { resolve('unavailable'); return; }
    loadAdSense();

    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    // If nothing has happened in fifteen seconds there is no fill, or the
    // script never arrived. Resolving beats leaving the player on a dead modal.
    const timer = setTimeout(() => done('unavailable'), 15000);

    try {
      window.adBreak({
        type: 'reward',
        name,
        beforeReward: (showAdFn) => { clearTimeout(timer); showAdFn(); },
        adViewed: () => { clearTimeout(timer); done('viewed'); },
        adDismissed: () => { clearTimeout(timer); done('dismissed'); },
        adBreakDone: (info) => {
          clearTimeout(timer);
          // Reached without beforeReward firing means there was no ad to show.
          done(info?.breakStatus === 'viewed' ? 'viewed' : 'unavailable');
        },
      });
    } catch {
      clearTimeout(timer);
      done('unavailable');
    }
  });
}

/**
 * Adsterra. There is no completion callback, so this opens the link and waits.
 * It is unverifiable by construction and is labelled as such in the UI.
 */
function adsterraRewarded(onTick) {
  const { directLink, holdSeconds } = AD_CONFIG.adsterra;
  if (!directLink) return Promise.resolve('unavailable');

  const win = window.open(directLink, '_blank', 'noopener');
  if (!win) return Promise.resolve('unavailable');   // popup blocked

  return new Promise((resolve) => {
    let left = holdSeconds;
    onTick?.(left);
    const iv = setInterval(() => {
      left -= 1;
      onTick?.(left);
      if (left <= 0) { clearInterval(iv); resolve('viewed'); }
    }, 1000);
  });
}

/** A real countdown with no network, so the flow is testable today. */
function testRewarded(onTick) {
  return new Promise((resolve) => {
    let left = 5;
    onTick?.(left);
    const iv = setInterval(() => {
      left -= 1;
      onTick?.(left);
      if (left <= 0) { clearInterval(iv); resolve('viewed'); }
    }, 1000);
  });
}

/**
 * @param {string} name a placement name, for the network's reporting
 * @param {(secondsLeft:number)=>void} [onTick] progress, where the backend has any
 * @returns {Promise<'viewed'|'dismissed'|'unavailable'>}
 */
export function showRewarded(name, onTick) {
  switch (AD_CONFIG.provider) {
    case 'adsense': return adsenseRewarded(name);
    case 'adsterra': return adsterraRewarded(onTick);
    case 'test': return testRewarded(onTick);
    default: return Promise.resolve('unavailable');
  }
}

export const providerIsVerified = () => AD_CONFIG.provider === 'adsense';
export const providerName = () => AD_CONFIG.provider;
