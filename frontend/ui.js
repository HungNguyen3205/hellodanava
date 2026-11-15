export const $ = (selector, scope = document) => scope.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const money = value => value === null ? 'Liên hệ' : new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
export const dateTime = value => new Intl.DateTimeFormat('vi-VN', {
  dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'
}).format(value);
export async function api(path, options = {}) {
  const {body, ...rest} = options;
  const res = await fetch('/api'+path, {...rest,
    ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
  const result = await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error), {status:res.status});
  return result;
}
export const option = (value, label, selected = false) =>
  `<option value="${escape(value)}" ${selected ? 'selected' : ''}>${escape(label)}</option>`;
export const statusLabels = {included:'Có sẵn', off:'—', extra:'Mua thêm', contact:'Liên hệ', hidden:'Ẩn'};
