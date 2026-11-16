import {$, api, escape as e, money, option, statusLabels} from './ui.js';

let catalog, plan, model, term = 12, stage = null;
let requestId = crypto.randomUUID();
const chosen = new Map();
const ref = new URLSearchParams(location.search).get('ref');
const sendEvent = (kind, planId = null) =>
  api('/events',{method:'POST',body:{kind,ref,plan:planId,referrer:document.referrer,query:location.search}}).catch(() => {});

// Landing page: in-page links scroll smoothly without adding "#section" to the URL.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
document.addEventListener('click', ev => {
  const link = ev.target.closest('a[href^="#"]');
  if (!link || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const target = document.getElementById(link.getAttribute('href').slice(1));
  if (!target) return;
  ev.preventDefault();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({behavior: still ? 'auto' : 'smooth', block: 'start'});
});

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
  $('#stage-label').textContent = model;
  stage?.setModel(model);
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
      <p class="period">${value > 0 ? (term === 1 ? '/tháng' : `/${term} tháng · ≈ ${money(Math.round(value/term))}/tháng`) : '&nbsp;'}</p>
      <dl><div><dt>Hội viên</dt><dd>${e(p.members)}</dd></div><div><dt>Nhân sự</dt><dd>${e(p.staff)}</dd></div>
      <div><dt>Chi nhánh</dt><dd>${e(p.branches)}</dd></div></dl>
      <ul>${included.slice(0,4).map(m=>`<li>${e(m.name)}</li>`).join('')}</ul>
      <a class="primary" href="#quote" data-plan="${e(p.id)}">Chọn ${e(p.name)}</a></article>`;
  }).join('');
  renderMatrix();
  $('#plan-picker').innerHTML = catalog.plans.map(p => {
    const value = p.prices[term];
    return `<button type="button" class="plan-opt" data-plan="${e(p.id)}" aria-pressed="${p.id === plan}">
      ${p.featured ? '<em>Nổi bật</em>' : ''}<b>${e(p.name)}</b>
      <span>${value === 0 ? 'Miễn phí' : value === null ? 'Liên hệ' : money(value)}</span></button>`;
  }).join('');
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
        const status = m.plans[p.id]==='hidden' ? 'off' : m.plans[p.id];
        return `<td class="s-${status}${p.featured?' hot':''}"><span>${status==='included'?'✓ Có sẵn':statusLabels[status]}</span></td>`;
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
  $('#extras').innerHTML = modules.map(m=>{
    const on = chosen.has(m.id);
    const contact = m.plans[plan]==='contact' || m.price===null;
    return `<div class="extra${on?' on':''}">
    <label class="extra-main"><input type="checkbox" class="tick" data-extra="${e(m.id)}" ${on?'checked':''}>
    <span class="extra-text"><b>${e(m.name)}</b><small>${contact ? 'Liên hệ để báo giá' : money(m.price)+(m.unit==='month'?' / tháng':' / lần')}</small></span></label>
    <div class="stepper"><button type="button" data-step="-1" data-for="${e(m.id)}" aria-label="Giảm số lượng ${e(m.name)}" ${on?'':'disabled'}>−</button>
    <input type="number" min="1" max="99" step="1" inputmode="numeric" aria-label="Số lượng ${e(m.name)}" data-qty="${e(m.id)}" value="${chosen.get(m.id)||1}" ${on?'':'disabled'}>
    <button type="button" data-step="1" data-for="${e(m.id)}" aria-label="Tăng số lượng ${e(m.name)}" ${on?'':'disabled'}>+</button></div></div>`;
  }).join('')
    || '<p class="muted">Gói này chưa có tùy chọn bổ sung.</p>';
  estimate();
}
let shownTotal = 0, tween = 0;
function countTo(el, target) {
  cancelAnimationFrame(tween);
  const from = shownTotal, start = performance.now();
  shownTotal = target;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === target) { el.textContent = money(target); return; }
  const step = now => {
    const k = Math.min(1, (now - start) / 450);
    el.textContent = money(Math.round(from + (target - from) * (1 - (1 - k) ** 3)));
    if (k < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}
function estimate() {
  const selected = catalog.plans.find(p=>p.id===plan);
  const base = selected.prices[term];
  let total = base ?? 0;
  let review = base===null;
  const lines = [[`Gói ${selected.name} · ${term} tháng`, base===null ? 'Liên hệ' : base===0 ? 'Miễn phí' : money(base)]];
  for (const mod of extrasForPlan()) {
    if (!chosen.has(mod.id)) continue;
    const qty = chosen.get(mod.id);
    const label = mod.name + (qty > 1 ? ` × ${qty}` : '') + (mod.unit==='month' ? ` · ${term} tháng` : '');
    if (mod.plans[plan]==='contact' || mod.price===null) { review = true; lines.push([label, 'Liên hệ']); }
    else { const cost = mod.price*qty*(mod.unit==='month'?term:1); total += cost; lines.push([label, money(cost)]); }
  }
  $('#estimate').innerHTML = `<div class="rc-head"><span>Dự toán của bạn</span><b>${e(selected.name)}</b></div>
    <ul class="rc-lines">${lines.map(([name,cost])=>`<li><span>${e(name)}</span><b>${cost}</b></li>`).join('')}</ul>
    <div class="rc-total"><span>Tổng dự toán</span><strong>${base===null?'Liên hệ':money(shownTotal)}</strong></div>
    <small>${review?'Có hạng mục cần tư vấn để xác nhận tổng chi phí.':'Dự toán cho các hạng mục đã chọn.'}</small>`;
  if (base!==null) countTo($('#estimate strong'), total);
}
document.addEventListener('click', ev => {
  const item = ev.target.closest('[data-model],[data-term],[data-plan]');
  if (!item || !catalog) return;
  if (item.dataset.model) model = item.dataset.model;
  if (item.dataset.term) term = Number(item.dataset.term);
  if (item.dataset.plan) plan = item.dataset.plan;
  render();
  sendEvent('interaction',item.dataset.plan ? plan : null);
  if (item.dataset.plan) $('#plan-picker [aria-pressed=true]')?.focus({preventScroll:true});
  else document.querySelector(item.dataset.model ? '[data-model][aria-pressed=true]' : '[data-term][aria-pressed=true]')?.focus({preventScroll:true});
});
if (matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
  $('#cards').addEventListener('pointermove', ev => {
    const card = ev.target.closest('.card');
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty('--ry', (((ev.clientX - box.left) / box.width - .5) * 8).toFixed(2) + 'deg');
    card.style.setProperty('--rx', (((ev.clientY - box.top) / box.height - .5) * -8).toFixed(2) + 'deg');
  });
  $('#cards').addEventListener('pointerout', ev => {
    const card = ev.target.closest('.card');
    if (card && !card.contains(ev.relatedTarget)) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
  });
}
$('#differences').addEventListener('change', ()=>{ renderMatrix(); sendEvent('interaction'); });
$('#extras').addEventListener('click', ev=>{
  const button = ev.target.closest('[data-step]');
  if (!button) return;
  const input = $('#extras').querySelector(`[data-qty="${button.dataset.for}"]`);
  input.value = Math.max(1, Math.min(99, Number(input.value) + Number(button.dataset.step)));
  input.dispatchEvent(new Event('change', {bubbles:true}));
});
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
  const button = $('button[form=lead]');
  const status = $('#lead-status');
  button.disabled = true;
  status.textContent = 'Đang gửi…';
  try {
    await api('/leads',{method:'POST',body:{...Object.fromEntries(new FormData(ev.target)),id:requestId,plan,term,model,
      extras:[...chosen].map(([id,quantity])=>({id,quantity})),ref,referrer:document.referrer,query:location.search,version:catalog.version}});
    status.textContent = 'Đã gửi yêu cầu. DANAVA sẽ liên hệ theo số điện thoại anh/chị cung cấp.';
    ev.target.reset();
    requestId = crypto.randomUUID();
  } catch(error) { status.textContent = error.message; }
  finally { button.disabled=false; }
});
try {
  catalog = await api('/catalog');
  if (!catalog.terms.includes(term)) term = catalog.terms[0];
  model = catalog.models[0];
  plan = catalog.plans.find(p=>p.featured)?.id || catalog.plans[0].id;
  render();
  sendEvent('view');
  import('/scene.js').then(scene => {
    stage = scene.mount($('#scene'));
    if (!stage) return;
    stage.setModel(model);
    $('.stage').classList.add('ready');
  }).catch(() => {});
} catch {
  $('#notice').hidden=false;
  $('#notice').textContent='Chưa tải được bảng giá. Vui lòng tải lại trang.';
}
