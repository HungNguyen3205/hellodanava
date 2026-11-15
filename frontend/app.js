import {$, api, escape as e, money, option, statusLabels} from './ui.js';

let catalog, plan, model, term = 12;
let requestId = crypto.randomUUID();
const chosen = new Map();
const ref = new URLSearchParams(location.search).get('ref');
const sendEvent = (kind, planId = null) =>
  api('/events',{method:'POST',body:{kind,ref,plan:planId}}).catch(() => {});

const modelModules = {
  Gym:['POS bán hàng & kho','Thiết bị check-in & khóa cửa'],
  Yoga:['Lịch lớp & điểm danh','App hội viên'],
  Pilates:['Lịch lớp & điểm danh','CRM khách tiềm năng & tập thử'],
  'Bể bơi':['Lịch lớp & điểm danh','Thiết bị check-in & khóa cửa'],
  Spa:['Lịch lớp & điểm danh','CRM khách tiềm năng & tập thử']
};

function render() {
  $('#models').innerHTML = catalog.models.map(item =>
    `<button type="button" data-model="${e(item)}" aria-pressed="${item === model}">${e(item)}</button>`).join('');
  $('#terms').innerHTML = catalog.terms.map(item =>
    `<button type="button" data-term="${item}" aria-pressed="${item === term}">${item} tháng</button>`).join('');
  $('#cards').innerHTML = catalog.plans.map(p => {
    const value = p.prices[term];
    const included = catalog.modules.filter(m => m.plans[p.id] === 'included').sort((a,b) =>
      Number(modelModules[model]?.includes(b.name)) - Number(modelModules[model]?.includes(a.name)));
    return `<article class="card ${p.featured?'featured':''}">
      ${p.featured?'<span class="badge">Gói nổi bật</span>':''}
      <h3>${e(p.name)}</h3><p class="desc">${e(p.description)}</p>
      <p class="price">${value === 0 ? 'Miễn phí' : money(value)}</p>
      <p class="period">${value > 0 ? `/${term} tháng · ≈ ${money(Math.round(value/term))}/tháng` : '&nbsp;'}</p>
      <dl><div><dt>Hội viên</dt><dd>${e(p.members)}</dd></div><div><dt>Nhân sự</dt><dd>${e(p.staff)}</dd></div>
      <div><dt>Chi nhánh</dt><dd>${e(p.branches)}</dd></div></dl>
      <ul>${included.slice(0,4).map(m=>`<li>${e(m.name)}</li>`).join('')}</ul>
      <a class="primary" href="#quote" data-plan="${e(p.id)}">Chọn ${e(p.name)}</a></article>`;
  }).join('');
  renderMatrix();
  $('#plan').innerHTML = catalog.plans.map(p => option(p.id,p.name,p.id===plan)).join('');
  renderExtras();
}

function renderMatrix() {
  const only = $('#differences').checked;
  const groups = catalog.apps.map(app => {
    const rows = catalog.modules.filter(m => m.app===app && Object.values(m.plans).some(s=>s!=='hidden') &&
      (!only || new Set(Object.values(m.plans).map(s=>s==='hidden'?'off':s)).size>1));
    if (!rows.length) return '';
    return `<tr class="group"><th colspan="${catalog.plans.length+1}">${e(app)}</th></tr>`+rows.map(m=>
      `<tr><th scope="row">${e(m.name)}<small>${e(m.description)}</small></th>${catalog.plans.map(p=>{
        const status = m.plans[p.id];
        return `<td class="${status==='included'?'yes':''}">${status==='included'?'✓ Có sẵn':statusLabels[status==='hidden'?'off':status]}</td>`;
      }).join('')}</tr>`).join('');
  }).join('');
  $('#matrix').innerHTML = '<thead><tr><th scope="col">Module</th>'+catalog.plans.map(p=>
    `<th scope="col" class="${p.featured?'yes':''}">${e(p.name)}</th>`).join('')+'</tr></thead><tbody>'+
    (groups || `<tr><td colspan="${catalog.plans.length+1}">Không có tính năng phù hợp với bộ lọc.</td></tr>`)+'</tbody>';
}

