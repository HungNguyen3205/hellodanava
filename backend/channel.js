// Works out which social network / source a visitor came from, so one staff link can be shared anywhere.
// Order of trust: explicit channel in the link (/r/006/qr) > in-app browser signature > referrer site.
import { channels } from './catalog.js';

// Short keys usable in links (/r/<code>/<key>) and in the "via" cookie (ASCII only).
export const channelKeys = {
  zalo: 'Zalo', facebook: 'Facebook', fb: 'Facebook', messenger: 'Messenger', tiktok: 'TikTok',
  instagram: 'Instagram', ig: 'Instagram', google: 'Google', qr: 'QR', khac: 'Khác'
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
  if (/instagram/.test(ua) || site(from, 'instagram\\.com')) return 'Instagram';
  if (/fban|fbav|fb_iab|fbios/.test(ua) || site(from, 'facebook\\.com|fb\\.com|fb\\.me')) return 'Facebook';
  if (/musical_ly|bytedancewebview|tiktok|trill_/.test(ua) || site(from, 'tiktok\\.com')) return 'TikTok';
  if (/^(www\.)?google\.[a-z.]+$/.test(from)) return 'Google';
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
