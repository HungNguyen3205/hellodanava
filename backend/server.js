import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { channelKeys, keyOf, detectChannel, resolveChannel, taggedChannel, clickIdChannel } from './channel.js';
import { db, bootstrap, catalog, hashPassword, matches } from './db.js';
import { apps, channels, models, quote, states, terms, ANY_CHANNEL } from './catalog.js';
import { attribution, events, leadStatuses, report } from './analytics.js';

const dev = process.argv.includes('--dev');
bootstrap({dev});
const secure = process.env.SECURE_COOKIES === '1';
// Behind one reverse proxy (TRUST_PROXY=1), the proxy appends the real client IP as the LAST
// X-Forwarded-For entry. Earlier entries come from the client and can be forged, so never use them.
const trustProxy = process.env.TRUST_PROXY === '1';
const clientIp = req => {
  const forwarded = trustProxy && req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',').at(-1).trim() || req.socket.remoteAddress : req.socket.remoteAddress;
};
const port = Number(process.env.PORT || 3000);
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const anonymous = randomUUID;
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
  const [key, ...value] = part.trim().split('=');
  return [key, value.join('=')];
}));
const cookie = (key, value, age) =>
  `${key}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers});
  res.end(JSON.stringify(value));
};
function fail(status, message) {
  throw Object.assign(new Error(message), {status});
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Yêu cầu JSON.');
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 262144) fail(413, 'Dữ liệu quá lớn.');
    parts.push(part);
  }
  try {
    const data = JSON.parse(Buffer.concat(parts));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data;
  } catch { fail(400, 'Dữ liệu không hợp lệ.'); }
}
const session = db.prepare(`
  SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.token=? AND s.expires>? AND u.active=1
