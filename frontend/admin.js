import {$, api, escape as e, money, option, statusLabels, dateTime} from './ui.js';

let user, tab, staff, links, channels, catalog, published, dirty = false, page = 1, preview = false, appFilter = '';
const appGroups = ['Quản trị Studio','App hội viên','App riêng theo thương hiệu'];
const adminTabs = {report:'Tổng quan',links:'Link nhân viên',leads:'Yêu cầu báo giá',catalog:'Gói & module',account:'Tài khoản'};
// Staff only see the link they share and how far their sharing has got.
const staffTabs = {links:'Link của tôi',report:'Tiến độ chia sẻ',account:'Tài khoản'};
const tabsFor = () => isAdmin() ? adminTabs : staffTabs;
const filters = {days:'30',employee:'',channel:'',plan:''};
const leadFilters = {employee:'',channel:''};
const task = (method,body) => ({method,body});
const content = $('#content');
const isAdmin = () => user?.role === 'admin';
const fields = form => Object.fromEntries(new FormData(form));
const notice = (message, error = false) => {
  $('#message').textContent = message;
  $('#message').hidden = !message;
  $('#message').classList.toggle('error',error);
};
const staffName = id => staff.find(item=>item.id===id)?.name || '—';
const wrapTable = html => '<div class="table-wrap"><table>'+html+'</table></div>';
const head = labels => '<thead><tr>'+labels.map(label=>'<th scope="col">'+e(label)+'</th>').join('')+'</tr></thead>';
const empty = (cols,text) => `<tr><td colspan="${cols}" class="muted">${e(text)}</td></tr>`;
// "Nam Hưng Zalo" -> "nam-hung-zalo"
const toSlug = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40).replace(/-+$/,'');
// Standard share link: hello.danava.vn/?ref=<code>. The old /r/<code> links keep working.
const refPath = item => '/?ref='+encodeURIComponent(item.slug||item.code);
const identity = () => user.name+' · '+(isAdmin()?'Quản trị':'Nhân viên');

