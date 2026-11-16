// Works out which social network / source a visitor came from, so one staff link can be shared anywhere.
// Order of trust: explicit channel in the link (/r/006/qr) > utm_source tag > in-app browser signature
// > referrer site > platform click id (fbclid, ttclid, gclid).
import { channels } from './catalog.js';

// Short keys usable in links (/r/<code>/<key>) and in the "via" cookie (ASCII only).
export const channelKeys = {
  zalo: 'Zalo', facebook: 'Facebook', fb: 'Facebook', messenger: 'Messenger', tiktok: 'TikTok',
  instagram: 'Instagram', ig: 'Instagram', threads: 'Threads', youtube: 'YouTube', yt: 'YouTube',
  google: 'Google', qr: 'QR', khac: 'Khác'
};
export const keyOf = name => Object.keys(channelKeys).find(key => channelKeys[key] === name);

const host = referrer => {
  try { return new URL(referrer).hostname.toLowerCase(); } catch { return ''; }
};
const site = (name, domains) => new RegExp(`(^|\\.)(${domains})$`).test(name);

/** In-app browsers identify themselves in the User-Agent; desktop clicks usually carry a referrer. */
export function detectChannel(userAgent = '', referrer = '') {
  const ua = String(userAgent).toLowerCase();
  const from = host(referrer);
  if (/zalo/.test(ua) || site(from, 'zalo\\.me|zalo\\.vn|zaloapp\\.com')) return 'Zalo';
  if (/fb_iab\/messenger|messengerforios|messenger/.test(ua) || site(from, 'messenger\\.com')) return 'Messenger';
  // Threads' in-app browser is Instagram's, tagged with its codename "Barcelona", so it must be checked first.
  // Android apps send referrers like android-app://com.instagram.barcelona, so app ids are matched as hosts too.
  if (/barcelona/.test(ua) || site(from, 'threads\\.net|threads\\.com|com\\.instagram\\.barcelona')) return 'Threads';
  if (/instagram/.test(ua) || site(from, 'instagram\\.com|com\\.instagram\\.android')) return 'Instagram';
  if (/fban|fbav|fb_iab|fbios/.test(ua) || site(from, 'facebook\\.com|fb\\.com|fb\\.me|com\\.facebook\\.katana|com\\.facebook\\.lite')) return 'Facebook';
  if (/musical_ly|bytedancewebview|tiktok|trill_/.test(ua) || site(from, 'tiktok\\.com|com\\.zhiliaoapp\\.musically|com\\.ss\\.android\\.ugc\\.trill')) return 'TikTok';
  // YouTube opens links in the system browser, so only the referrer (website or Android app id) reveals it.
  if (site(from, 'youtube\\.com|youtu\\.be|com\\.google\\.android\\.youtube')) return 'YouTube';
  if (/\bgsa\//.test(ua) || /^(www\.)?google\.[a-z.]+$/.test(from) || from === 'com.google.android.googlequicksearchbox') return 'Google';
  return null;
}

// utm_source values seen in the wild (and typed by staff) for each network.
const sourceAliases = {
  Facebook: /^(facebook|fb|facebook\.com|m\.facebook\.com|l\.facebook\.com|meta)$/,
  Messenger: /^(messenger|fb_messenger|fbmessenger)$/,
  Instagram: /^(instagram|ig|instagram\.com|l\.instagram\.com)$/,
  Threads: /^(threads|threads\.net|threads\.com)$/,
  TikTok: /^(tiktok|tt|tiktok\.com)$/,
  YouTube: /^(youtube|yt|youtube\.com|youtu\.be)$/,
  Zalo: /^(zalo|zalo\.me)$/,
  Google: /^(google|gg|google\.com)$/
};

/** A deliberate tag on the link itself: ?utm_source=tiktok, or the zarsrc marker Zalo adds to links it opens. */
export function taggedChannel(params) {
  const source = String(params.get('utm_source') || '').trim().toLowerCase();
  const tagged = source && Object.keys(sourceAliases).find(name => sourceAliases[name].test(source));
  return tagged || (params.has('zarsrc') ? 'Zalo' : null);
}

/**
 * Click ids that ad/social platforms append to outbound links. They survive "open in browser",
 * so they still identify the network when the in-app browser signature is gone.
 * Meta adds fbclid for Facebook, Instagram and Threads alike, so it is only a fallback after detectChannel.
 */
export function clickIdChannel(params) {
  if (params.has('ttclid')) return 'TikTok';
  if (params.has('gclid') || params.has('gbraid') || params.has('wbraid')) return 'Google';
  if (params.has('fbclid')) return 'Facebook';
  return null;
}

/** Channel recorded for a visit/lead. `link` is the resolved staff link (or undefined). */
export function resolveChannel({ link, viaKey, userAgent, referrer }) {
  const detected = detectChannel(userAgent, referrer);
  if (!link) return detected || 'Trực tiếp';
  const via = channelKeys[viaKey];
  const legacy = channels.includes(link.channel) ? link.channel : null;
  return via || detected || legacy || 'Khác';
}
