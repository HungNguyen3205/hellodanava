// Billing terms (months) are editable in the admin and stored in the catalog itself.
// Catalogs saved before terms were editable fall back to these.
export const DEFAULT_TERMS = [6, 12, 24];
export const terms = DEFAULT_TERMS;
export const MAX_TERMS = 8;
export const validTerms = list => Array.isArray(list) && list.length >= 1 && list.length <= MAX_TERMS &&
  list.every(t => Number.isInteger(t) && t >= 1 && t <= 60) && new Set(list).size === list.length;
export const termsOf = catalog => validTerms(catalog?.terms) ? [...catalog.terms].sort((a, b) => a - b) : DEFAULT_TERMS;
export const channels = ['Zalo', 'Facebook', 'Messenger', 'TikTok', 'Instagram', 'Threads', 'YouTube', 'Google', 'QR', 'Khác'];
// A staff link that is not tied to one network; the visit's network is detected per click.
export const ANY_CHANNEL = 'Đa kênh';
export const models = ['Gym', 'Yoga', 'Pilates', 'Bể bơi', 'Spa'];
export const apps = ['Quản trị Studio', 'App hội viên', 'App riêng theo thương hiệu'];
export const states = ['off', 'included', 'extra', 'contact', 'hidden'];
export const seed = {
  terms: DEFAULT_TERMS,
  plans: [
    ['start', 'Khởi đầu', 'Quản lý phòng tập nhỏ với các tính năng cơ bản.', 0, '50', '2', '1'],
    ['pro', 'Pro', 'Tự động hóa vận hành và bán gói tập.', 5000000, '1.000', '10', '1'],
    ['premium', 'Premium', 'Dành cho phòng tập có nhiều hội viên và nhân sự.', 10000000, '5.000', '15', '2'],
    ['enterprise', 'Doanh nghiệp', 'Quản lý chuỗi và phân quyền nâng cao.', 20000000, 'Không giới hạn', 'Không giới hạn', '3']
  ].map(([id, name, description, price, members, staff, branches]) => ({
    id, name, description, members, staff, branches, featured: id === 'premium',
    prices: {6: price === 0 ? 0 : null, 12: price, 24: price === 0 ? 0 : null}
  })),
  modules: [
    ['Lịch lớp & điểm danh', 'Xếp lịch và theo dõi chuyên cần.', 0],
    ['POS bán hàng & kho', 'Quản lý bán tại quầy, tồn kho và phiếu nhập.', 1],
    ['Cổng thanh toán online riêng', 'Kết nối PayOS, SePAY hoặc Tingee.', 1],
    ['Chiến dịch & khuyến mãi', 'Gửi tin và theo dõi chương trình ưu đãi.', 1],
    ['Báo cáo nâng cao', 'Theo dõi hiệu quả vận hành.', 1],
    ['Tích điểm & hạng thành viên', 'Cấu hình điểm và hạng thành viên.', 2],
    ['CRM khách tiềm năng & tập thử', 'Theo dõi nguồn khách và lịch tập thử.', 2],
    ['Zalo ZNS', 'Nhắc hội viên qua Zalo. Phí tin nhắn tính riêng nếu áp dụng.', 2],
    ['Ca làm, chấm công & lương', 'Xếp ca, chấm công và quản lý bảng lương.', 3],
    ['Hoa hồng nhân viên & HLV', 'Tính hoa hồng theo doanh số.', 3],
    ['CTV / Đối tác', 'Quản lý cộng tác viên và giới thiệu khách.', 3],
    ['Thiết bị check-in & khóa cửa', 'Kết nối thiết bị và theo dõi nhật ký.', 3],
    ['Nhật ký hoạt động', 'Theo dõi thao tác trong Studio.', 3],
    ['App hội viên', 'Đặt lịch và xem gói tập trên điện thoại.', 2, 1],
    ['App riêng theo thương hiệu', 'Tùy chỉnh app theo nhận diện của phòng tập.', 4, 2, 500000, 'month'],
    ['Mở thêm chi nhánh', 'Bổ sung chi nhánh ngoài hạn mức gói.', 4, 0, 3000000, 'once']
  ].map(([name, description, threshold, app = 0, price = null, unit = 'once'], index) => ({
    id: 'module-' + index, name, description, app: apps[app], price, unit,
    plans: Object.fromEntries(['start','pro','premium','enterprise'].map((id, i) =>
      [id, threshold === 4 ? 'extra' : i >= threshold ? 'included' : 'off']))
  }))
};

export function quote(catalog, selection) {
  const plan = catalog.plans.find(({id}) => id === selection.plan);
  if (!plan || !termsOf(catalog).includes(selection.term) || !Array.isArray(selection.extras) ||
    selection.extras.length > catalog.modules.length) return null;
  const items = [];
  for (const item of selection.extras) {
    const mod = catalog.modules.find(({id}) => id === item?.id);
    if (!mod || !['extra','contact'].includes(mod.plans[plan.id]) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
        items.some(({id}) => id === mod.id)) return null;
    const price = mod.plans[plan.id] === 'contact' ? null : mod.price;
    items.push({id: mod.id, name: mod.name, quantity: item.quantity, price, unit: mod.unit,
      total: price === null ? null : item.quantity * price * (mod.unit === 'month' ? selection.term : 1)});
  }
  const base = plan.prices[selection.term];
  return {plan: plan.name, term: selection.term, base, items,
    subtotal: base === null ? null : base + items.reduce((sum, item) => sum + (item.total ?? 0), 0),
    needsReview: base === null || items.some(item => item.total === null)};
}
