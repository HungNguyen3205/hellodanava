import { db } from './db.js';
import { channels } from './catalog.js';

export const events = db.prepare(
  'INSERT INTO events(kind,visitor,code,channel,plan,created) VALUES(?,?,?,?,?,?)'
);
export const leadStatuses = ['Mới', 'Đang tư vấn', 'Đã chốt', 'Đã đóng'];

export function attribution(code) {
  return typeof code === 'string'
    ? db.prepare('SELECT l.code,l.slug,l.channel FROM links l JOIN users u ON u.id=l.user_id WHERE (l.code=? OR l.slug=?) AND l.active=1 AND u.active=1').get(code, code)
    : undefined;
}

export function report(query, user) {
  const days = [7, 30, 90].includes(Number(query.get('days'))) ? Number(query.get('days')) : 30;
  const employee = user.role === 'admin' ? Number(query.get('employee')) || null : user.id;
  const channel = [...channels, 'Trực tiếp'].includes(query.get('channel')) ? query.get('channel') : null;
  const plan = query.get('plan') || null;
  const offset = 7 * 3600000;
  const end = Math.floor((Date.now() + offset) / 86400000) * 86400000 - offset;
  const start = end - (days - 1) * 86400000;
  const rows = db.prepare(`
    SELECT e.*, l.user_id FROM events e LEFT JOIN links l ON l.code=e.code
    WHERE e.created>=? AND e.created<? AND (? IS NULL OR l.user_id=?) AND (? IS NULL OR e.channel=?) AND (
      ? IS NULL OR e.plan=? OR (e.kind='view' AND EXISTS (
        SELECT 1 FROM events interest WHERE interest.created>=? AND interest.visitor=e.visitor
        AND interest.code IS e.code AND interest.plan=? AND interest.kind IN ('interaction','lead')
      ))
    )
  `).all(start,end+86400000,employee,employee,channel,channel,plan,plan,start,plan);
  const kinds = {view: 0, interaction: 0, lead: 0, copy: 0, share: 0};
  const visitors = new Set();
  const engaged = new Set();
  const converted = new Set();
  const sources = new Map();
  const staff = new Map();
  const matrix = new Map();
  const daily = Array.from({length: days}, (_, i) => ({
    date: new Date(start + i*86400000 + offset).toISOString().slice(0,10), views: 0, leads: 0
  }));
  for (const row of rows) {
    kinds[row.kind]++;
    const source = sources.get(row.channel) || {channel: row.channel, views: 0, leads: 0};
    const member = staff.get(row.user_id) || {id: row.user_id, views: 0, leads: 0, copies: 0, shares: 0};
    const day = daily[Math.floor((row.created - start)/86400000)];
    if (row.kind === 'view') {
      visitors.add(row.visitor);
      source.views++;
      member.views++;
      day.views++;
    }
    if (row.kind === 'interaction') engaged.add(row.visitor);
    if (row.kind === 'lead') {
      converted.add(row.visitor);
      source.leads++;
      member.leads++;
      day.leads++;
    }
    if (row.user_id !== null && (row.kind === 'view' || row.kind === 'lead')) {
      const cells = matrix.get(row.user_id) || {};
      const cell = cells[row.channel] || (cells[row.channel] = {views: 0, leads: 0});
      cell[row.kind === 'view' ? 'views' : 'leads']++;
      matrix.set(row.user_id, cells);
    }
    if (row.kind === 'copy') member.copies++;
    if (row.kind === 'share') member.shares++;
    sources.set(row.channel, source);
    staff.set(row.user_id, member);
  }
  return {kinds, visitors: visitors.size, engaged: engaged.size,
    conversion: visitors.size ? [...converted].filter(id => visitors.has(id)).length / visitors.size : 0,
    daily, sources: [...sources.values()].sort((a,b) => b.views-a.views || b.leads-a.leads),
    staff: [...staff.values()].filter(row => row.id !== null).sort((a,b) => b.leads-a.leads || b.views-a.views),
    staffChannels: [...matrix].map(([id, cells]) => ({id, channels: cells}))};
}