`);
const attempts = new Map();
function limit(key, max, duration) {
  const now = Date.now();
  if (attempts.size > 10000) {
    for (const [id, entry] of attempts) if (entry.end <= now) attempts.delete(id);
    if (attempts.size > 10000 && !attempts.has(key)) fail(429, 'Vui lòng thử lại sau.');
  }
  const entry = attempts.get(key) || {};
  if (!entry.end || entry.end <= now) {
    entry.end = now + duration;
    entry.count = 0;
  }
  entry.count++;
  attempts.set(key, entry);
  if (entry.count > max) fail(429, 'Vui lòng thử lại sau.');
}
const requireText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const amount = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 10000000000);
function cleanDraft(data) {
  const previous = catalog('draft');
  if (!Array.isArray(data.plans) || !Array.isArray(data.modules) || data.modules.length > 200 ||
      data.plans.length !== previous.plans.length) fail(400, 'Cấu hình gói không hợp lệ.');
  const plans = previous.plans.map(old => {
    const p = data.plans.find(p => p?.id === old.id);
    if (!p || !requireText(p.name,60) || !requireText(p.description,300) ||
      !['members','staff','branches'].every(key => requireText(p[key],50)) ||
      !terms.every(term => amount(p.prices?.[term]))) fail(400, 'Kiểm tra tên, hạn mức và giá từng kỳ hạn.');
    const {id,name,description,members,staff,branches,prices,featured} = p;
    return {id,name,description,members,staff,branches,featured: featured === true,
      prices: Object.fromEntries(terms.map(term => [term,prices[term]]))};
  });
  if (plans.filter(p => p.featured).length > 1) fail(400, 'Chọn tối đa một gói nổi bật.');
  const ids = new Set();
  const modules = data.modules.map(m => {
    if (!m || !/^[a-z0-9-]{1,60}$/.test(m.id) || ids.has(m.id) ||
        !requireText(m.name,100) || typeof m.description !== 'string' || m.description.length > 300 ||
        !apps.includes(m.app) || !amount(m.price) || !['once','month'].includes(m.unit) ||
        !plans.every(p => states.includes(m.plans?.[p.id]))) fail(400, 'Kiểm tra dữ liệu từng module.');
    ids.add(m.id);
    return {id:m.id,name:m.name,description:m.description,app:m.app,price:m.price,unit:m.unit,
      plans:Object.fromEntries(plans.map(p => [p.id,m.plans[p.id]]))};
  });
  return {plans, modules};
}
const assets = {
  '/': ['index.html','text/html'], '/admin': ['admin.html','text/html'],
  '/app.js': ['app.js','text/javascript'], '/admin.js': ['admin.js','text/javascript'],
  '/ui.js': ['ui.js','text/javascript'], '/style.css': ['style.css','text/css'],
  '/scene.js': ['scene.js','text/javascript'], '/vendor/three.module.min.js': ['vendor/three.module.min.js','text/javascript'],
  '/logo.png': ['logo.png','image/png'], '/mark.png': ['mark.png','image/png'],
  '/fonts/UTM-Eremitage.ttf': ['fonts/UTM-Eremitage.ttf','font/ttf']
};
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    // HEAD is answered like GET (Node drops the body); uptime monitors and link previews use it.
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const ip = clientIp(req);
    const jar = cookies(req);
    const user = jar.session && session.get(tokenHash(jar.session), Date.now());
    const visitor = /^[a-f0-9-]{36}$/.test(jar.visitor || '') ? jar.visitor : anonymous();
    const visitorHeader = jar.visitor === visitor ? {} : {'Set-Cookie': cookie('visitor', visitor, 7776000)};
    if (method === 'GET' && Object.hasOwn(assets,path)) {
      const [file, type] = assets[path];
      const content = await readFile(new URL('../frontend/' + file, import.meta.url)).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!content) { res.writeHead(404, {'Cache-Control':'no-store'}); return res.end(); }
      res.writeHead(200, {'Content-Type': /^(image|font)\//.test(type) ? type : type+'; charset=utf-8', 'Cache-Control':'no-cache', ...visitorHeader});
      return res.end(content);
    }
    const short = method === 'GET' && /^\/r\/([a-z0-9-]+)(?:\/([a-z]+))?\/?$/.exec(path.toLowerCase());
    if (short) {
      const link = attribution(short[1]);
      const via = channelKeys[short[2]] ? short[2]
        : keyOf(taggedChannel(url.searchParams) || detectChannel(req.headers['user-agent'], req.headers.referer)
          || clickIdChannel(url.searchParams));
      const headers = {Location: link ? '/?ref='+encodeURIComponent(link.slug || link.code) : '/', 'Cache-Control':'no-store'};
      if (link) headers['Set-Cookie'] = via ? cookie('via', via, 86400) : cookie('via', '', 0);
      res.writeHead(302, headers);
      return res.end();
    }
    if (method === 'GET' && path === '/api/catalog')
      return json(res,200,{...catalog('published'), models, apps, terms});
    if (method === 'POST' && path === '/api/events') {
      const data = await body(req);
      const maxEvents = 600;
      limit('events:'+ip,maxEvents,60000);
      if (!/bot|crawl|preview|facebookexternalhit|crawling/i.test(req.headers['user-agent'] || '') &&
          ['view','interaction'].includes(data.kind)) {
        const link = attribution(data.ref);
        const plan = catalog('published').plans.some(p => p.id === data.plan) ? data.plan : null;
        const channel = resolveChannel({link, viaKey: jar.via, userAgent: req.headers['user-agent'],
          referrer: typeof data.referrer === 'string' ? data.referrer.slice(0,500) : ''});
        events.run(data.kind,visitor,link?.code ?? null,channel,plan,Date.now());
      }
      return json(res,200,{},visitorHeader);
    }
    if (method === 'POST' && path === '/api/leads') {
      const data = await body(req);
      limit('lead:'+ip,50,60000);
      if (!/^[a-f0-9-]{36}$/.test(data.id || '') || !requireText(data.name,100) || !requireText(data.business,150) ||
          typeof data.phone !== 'string' || !/^\+?[\d .()-]{8,22}$/.test(data.phone) ||
          data.phone.replace(/\D/g,'').length < 8 || !models.includes(data.model) || data.website)
        fail(400,'Vui lòng kiểm tra tên, phòng tập, số điện thoại và mô hình.');
      const id = transaction(() => {
        if (db.prepare('SELECT 1 FROM leads WHERE id=?').get(data.id)) return data.id;
        const current = catalog('published');
        if (data.version !== current.version) fail(409,'Bảng giá vừa cập nhật. Vui lòng tải lại trang.');
        const result = quote(current,data);
        if (!result) fail(400,'Gói hoặc tính năng bổ sung không hợp lệ.');
        const link = attribution(data.ref);
        const code = link?.code ?? null;
        const channel = resolveChannel({link, viaKey: jar.via, userAgent: req.headers['user-agent'],
          referrer: typeof data.referrer === 'string' ? data.referrer.slice(0,500) : ''});
        const time = Date.now();
        db.prepare('INSERT INTO leads(id,name,business,phone,model,code,channel,quote,version,created) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(data.id,data.name.trim(),data.business.trim(),data.phone.trim(),data.model,code,channel,JSON.stringify(result),current.version,time);
        events.run('lead',visitor,code,channel,data.plan,time);
        return data.id;
      });
      return json(res,201,{id},visitorHeader);
    }
    if (method === 'POST' && path === '/api/login') {
      const data = await body(req);
      const email = typeof data.email === 'string' ? data.email.toLowerCase().trim().slice(0,160) : '';
      limit('login-ip:'+ip,100,900000);
      limit('login-email:'+email,12,900000);
      const record = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
      if (!record || typeof data.password !== 'string' || data.password.length > 128 ||
          !matches(data.password,record.password)) fail(401,'Email hoặc mật khẩu không đúng.');
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),record.id,Date.now()+28800000);
      attempts.delete('login-email:'+email);
      return json(res,200,{}, {'Set-Cookie':cookie('session',token,28800)});
    }
    if (!path.startsWith('/api/admin/')) fail(404,'Không tìm thấy trang.');
    if (!user) fail(401,'Vui lòng đăng nhập.');
    if (method === 'POST' && path === '/api/admin/logout') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(jar.session));
      return json(res,200,{}, {'Set-Cookie':cookie('session','',0)});
    }
    const isAdmin = user.role === 'admin';
    if (method === 'GET' && path === '/api/admin/me') return json(res,200,user);
    if (method === 'POST' && path === '/api/admin/password') {
      const data = await body(req);
      limit('password:'+user.id,10,900000);
      const current = db.prepare('SELECT password FROM users WHERE id=?').get(user.id);
      if (typeof data.current !== 'string' || data.current.length > 128 || !matches(data.current,current.password) ||
          typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128)
        fail(400,'Kiểm tra mật khẩu hiện tại. Mật khẩu mới cần 12–128 ký tự.');
      transaction(() => {
        db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(data.password),user.id);
        db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id,tokenHash(jar.session));
      });
      return json(res,200,{});
    }
    if (method === 'GET' && path === '/api/admin/reports') return json(res,200,report(url.searchParams,user));
    if (method === 'GET' && path === '/api/admin/links') {
      const scope = isAdmin ? null : user.id;
      const staff = db.prepare('SELECT id,name,email,active FROM users WHERE (? IS NULL OR id=?) ORDER BY name').all(scope,scope);
      const links = db.prepare('SELECT * FROM links WHERE (? IS NULL OR user_id=?) ORDER BY channel').all(scope,scope);
      return json(res,200,{staff, links, channels});
    }
    if (method === 'POST' && path === '/api/admin/link-action') {
      const data = await body(req);
      const link = typeof data.code === 'string' ? db.prepare('SELECT * FROM links WHERE code=? AND active=1').get(data.code) : null;
      if (!link || (!isAdmin && link.user_id !== user.id)) fail(404,'Không tìm thấy link.');
      if (!['copy','share'].includes(data.kind)) fail(400,'Thao tác không hợp lệ.');
      events.run(data.kind,null,link.code,link.channel,null,Date.now());
      return json(res,200,{});
    }
    if (method === 'POST' && path === '/api/admin/link-slug') {
      const data = await body(req);
      limit('slug:'+user.id,30,60000);
      const link = typeof data.code === 'string' ? db.prepare('SELECT * FROM links WHERE code=?').get(data.code) : null;
      if (!link || (!isAdmin && link.user_id !== user.id)) fail(404,'Không tìm thấy link.');
      const slug = typeof data.slug === 'string' ? data.slug.trim().toLowerCase() : '';
      if (slug && (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) || /^[a-f0-9]{12}$/.test(slug)))
        fail(400,'Mã link chỉ gồm chữ thường không dấu, số và dấu gạch ngang (1–40 ký tự).');
      transaction(() => {
        if (slug && db.prepare('SELECT 1 FROM links WHERE (slug=? OR code=?) AND code<>?').get(slug,slug,link.code))
          fail(409,'Mã "'+slug+'" đã có người dùng. Chọn mã khác.');
        db.prepare('UPDATE links SET slug=? WHERE code=?').run(slug || null, link.code);
      });
      return json(res,200,{code:link.code, slug:slug || null});
    }
    if (method === 'GET' && path === '/api/admin/leads') {
      const scope = isAdmin ? null : user.id;
      const page = Math.min(100000,Math.max(1, parseInt(url.searchParams.get('page'),10) || 1));
      const employee = isAdmin ? Number(url.searchParams.get('employee')) || null : user.id;
      const channel = [...channels, 'Trực tiếp'].includes(url.searchParams.get('channel')) ? url.searchParams.get('channel') : null;
      const rows = db.prepare(`SELECT a.*,u.name AS employee,COALESCE(l.slug,l.code) AS link FROM leads a LEFT JOIN links l ON l.code=a.code
        LEFT JOIN users u ON l.user_id=u.id WHERE (? IS NULL OR l.user_id=?) AND (? IS NULL OR a.channel=?)
        ORDER BY a.created DESC,a.id DESC LIMIT 51 OFFSET ?`)
        .all(employee,employee,channel,channel,(page-1)*50);
      return json(res,200,{items:rows.slice(0,50).map(row=>({...row,quote:JSON.parse(row.quote)})), hasNext:rows.length>50,statuses:leadStatuses});
    }
    if (method === 'PATCH' && path === '/api/admin/leads') {
      const data = await body(req);
      const scope = isAdmin ? null : user.id;
      if (!leadStatuses.includes(data.status) || typeof data.id !== 'string') fail(400,'Trạng thái không hợp lệ.');
      const result = db.prepare('UPDATE leads SET status=? WHERE id=? AND (? IS NULL OR code IN (SELECT code FROM links WHERE user_id=?))')
        .run(data.status,data.id,scope,scope);
      if (!result.changes) fail(404,'Không tìm thấy yêu cầu.');
      return json(res,200,{});
    }
    if (!isAdmin) fail(403,'Cần quyền quản trị.');
    if (method === 'POST' && path === '/api/admin/users') {
      const data = await body(req);
      if (!requireText(data.name,100) || !requireText(data.email,160) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ||
          typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128)
        fail(400,'Kiểm tra tên, email và mật khẩu từ 12–128 ký tự.');
      const result = db.prepare("INSERT OR IGNORE INTO users(name,email,password,role) VALUES(?,?,?,'staff')")
        .run(data.name.trim(),data.email.toLowerCase(),hashPassword(data.password));
      if (!result.changes) fail(409,'Email đã tồn tại.');
      return json(res,201,{});
    }
    if (method === 'PATCH' && path === '/api/admin/users') {
      const data = await body(req);
      if (!Number.isInteger(data.id) || typeof data.active !== 'boolean') fail(400,'Dữ liệu không hợp lệ.');
      transaction(() => {
        const result = db.prepare("UPDATE users SET active=? WHERE id=? AND role='staff'").run(Number(data.active),data.id);
        if (!result.changes) fail(404,'Không tìm thấy nhân viên.');
        if (!data.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(data.id);
      });
      return json(res,200,{});
    }
    if (method === 'POST' && path === '/api/admin/links') {
      const data = await body(req);
      if (data.channel === undefined || data.channel === '') data.channel = ANY_CHANNEL;
      if (![...channels, ANY_CHANNEL].includes(data.channel) || !Number.isInteger(data.employee) ||
          !db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(data.employee))
        fail(400,'Chọn nhân viên đang hoạt động và kênh hợp lệ.');
      const code = randomBytes(6).toString('hex');
      const result = db.prepare('INSERT OR IGNORE INTO links(code,user_id,channel) VALUES(?,?,?)').run(code,data.employee,data.channel);
      if (!result.changes) fail(409, data.channel === ANY_CHANNEL ? 'Nhân viên này đã có link.' : 'Nhân viên đã có link cho kênh này.');
      return json(res,201,{code});
    }
    if (method === 'PATCH' && path === '/api/admin/links') {
      const data = await body(req);
      if (typeof data.code !== 'string' || typeof data.active !== 'boolean') fail(400,'Dữ liệu không hợp lệ.');
      const result = db.prepare('UPDATE links SET active=? WHERE code=?').run(Number(data.active),data.code);
      if (!result.changes) fail(404,'Không tìm thấy link.');
      return json(res,200,{});
    }
    if (method === 'GET' && path === '/api/admin/catalog') return json(res,200,catalog('draft'));
    if (method === 'PUT' && path === '/api/admin/catalog') {
      const data = await body(req);
      const cleaned = cleanDraft(data);
      const result = db.prepare("UPDATE catalogs SET data=?,version=version+1 WHERE id='draft' AND version=?")
        .run(JSON.stringify(cleaned),Number(data.version)||0);
      if (!result.changes) fail(409,'Bản nháp đã thay đổi. Tải lại để xem bản mới.');
      return json(res,200,catalog('draft'));
    }
    if (method === 'POST' && path === '/api/admin/publish') {
      const data = await body(req);
      transaction(() => {
        const draft = catalog('draft');
        if (data.version !== draft.version) fail(409,'Bản nháp đã thay đổi. Vui lòng tải lại.');
        db.prepare("UPDATE catalogs SET data=(SELECT data FROM catalogs WHERE id='draft'),version=version+1 WHERE id='published'").run();
      });
      return json(res,200,{});
    }
    fail(404,'Không tìm thấy chức năng.');
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) json(res,error.status || 500,{error:error.status ? error.message : 'Có lỗi hệ thống. Vui lòng thử lại.'});
  }
});
server.listen(port, process.env.HOST || (dev ? '127.0.0.1' : '0.0.0.0'), () => console.log('Hello DANAVA · cổng '+port));