async function loadLinks() {
  ({staff, links, channels} = await api('/admin/links'));
}
async function start() {
  try { user = await api('/admin/me'); }
  catch(error) {
    $('#workspace').hidden=true;
    $('#signin').hidden=false;
    if (error.status!==401) notice(error.message,true);
    return;
  }
  $('#signin').hidden=true;
  $('#workspace').hidden=false;
  $('#identity').textContent=identity();
  $('.admin-head h1').textContent=isAdmin()?'Quản trị báo giá':'Link chia sẻ của tôi';
  await navigate(isAdmin()?'report':'links');
}
async function navigate(next) {
  if (dirty && next!==tab && !confirm('Rời trang và bỏ các chỉnh sửa chưa lưu?')) return;
  dirty=false;
  preview=false;
  tab=next;
  notice('');
  if (!tabsFor()[next]) next=tab=Object.keys(tabsFor())[0];
  $('#tabs').innerHTML=Object.entries(tabsFor()).map(([key,label])=>
    `<button type="button" data-tab="${key}" aria-pressed="${key===tab}">${label}</button>`).join('');
  await render();
}
async function render() {
  if (tab==='report') {
    await loadLinks();
    published=await api('/catalog');
    return renderReport();
  }
  if (tab==='links') {
    await loadLinks();
    return isAdmin() ? renderLinks() : renderMyLinks();
  }
  if (tab==='leads') return renderLeads();
  if (tab==='catalog') {
    catalog=await api('/admin/catalog');
    return renderCatalog();
  }
  content.innerHTML=`<form data-form="password" class="panel slim">
    <h2>Đổi mật khẩu</h2><label>Mật khẩu hiện tại<input type="password" name="current" autocomplete="current-password" required maxlength="128"></label>
    <label>Mật khẩu mới<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
    <button class="primary">Đổi mật khẩu</button></form>`;
}
function filter(name, label, options, scope = filters, attr = 'filter') {
  return `<label>${label}<select data-${attr}="${name}">${options.map(([value,title])=>option(value,title,String(value)===scope[name])).join('')}</select></label>`;
}
async function renderReport() {
  const data=await api('/admin/reports?'+new URLSearchParams(filters));
  if (tab!=='report') return;
  const max=Math.max(1,...data.daily.map(day=>Math.max(day.views,day.leads)));
  const sourceTotal=data.sources.reduce((sum,row)=>sum+row.views,0);
  const stats=[
    ['Lượt truy cập',data.kinds.view],['Khách truy cập ước tính',data.visitors],
    ['Khách có tương tác',data.engaged],['Yêu cầu báo giá',data.kinds.lead],
    ['Tỷ lệ chuyển đổi',(data.conversion*100).toLocaleString('vi-VN',{maximumFractionDigits:1})+'%']
  ];
  content.innerHTML=`${isAdmin()?'':'<h2>Tiến độ chia sẻ của bạn</h2><p class="muted">Số liệu từ link của bạn: bao nhiêu người đã mở, đến từ kênh nào và bao nhiêu yêu cầu báo giá.</p>'}<div class="filters">
    ${filter('days','Thời gian',[[7,'7 ngày'],[30,'30 ngày'],[90,'90 ngày']])}
    ${isAdmin()?filter('employee','Nhân viên',[['','Tất cả'],...staff.map(item=>[item.id,item.name])]):''}
    ${filter('channel','Kênh',[['','Tất cả'],...['Trực tiếp',...channels].map(channel=>[channel,channel])])}
    ${filter('plan','Gói',[['','Tất cả'],...published.plans.map(p=>[p.id,p.name])])}
  </div><div class="metrics">${stats.map(([label,value])=>`<div class="panel"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
  <section class="panel chart"><h2>Truy cập & yêu cầu theo ngày</h2>
  <p class="muted">Xanh dương là lượt truy cập. Xanh lá là yêu cầu báo giá. Khi lọc theo gói, lượt truy cập tính theo khách đã tương tác hoặc gửi yêu cầu cho gói đó.</p>
  <div class="chart-bars">${data.daily.map(day=>`<div class="chart-day" title="${day.date} · ${day.views} lượt · ${day.leads} yêu cầu">
    <meter max="${max}" value="${day.views}" aria-label="${day.date}: ${day.views} lượt"></meter><meter class="lead-meter" max="${max}" value="${day.leads}" aria-label="${day.date}: ${day.leads} yêu cầu"></meter></div>`).join('')}</div>
  <div class="section-bar muted"><span>${data.daily[0].date}</span><span>${data.daily.at(-1).date}</span></div></section>
  <div class="report-grid"><section class="panel"><h2>Khách đến từ đâu</h2>
  ${data.sources.length?data.sources.map(row=>`<div class="source"><b>${e(row.channel)}</b><span>${row.views} lượt · ${row.leads} yêu cầu</span>
  <progress max="${sourceTotal||1}" value="${row.views}" aria-label="Lượt truy cập từ ${e(row.channel)}"></progress></div>`).join(''):'<p class="muted">Chưa có dữ liệu trong kỳ.</p>'}</section>
  <section class="panel"><h2>Hoạt động chia sẻ link</h2><dl class="counts"><div><dt>Sao chép link</dt><dd>${data.kinds.copy}</dd></div><div><dt>Bấm chia sẻ</dt><dd>${data.kinds.share}</dd></div></dl>
  <p class="muted">Số thao tác trong admin. Lượt truy cập được ghi nhận khi khách mở trang báo giá.</p></section></div>
  ${isAdmin()?`${channelMatrix(data)}
  <section class="block"><h2>Hiệu quả theo nhân viên</h2>${wrapTable(head(['Nhân viên','Lượt truy cập','Yêu cầu','Sao chép','Bấm chia sẻ'])+
    '<tbody>'+(data.staff.map(row=>`<tr><th scope="row">${e(staffName(row.id))}</th><td>${row.views}</td><td>${row.leads}</td><td>${row.copies}</td><td>${row.shares}</td></tr>`).join('') || empty(5,'Chưa có hoạt động.'))+'</tbody>')}</section>`:''}`;
}
// Staff home: the link(s) they share, ready to copy.
function renderMyLinks() {
  const mine = links.filter(item=>item.user_id===user.id);
  content.innerHTML=`<p class="muted my-link-intro">Gửi link này cho khách qua Zalo, Facebook, Messenger, TikTok, Instagram, Threads, YouTube… Hệ thống tự ghi nhận khách đến từ đâu và tính cho bạn. Xem kết quả ở tab <b>Tiến độ chia sẻ</b>.</p>
  ${mine.length?mine.map(item=>{
    const path=refPath(item);
    return `<section class="panel my-link">
      <span class="eyebrow">${item.channel==='Đa kênh'?'Dùng cho mọi mạng xã hội':'Kênh '+e(item.channel)}</span>
      <a class="my-link-url" href="${e(path)}" target="_blank" rel="noopener">${e(location.host+path)}</a>
      ${item.active?`<div class="actions my-link-actions">
        <button class="primary" data-act="copy" data-code="${e(item.code)}" data-path="${e(path)}">Sao chép link</button>
        <button data-act="copy" data-code="${e(item.code)}" data-path="${e(path)}&utm_source=qr" title="Dùng khi in mã QR, tờ rơi">Link cho mã QR</button>
        ${navigator.share?`<button data-act="share" data-code="${e(item.code)}" data-path="${e(path)}">Chia sẻ</button>`:''}
      </div>`:'<p class="notice error">Link đang tạm tắt. Liên hệ quản trị DANAVA để bật lại.</p>'}
      <form data-form="slug" data-code="${e(item.code)}" class="slug-form"><input name="slug" value="${e(item.slug||'')}" maxlength="40" placeholder="Đặt mã dễ nhớ, VD: 006" aria-label="Mã dễ nhớ cho link của bạn"><button class="small-button">Lưu mã</button></form>
      <small>Mã gồm chữ không dấu, số hoặc dấu gạch, ví dụ <b>006</b>. Đổi mã thì link cũ ngừng được tính, nên đặt một lần rồi giữ cố định.</small>
    </section>`;}).join(''):'<section class="panel"><p class="muted">Bạn chưa được cấp link. Liên hệ quản trị DANAVA để được cấp.</p></section>'}`;
}
// Staff x social network: where each person's customers actually came from.
function channelMatrix(data) {
  const rows = data.staffChannels || [];
  const used = [...channels, 'Khác'].filter((name, i, all) => all.indexOf(name) === i && rows.some(row => row.channels[name]));
  if (!rows.length) return '<section class="block"><h2>Nhân viên theo từng kênh</h2><p class="muted">Chưa có lượt truy cập qua link nhân viên trong kỳ.</p></section>';
  return `<section class="block"><h2>Nhân viên theo từng kênh</h2>
  <p class="muted">Mỗi ô: lượt truy cập và số yêu cầu báo giá đến từ kênh đó. Thanh màu là tỷ lệ của kênh trong tổng lượt của nhân viên.</p>
  ${wrapTable(head(['Nhân viên',...used,'Tổng'])+'<tbody>'+rows.map(row=>{
    const total = Object.values(row.channels).reduce((sum,cell)=>sum+cell.views,0);
    const leads = Object.values(row.channels).reduce((sum,cell)=>sum+cell.leads,0);
    return `<tr><th scope="row">${e(staffName(row.id))}</th>${used.map(name=>{
      const cell = row.channels[name];
      return cell ? `<td class="mx-cell"><b>${cell.views}</b> lượt<small>${cell.leads} yêu cầu</small>
        <progress max="${total||1}" value="${cell.views}" aria-label="${e(name)}: ${cell.views} lượt"></progress></td>` : '<td class="muted">—</td>';
    }).join('')}<td class="mx-cell"><b>${total}</b> lượt<small>${leads} yêu cầu</small></td></tr>`;
  }).join('')+'</tbody>')}</section>`;
}
function renderLinks() {
  content.innerHTML=`<h2>Link nhân viên</h2>
  ${isAdmin()? `<div class="report-grid">
  <form data-form="employee" class="panel"><h3>Thêm tài khoản nhân viên</h3>
  <label>Họ tên<input name="name" maxlength="100" required></label><label>Email<input type="email" name="email" maxlength="160" required></label>
  <label>Mật khẩu ban đầu<input type="password" name="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
  <button class="primary">Tạo nhân viên</button></form>
  <form data-form="link" class="panel"><h3>Cấp link cho nhân viên</h3>
  <label>Nhân viên<select name="employee">${staff.filter(item=>item.active).map(item=>option(item.id,item.name)).join('')}</select></label>
  <p class="muted">Mỗi nhân viên 1 link dùng chung cho mọi mạng xã hội. Hệ thống tự nhận biết khách đến từ Zalo, Facebook, Messenger, TikTok, Instagram, Threads, YouTube hay Google; nguồn còn lại ghi là Khác. Với mã QR hoặc tờ rơi, dùng nút <b>Link QR</b> để thống kê đúng kênh QR.</p>
  <button class="primary">Tạo link</button></form></div>`:''}
  <div class="link-tools"><label class="link-search">Tìm link<input id="link-search" type="search" placeholder="Gõ mã (VD: 006), tên nhân viên hoặc kênh" autocomplete="off"></label>
  <p class="muted">Đặt mã dễ nhớ cho link: chữ không dấu, số hoặc dấu gạch ngang, ví dụ <b>006</b> hay <b>nam-zalo</b>. Đổi mã thì link mã cũ ngừng hoạt động, nhưng số liệu đã ghi nhận vẫn giữ nguyên.</p></div>
  ${wrapTable(head(['Nhân viên','Kênh','Link','Trạng thái','Thao tác'])+'<tbody>'+
    (links.map(item=>{
      const path=refPath(item);
      return `<tr data-search="${e([staffName(item.user_id),item.channel,item.slug,item.code].join(' ').toLowerCase())}"><th scope="row">${e(staffName(item.user_id))}</th><td>${item.channel==='Đa kênh'?'Tất cả mạng xã hội':e(item.channel)}</td>
    <td><a class="link-path" href="${e(path)}" target="_blank" rel="noopener">${e(location.host+path)}</a>
    <form data-form="slug" data-code="${e(item.code)}" class="slug-form"><input name="slug" value="${e(item.slug||'')}" maxlength="40" placeholder="Đặt mã, VD: 006" aria-label="Mã dễ nhớ cho link ${e(staffName(item.user_id))} · ${e(item.channel)}"><button class="small-button">Lưu mã</button></form></td>
    <td>${item.active?'Đang bật':'Đã tắt'}</td>
    <td><div class="actions">
    ${item.active?`<button data-act="copy" data-code="${e(item.code)}" data-path="${e(path)}">Sao chép</button>
      <button data-act="copy" data-code="${e(item.code)}" data-path="${e(path)}&utm_source=qr" title="Dùng khi in mã QR, tờ rơi">Link QR</button>
      ${navigator.share?`<button data-act="share" data-code="${e(item.code)}" data-path="${e(path)}">Chia sẻ</button>`:''}`:''}
    ${isAdmin()?`<button data-act="toggle-link" data-code="${e(item.code)}" data-active="${!item.active}">${item.active?'Tắt':'Bật'}</button>`:''}
    </div></td></tr>`;}).join('') || empty(5,'Chưa có link được cấp.'))+'</tbody>')}
  ${isAdmin()?`<h3>Danh sách tài khoản</h3>${wrapTable(head(['Họ tên','Email','Trạng thái','Thao tác'])+'<tbody>'+staff.map(item=>
    `<tr><th scope="row">${e(item.name)}</th><td>${e(item.email)}</td><td>${item.active?'Đang hoạt động':'Đã khóa'}</td>
    <td>${item.id===user.id?'Quản trị':`<button class="small-button" data-act="toggle-user" data-id="${item.id}" data-active="${!item.active}">${item.active?'Khóa':'Mở khóa'}</button>`}</td></tr>`
  ).join('')+'</tbody>')}`:''}`;
}
async function renderLeads() {
  if (!channels) await loadLinks();
  const {items, statuses, hasNext} = await api('/admin/leads?'+new URLSearchParams({...leadFilters, page}));
  if (tab!=='leads') return;
  content.innerHTML=`<h2>Yêu cầu báo giá</h2><div class="filters">
    ${filter('channel','Khách đến từ',[['','Tất cả kênh'],...['Trực tiếp',...channels].map(channel=>[channel,channel])],leadFilters,'lead-filter')}
    ${isAdmin()?filter('employee','Nhân viên',[['','Tất cả'],...staff.map(item=>[item.id,item.name])],leadFilters,'lead-filter'):''}
  </div>${wrapTable(head(['Khách hàng','Gói & dự toán','Nguồn','Thời gian','Trạng thái'])+'<tbody>'+
    (items.map(row=>`<tr><th scope="row">${e(row.business)}<small>${e(row.name)} · ${e(row.model)}</small>
      <a href="tel:${e(row.phone.replace(/[^+0-9]/g,''))}">${e(row.phone)}</a></th><td><details>
      <summary>${e(row.quote.plan)} · ${row.quote.term} tháng</summary><small>Giá gói ${money(row.quote.base)}</small>
      ${row.quote.items.map(item=>`<small>${e(item.name)} × ${item.quantity} · ${money(item.total)}</small>`).join('')}
      </details><b>${money(row.quote.subtotal)}</b>${row.quote.needsReview?'<small>Cần tư vấn thêm</small>':''}</td>
      <td>${e(row.channel)}<small>${e(row.employee||'Chưa phân công')}${row.link?' · ?ref='+e(row.link):''}</small></td><td>${dateTime(row.created)}</td>
      <td><select aria-label="Trạng thái của ${e(row.business)}" data-lead="${e(row.id)}">${statuses.map(s=>option(s,s,s===row.status)).join('')}</select></td></tr>`).join('') ||
      empty(5,'Chưa có yêu cầu báo giá.'))+'</tbody>')}
    <div class="section-bar"><button class="small-button" data-act="previous" ${page===1?'disabled':''}>Trang trước</button>
    <span>Trang ${page}</span><button class="small-button" data-act="next" ${hasNext?'':'disabled'}>Trang sau</button></div>`;
}
function catalogInput(kind, id, key, title, value, type='text', limit=100, extra='') {
  return `<input aria-label="${e(title)}" data-${kind}="${e(id)}" data-field="${key}" type="${type}" ${extra}
    value="${e(value)}" ${type==='number'?'min="0" max="10000000000" step="1" placeholder="Để trống = Liên hệ"':`maxlength="${limit}"`}>`;
}
// ---------- "Gói & module" editor ----------
const STATE_FLOW = ['included','extra','contact','off','hidden'];
const STATE_TEXT = {included:'Có sẵn', extra:'Mua thêm', contact:'Liên hệ', off:'Chưa có', hidden:'Ẩn'};
const termLabel = months => months===1 ? '1 tháng' : months%12===0 && months>12 ? `${months} tháng (${months/12} năm)` : `${months} tháng`;
const priceHint = (value, months) => value===null||value===undefined ? 'Trang báo giá hiện "Liên hệ"'
  : value===0 ? 'Miễn phí' : months===1 ? money(value)+' / tháng' : `${money(value)} · ≈ ${money(Math.round(value/months))}/tháng`;
function markDirty() {
  dirty=true;
  const badge=$('.draft-state');
  if (badge) { badge.textContent='● Có thay đổi chưa lưu'; badge.classList.add('is-dirty'); }
}
function renderCatalog() {
  const terms=catalog.terms;
  if (preview) {
    content.innerHTML=`<div class="section-bar"><h2>Xem trước bản nháp</h2><button class="small-button" data-act="preview">Quay lại chỉnh sửa</button></div>
    <div class="cards preview-cards">${catalog.plans.map(p=>`<div class="card ${p.featured?'featured':''}"><h3>${e(p.name)}</h3><p class="desc">${e(p.description)}</p>
      ${terms.map(t=>`<p class="preview-price"><span>${termLabel(t)}</span><b>${p.prices[t]===null?'Liên hệ':p.prices[t]===0?'Miễn phí':money(p.prices[t])}</b></p>`).join('')}</div>`).join('')}</div>
    ${wrapTable(head(['Module',...catalog.plans.map(p=>p.name)])+'<tbody>'+catalog.modules
      .filter(m=>Object.values(m.plans).some(s=>s!=='hidden')).map(m=>`<tr><th scope="row">${e(m.name)}<small>${e(m.description)}</small></th>
      ${catalog.plans.map(p=>`<td><span class="state-chip s-${m.plans[p.id]}">${m.plans[p.id]==='hidden'?'—':STATE_TEXT[m.plans[p.id]]}</span></td>`).join('')}</tr>`).join('')+'</tbody>')}`;
    return;
  }
  const modules=catalog.modules.filter(m=>!appFilter||m.app===appFilter);
  content.innerHTML=`<div class="section-bar cat-toolbar"><div><h2>Gói & module</h2>
    <p class="muted">Mọi chỉnh sửa nằm trong bản nháp. Bấm <b>Xuất bản</b> để cập nhật trang báo giá.</p></div>
    <div class="actions"><span class="draft-state ${dirty?'is-dirty':''}">${dirty?'● Có thay đổi chưa lưu':'✓ Đã lưu'}</span>
    <button class="small-button" data-act="preview">Xem trước</button><button class="small-button" data-act="save">Lưu bản nháp</button>
    <button class="primary" data-act="publish">Xuất bản</button></div></div>

  <section class="panel cat-block">
    <div class="cat-head"><h3><span class="step-n">1</span>Kỳ hạn thanh toán</h3>
    <p class="muted">Các kỳ hạn khách chọn trên trang báo giá. Thêm hoặc xóa kỳ hạn, rồi nhập giá cho từng gói ở bước 2.</p></div>
    <div class="term-list">${terms.map(t=>`<span class="term-chip"><b>${termLabel(t)}</b>
      <button type="button" data-act="remove-term" data-months="${t}" aria-label="Xóa kỳ hạn ${t} tháng" ${terms.length<2?'disabled title="Cần ít nhất 1 kỳ hạn"':''}>✕</button></span>`).join('')}</div>
    <div class="term-add-row">
      <form data-form="term" class="term-add"><input name="months" type="number" min="1" max="60" step="1" required placeholder="Số tháng, VD: 1" aria-label="Số tháng của kỳ hạn mới">
      <button class="small-button" ${terms.length>=8?'disabled':''}>+ Thêm kỳ hạn</button></form>
      <div class="term-quick"><span class="muted">Thêm nhanh:</span>${[1,3,6,12,24,36].filter(t=>!terms.includes(t)).map(t=>
        `<button type="button" class="chip-btn" data-act="add-term" data-months="${t}" ${terms.length>=8?'disabled':''}>+ ${termLabel(t)}</button>`).join('') || '<span class="muted">đã có đủ</span>'}</div>
    </div>
  </section>

  <section class="cat-block">
    <div class="cat-head"><h3><span class="step-n">2</span>Gói phần mềm & giá</h3>
    <p class="muted">Nhập giá trọn kỳ cho từng kỳ hạn. Để trống ô giá thì trang báo giá hiện <b>Liên hệ</b>; nhập 0 là <b>Miễn phí</b>.</p></div>
    <div class="plan-grid">${catalog.plans.map(p=>`<article class="panel plan-edit ${p.featured?'is-featured':''}">
      <div class="plan-edit-top">${catalogInput('plan',p.id,'name','Tên gói',p.name,'text',60,'class="plan-name"')}
        <label class="star-toggle" title="Gói được làm nổi bật trên trang báo giá"><input type="checkbox" data-plan="${e(p.id)}" data-field="featured" ${p.featured?'checked':''}><span>★ Nổi bật</span></label></div>
      <label>Mô tả${catalogInput('plan',p.id,'description','Mô tả',p.description,'text',300)}</label>
      <div class="limits">${[['members','Hội viên'],['staff','Nhân sự'],['branches','Chi nhánh']].map(([key,title])=>
        `<label>${title}${catalogInput('plan',p.id,key,title,p[key],'text',50)}</label>`).join('')}</div>
      <div class="price-rows">${terms.map(t=>`<div class="price-row"><span class="term-tag">${termLabel(t)}</span>
        ${catalogInput('plan',p.id,String(t),`Giá ${t} tháng của ${p.name}`,p.prices[t],'number')}
        <small class="price-hint">${priceHint(p.prices[t],t)}</small></div>`).join('')}</div>
    </article>`).join('')}</div>
  </section>

  <section class="panel cat-block">
    <div class="cat-head row"><div><h3><span class="step-n">3</span>Module theo gói</h3>
      <p class="muted">Bấm vào ô để đổi trạng thái: Có sẵn → Mua thêm → Liên hệ → Chưa có → Ẩn.</p></div>
      <div class="actions"><select id="app-filter" aria-label="Lọc theo app">${option('','Tất cả app',!appFilter)}${appGroups.map(group=>option(group,group,appFilter===group)).join('')}</select>
      <button class="small-button" data-act="add-module">+ Thêm module</button></div></div>
    <div class="state-legend">${STATE_FLOW.map(state=>`<span class="state-chip s-${state}">${STATE_TEXT[state]}</span>`).join('')}</div>
    ${wrapTable(head(['Module',...catalog.plans.map(p=>p.name),''])+'<tbody>'+(modules.map(m=>`<tr>
      <td class="module-fields">
        ${catalogInput('module',m.id,'name','Tên module',m.name,'text',100,'class="module-name"')}
        ${catalogInput('module',m.id,'description','Mô tả module',m.description,'text',300,'placeholder="Mô tả ngắn"')}
        <div class="module-meta">
          <select aria-label="App" data-module="${e(m.id)}" data-field="app">${appGroups.map(group=>option(group,group,m.app===group)).join('')}</select>
          ${catalogInput('module',m.id,'price','Giá mua thêm',m.price,'number')}
          <select aria-label="Đơn vị tính" data-module="${e(m.id)}" data-field="unit">${option('once','/ lần',m.unit==='once')}${option('month','/ tháng',m.unit==='month')}</select>
        </div></td>
      ${catalog.plans.map(p=>`<td class="state-cell"><button type="button" class="state-chip s-${m.plans[p.id]}" data-act="cycle-state" data-id="${e(m.id)}" data-plan="${e(p.id)}"
        aria-label="${e(m.name)} trong ${e(p.name)}: ${STATE_TEXT[m.plans[p.id]]}. Bấm để đổi">${STATE_TEXT[m.plans[p.id]]}</button></td>`).join('')}
      <td><button type="button" class="icon-btn danger" data-act="remove-module" data-id="${e(m.id)}" aria-label="Xóa module ${e(m.name)}">Xóa</button></td></tr>`).join('')
      || empty(catalog.plans.length+2,'Chưa có module trong nhóm này.'))+'</tbody>')}
  </section>`;
}
function addTerm(months) {
  months=Number(months);
  if (!Number.isInteger(months) || months<1 || months>60) return notice('Kỳ hạn phải là số tháng nguyên từ 1 đến 60.',true);
  if (catalog.terms.includes(months)) return notice(`Đã có kỳ hạn ${months} tháng.`,true);
  if (catalog.terms.length>=8) return notice('Tối đa 8 kỳ hạn.',true);
  catalog.terms=[...catalog.terms,months].sort((a,b)=>a-b);
  catalog.plans.forEach(p=>{p.prices[months]=null;});
  markDirty();
  renderCatalog();
  notice(`Đã thêm kỳ hạn ${termLabel(months)}. Nhập giá cho từng gói ở bước 2 (để trống = Liên hệ).`);
}
async function save() {
  catalog=await api('/admin/catalog',task('PUT',catalog));
  dirty=false;
}
function editCatalog(target) {
  const {plan, module:id, field}=target.dataset;
  if (plan) {
    const p=catalog.plans.find(item=>item.id===plan);
    if (field==='featured') {
      if (target.checked) catalog.plans.forEach(item=>{item.featured=item.id===plan;});
      else p.featured=false;
      markDirty();
      return renderCatalog();
    }
    if (target.type==='number') {
      p.prices[field]=target.value===''?null:Number(target.value);
      const hint=target.closest('.price-row')?.querySelector('.price-hint');
      if (hint) hint.textContent=priceHint(p.prices[field],Number(field));
    } else p[field]=target.value;
  }
  if (id) {
    const m=catalog.modules.find(item=>item.id===id);
    m[field]=target.type==='number'?(target.value===''?null:Number(target.value)):target.value;
  }
  if (plan||id) markDirty();
}
async function action(button) {
  const {act,id,code,active}=button.dataset;
  if (act==='previous'||act==='next') {
    page+=act==='previous'?-1:1;
    await renderLeads();
  }
  if (act==='toggle-user'||act==='toggle-link') {
    const isUser=act==='toggle-user';
    await api(isUser?'/admin/users':'/admin/links',task('PATCH',{id:Number(id),code,active:active==='true'}));
    await render();
  }
  if (act==='copy'||act==='share') {
    const url=location.origin+(button.dataset.path||'/r/'+code);
    if (act==='copy') await navigator.clipboard.writeText(url);
    else {
      try { await navigator.share({title:'DANAVA Studio',url}); }
      catch(error) { if(error.name==='AbortError') return; throw error; }
    }
    await api('/admin/link-action',task('POST',{code,kind:act}));
    notice(act==='copy'?'Đã sao chép '+url:'Đã ghi nhận thao tác chia sẻ.');
  }
  if (act==='preview') { preview=!preview; renderCatalog(); }
  if (act==='save'||act==='publish') {
    if (dirty) await save();
    if (act==='publish') await api('/admin/publish',task('POST',{version:catalog.version}));
    const badge=$('.draft-state');
    if (badge) { badge.textContent='✓ Đã lưu'; badge.classList.remove('is-dirty'); }
    notice(act==='save'?'Đã lưu bản nháp.':'Đã xuất bản: trang báo giá đã cập nhật.');
  }
  if (act==='add-term') addTerm(button.dataset.months);
  if (act==='remove-term') {
    const months=Number(button.dataset.months);
    if (catalog.terms.length<2) return notice('Cần giữ ít nhất 1 kỳ hạn.',true);
    if (confirm(`Xóa kỳ hạn ${termLabel(months)}? Giá của kỳ hạn này ở mọi gói sẽ bị xóa khỏi bản nháp.`)) {
      catalog.terms=catalog.terms.filter(t=>t!==months);
      catalog.plans.forEach(p=>{delete p.prices[months];});
      markDirty();
      renderCatalog();
    }
  }
  if (act==='cycle-state') {
    const m=catalog.modules.find(item=>item.id===id);
    const next=STATE_FLOW[(STATE_FLOW.indexOf(m.plans[button.dataset.plan])+1)%STATE_FLOW.length];
    m.plans[button.dataset.plan]=next;
    button.className='state-chip s-'+next;
    button.textContent=STATE_TEXT[next];
    button.setAttribute('aria-label',button.getAttribute('aria-label').replace(/: [^.]+\./, ': '+STATE_TEXT[next]+'.'));
    markDirty();
  }
  if (act==='add-module') {
    catalog.modules.push({id:crypto.randomUUID(),name:'Module mới',description:'',app:appFilter||appGroups[0],price:null,unit:'once',
      plans:Object.fromEntries(catalog.plans.map(p=>[p.id,'off']))});
    markDirty();
    renderCatalog();
    content.querySelector('.cat-block tbody tr:last-child .module-name')?.focus();
  }
  if (act==='remove-module' && confirm('Xóa module khỏi bản nháp?')) {
    catalog.modules=catalog.modules.filter(item=>item.id!==id);
    markDirty();
    renderCatalog();
  }
}
function errorNotice(error) {
  notice(error.message,true);
  if (error.status===401 && user) {
    user=null;
    $('#workspace').hidden=true;
    $('#signin').hidden=false;
  }
}
$('#login').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const button=$('button',ev.target);
  button.disabled=true;
  try {
    await api('/login',task('POST',fields(ev.target)));
    ev.target.reset();
    await start();
  } catch(error) { errorNotice(error); }
  finally {button.disabled=false;}
});
$('#logout').addEventListener('click',async ()=>{
  if (dirty && !confirm('Đăng xuất và bỏ các chỉnh sửa chưa lưu?')) return;
  try {
    await api('/admin/logout',task('POST',{}));
    user=null; dirty=false; page=1; content.replaceChildren(); notice('');
    await start();
  } catch(error) { errorNotice(error); }
});
$('#tabs').addEventListener('click',ev=>{
  const button=ev.target.closest('[data-tab]');
  if (button && button.dataset.tab!==tab) navigate(button.dataset.tab).catch(errorNotice);
});
content.addEventListener('click',async ev=>{
  const button=ev.target.closest('[data-act]');
  if (!button) return;
  button.disabled=true;
  try { await action(button); }
  catch(error) { errorNotice(error); }
  finally {button.disabled=false;}
});
content.addEventListener('input',ev=>{
  if (ev.target.id==='link-search') {
    const query=ev.target.value.trim().toLowerCase();
    content.querySelectorAll('tr[data-search]').forEach(row=>{row.hidden=!!query && !row.dataset.search.includes(query);});
    return;
  }
  if (tab==='catalog' && ev.target.matches('input:not([type=checkbox])')) editCatalog(ev.target);
});
content.addEventListener('change',async ev=>{
  const target=ev.target;
  try {
    if (target.id==='app-filter') {
      appFilter=target.value;
      renderCatalog();
      $('#app-filter').focus();
      return;
    }
    if (target.dataset.leadFilter) {
      leadFilters[target.dataset.leadFilter]=target.value;
      page=1;
      await renderLeads();
    }
    if (target.dataset.filter) {
      filters[target.dataset.filter]=target.value;
      await renderReport();
    }
    if (target.dataset.lead) {
      try { await api('/admin/leads',task('PATCH',{id:target.dataset.lead,status:target.value})); }
      catch (error) { await renderLeads(); throw error; }
      notice('Đã đổi trạng thái.');
    }
    if (tab==='catalog' && target.matches('input[type=checkbox],select[data-module]')) editCatalog(target);
  } catch(error) {errorNotice(error);}
});
content.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.target;
  if (form.dataset.form==='term') { addTerm(new FormData(form).get('months')); return; }
  const button=$('button',form);
  const data=fields(form);
  button.disabled=true;
  try {
    if (form.dataset.form==='employee') await api('/admin/users',task('POST',data));
    if (form.dataset.form==='link') await api('/admin/links',task('POST',{...data,employee:Number(data.employee)}));
    if (form.dataset.form==='password') await api('/admin/password',task('POST',data));
    if (form.dataset.form==='slug') await api('/admin/link-slug',task('POST',{code:form.dataset.code,slug:toSlug(data.slug)}));
    form.reset();
    if (form.dataset.form!=='password') await render();
    notice('Đã lưu.');
  } catch(error) {errorNotice(error);}
  finally {button.disabled=false;}
});
addEventListener('beforeunload',ev=>{if(dirty){ev.preventDefault();ev.returnValue='';}});
// Live updates: every few seconds ask the server whether anything happened (visit, lead, copy, share).
// When it did, redraw the open tab. Skipped while the browser tab is hidden or the user is typing.
const LIVE_TABS = ['report','links','leads'];
let pulse = null, pulsing = false;
function liveBadge(text) {
  let badge = $('#live');
  if (!badge) {
    $('.admin-head > div').insertAdjacentHTML('beforeend','<p class="live" id="live" role="status"></p>');
    badge = $('#live');
  }
  badge.textContent = text;
}
async function heartbeat() {
  if (pulsing || !user || document.hidden || !LIVE_TABS.includes(tab)) return;
  pulsing = true;
  try {
    const {stamp} = await api('/admin/pulse');
    const typing = content.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
    if (pulse !== null && stamp !== pulse) {
      if (typing || dirty) return; // keep the old stamp so the redraw happens on a later beat
      await render();
    }
    pulse = stamp;
    liveBadge('Cập nhật trực tiếp · ' + new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
  } catch (error) {
    if (error.status===401) return errorNotice(error);
    liveBadge('Mất kết nối, đang thử lại…');
  } finally { pulsing = false; }
}
setInterval(heartbeat, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });

start().then(heartbeat).catch(errorNotice);