function extrasForPlan() {
  return catalog.modules.filter(m=>['extra','contact'].includes(m.plans[plan]));
}
function renderExtras() {
  const modules = extrasForPlan();
  for (const id of chosen.keys()) if (!modules.some(m=>m.id===id)) chosen.delete(id);
  $('#extras').innerHTML = modules.map(m=>`<div class="extra">
    <label class="toggle"><input type="checkbox" data-extra="${e(m.id)}" ${chosen.has(m.id)?'checked':''}>
    <span><b>${e(m.name)}</b><small>${m.plans[plan]==='contact' || m.price===null ? 'Liên hệ' : money(m.price)+(m.unit==='month'?' / tháng':' / lần')}</small></span></label>
    <input type="number" min="1" max="99" step="1" aria-label="Số lượng ${e(m.name)}" data-qty="${e(m.id)}" value="${chosen.get(m.id)||1}" ${chosen.has(m.id)?'':'disabled'}></div>`).join('')
    || '<p class="muted">Gói này chưa có tùy chọn bổ sung.</p>';
  estimate();
}
function estimate() {
  const selected = catalog.plans.find(p=>p.id===plan);
  const base = selected.prices[term];
  let total = base ?? 0;
  let review = base===null;
  for (const mod of extrasForPlan()) {
    if (!chosen.has(mod.id)) continue;
    if (mod.plans[plan]==='contact' || mod.price===null) review = true;
    else total += mod.price*chosen.get(mod.id)*(mod.unit==='month'?term:1);
  }
  $('#estimate').innerHTML = `<span>${e(selected.name)} · ${term} tháng</span><strong>${base===null?'Liên hệ':money(total)}</strong>
    <small>${review?'Có hạng mục cần tư vấn để xác nhận tổng chi phí.':'Dự toán cho các hạng mục đã chọn.'}</small>`;
}
document.addEventListener('click', ev => {
  const item = ev.target.closest('[data-model],[data-term],[data-plan]');
  if (!item || !catalog) return;
  if (item.dataset.model) model = item.dataset.model;
  if (item.dataset.term) term = Number(item.dataset.term);
  if (item.dataset.plan) plan = item.dataset.plan;
  render();
  sendEvent('interaction',item.dataset.plan ? plan : null);
  if (item.dataset.plan) $('#plan').focus({preventScroll:true});
  else document.querySelector(item.dataset.model ? '[data-model][aria-pressed=true]' : '[data-term][aria-pressed=true]')?.focus({preventScroll:true});
});
$('#differences').addEventListener('change', ()=>{ renderMatrix(); sendEvent('interaction'); });
$('#plan').addEventListener('change', ev=>{plan=ev.target.value; renderExtras(); sendEvent('interaction',plan);});
$('#extras').addEventListener('change', ev=>{
  if (ev.target.dataset.extra) {
    const id = ev.target.dataset.extra;
    if (ev.target.checked) chosen.set(id,1); else chosen.delete(id);
    renderExtras();
    $('#extras').querySelector(`[data-extra="${id}"]`)?.focus({preventScroll:true});
  }
  if (ev.target.dataset.qty) {
    const quantity = Math.max(1,Math.min(99,Math.trunc(Number(ev.target.value))||1));
    chosen.set(ev.target.dataset.qty,quantity);
    ev.target.value = quantity;
    estimate();
  }
  sendEvent('interaction',plan);
});
$('#lead').addEventListener('submit', async ev=>{
  ev.preventDefault();
  if (!catalog) return;
  const button = $('button',ev.target);
  const status = $('#lead-status');
  button.disabled = true;
  status.textContent = 'Đang gửi…';
  try {
    await api('/leads',{method:'POST',body:{...Object.fromEntries(new FormData(ev.target)),id:requestId,plan,term,model,
      extras:[...chosen].map(([id,quantity])=>({id,quantity})),ref,version:catalog.version}});
    status.textContent = 'Đã gửi yêu cầu. DANAVA sẽ liên hệ theo số điện thoại anh/chị cung cấp.';
    ev.target.reset();
    requestId = crypto.randomUUID();
  } catch(error) { status.textContent = error.message; }
  finally { button.disabled=false; }
});
try {
  catalog = await api('/catalog');
  model = catalog.models[0];
  plan = catalog.plans.find(p=>p.featured)?.id || catalog.plans[0].id;
  render();
  sendEvent('view');
} catch {
  $('#notice').hidden=false;
  $('#notice').textContent='Chưa tải được bảng giá. Vui lòng tải lại trang.';
}
