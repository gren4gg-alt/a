// ---------------------------------------------------------------------------
// Rewarded ads.
//
// READ THIS BEFORE PICKING A PROVIDER. The two networks you named are not
// equivalent, and only one of them can actually do what this feature needs.
//
// What "watch an ad to be revived" requires is a *verified completion signal*:
// the network must tell your page that the user genuinely watched the whole
// thing. Without it, anyone can grant themselves the reward from the console.
//
//   ADSENSE — can do this. Google's rewarded format for web games is the
//   Ad Placement API (adBreak / adConfig), part of H5 Games Ads. It fires
//   adViewed only on a genuine completed view. Requirements:
//     * an approved AdSense account
//     * your site enrolled in H5 Games Ads (a separate application, and Google
//       does reject sites; it is not automatic with an AdSense account)
//     * the site served over HTTPS on a real domain, not localhost
//   Set provider to 'adsense' and fill in your publisher id below.
//
//   ADSTERRA — cannot do this properly. Adsterra's web inventory is Popunder,
//   Social Bar, Native Banners and Direct Link. None of them return a
//   completion callback. The usual workaround — open a Direct Link in a new
//   tab, start a timer, grant the reward when it expires — rewards closing the
//   tab immediately just as readily as watching, and pushing users to click
//   ads for an in-game reward breaks most networks' terms including theirs.
//   The 'adsterra' provider below implements that timer approach because you
//   asked for it, and it is marked unverified everywhere it is used. Do not
//   ship it as your only earning route.
//
// 'test' is the default: a real countdown with no network, so the whole flow —
// buttons, rewards, the group revive vote — is playable right now.
// ---------------------------------------------------------------------------

export const AD_CONFIG = {
  /** 'test' | 'adsense' | 'adsterra' */
  provider: 'test',

  // --- AdSense (H5 Games Ads) ---
  adsense: {
    client: 'ca-pub-0000000000000000',   // your publisher id
    frequencyHint: '30s',
  },

  // --- Adsterra (unverified; see the warning above) ---
  adsterra: {
    directLink: '',        // your Direct Link URL
    holdSeconds: 20,       // how long the tab must stay open before rewarding
  },

  // --- Economy ---
  /** Shards paid for one completed ad in the menu. */
  menuReward: 120,
  /** Seconds before another menu ad can be watched. */
  menuCooldown: 90,
  /** Ad revives a downed player may buy per run. */
  selfRevivesPerRun: 3,
  /** Seconds of immunity after any ad revive. */
  immunitySeconds: 3,
  /** How long the group has to decide when everyone is down. */
  voteSeconds: 30,
};
