# Hello DANAVA

Website báo giá DANAVA Studio và cổng quản trị bán hàng nội bộ.

| Thư mục | Vai trò |
| --- | --- |
| `frontend/` | Giao diện báo giá, bảng so sánh, biểu mẫu khách hàng và dashboard nội bộ. HTML, CSS và JavaScript modules. |
| `backend/` | HTTP API Node.js, đăng nhập và phân quyền, tính giá trên máy chủ, quản lý cấu hình, lưu yêu cầu và thống kê bằng SQLite. |

## Chạy trên máy phát triển

Cần Node.js 24 trở lên. Ứng dụng dùng thư viện tích hợp của Node.js.

```bash
npm run dev
```

- Báo giá tại `http://localhost:3000/`.
- Admin tại `http://localhost:3000/admin`.
- Lệnh chạy cả giao diện và API trên cùng cổng. Node tự khởi động lại khi mã backend thay đổi.
- Lần đầu chạy với cơ sở dữ liệu mới và chưa cấu hình admin, terminal in email và mật khẩu ngẫu nhiên để đăng nhập. Lưu mật khẩu vì thông tin chỉ hiện một lần.
- Có thể tạo `.env` từ `.env.example` nếu muốn đặt email và mật khẩu admin trước lần chạy đầu, đổi cổng hoặc đổi thư mục dữ liệu. Dữ liệu mặc định nằm tại `data/studio.sqlite`. Đổi mật khẩu của tài khoản đã tạo trong mục **Tài khoản**.
- `npm run check` kiểm tra cú pháp JavaScript chính.

## Vận hành

1. Trong **Gói & module**, chỉnh giá theo kỳ hạn và tick tính năng theo gói. Có thể chọn mua thêm, liên hệ hoặc ẩn. **Xem trước** kiểm tra bản nháp. **Xuất bản** cập nhật trang công khai.
2. Trong **Link nhân viên**, tạo tài khoản và cấp link cho nhân viên (một link dùng cho mọi kênh). Nhân viên đăng nhập để đặt mã dễ nhớ, sao chép hoặc chia sẻ link và xem các yêu cầu được gắn với mình.
3. Trong **Tổng quan**, xem truy cập, khách ước tính, tương tác và yêu cầu theo ngày, nhân viên, kênh và gói.
4. Trong **Yêu cầu báo giá**, mở chi tiết dự toán và cập nhật trạng thái tư vấn. Mỗi yêu cầu giữ giá tại thời điểm gửi.

Giá mẫu 12 tháng theo ảnh tham chiếu. Kỳ hạn 6 và 24 tháng của các gói trả phí hiện **Liên hệ** cho tới khi nhập giá. Xác nhận giá và quyền lợi trước khi đưa ra công khai.

Nguồn được ghi nhận theo nhân viên sở hữu link và kênh nhận diện ở từng lượt bấm (xem mục Link nhân viên đa kênh). Khách truy cập được ước tính bằng cookie trình duyệt. Số thao tác sao chép và chia sẻ chỉ ghi nhận trong cổng nội bộ.

## Chạy tại hellodanava.vn

Triển khai trên cPanel (hello.danava.vn): làm theo [DEPLOY-CPANEL.md](DEPLOY-CPANEL.md). File khởi động trên hosting là `app.cjs`.

Cấu hình `ADMIN_EMAIL` và `ADMIN_PASSWORD` trước lần khởi động đầu. Dùng `npm start` trên máy chủ có đĩa lưu trữ bền vững. Đặt HTTPS ở reverse proxy, trỏ DNS về máy chủ và đặt `SECURE_COOKIES=1` trong môi trường chạy thật. Giữ ứng dụng và API cùng tên miền. Đặt `HOST=127.0.0.1` khi proxy và ứng dụng chạy cùng máy, và đặt `TRUST_PROXY=1` khi chạy sau đúng một reverse proxy để giới hạn tần suất tính theo IP thật của khách. Bật nén gzip ở proxy (thư viện 3D khoảng 690KB). Sao lưu SQLite bằng công cụ hỗ trợ sao lưu cơ sở dữ liệu đang hoạt động (chép cả `studio.sqlite`, `-wal`, `-shm`), hoặc dừng tiến trình trước khi sao chép thư mục dữ liệu.

## Link nhân viên đa kênh

- Mỗi nhân viên có **1 link dùng cho mọi mạng xã hội**. Đặt mã dễ nhớ (chữ không dấu, số, dấu gạch), ví dụ `/r/006` hoặc `/r/nam-zalo`. Đổi mã không mất số liệu cũ, nhưng link mã cũ ngừng được tính.
- Kênh được nhận diện theo từng lượt bấm: Zalo, Facebook, Messenger, TikTok, Instagram (trình duyệt trong app) và Google, Facebook web (trang giới thiệu). Không nhận diện được thì ghi **Khác**.
- Mã QR, tờ rơi: dùng `/r/<mã>/qr`. Có thể ép kênh bằng đuôi `/zalo`, `/fb`, `/messenger`, `/tiktok`, `/ig`, `/google`.
- **Tổng quan** có bảng **Nhân viên theo từng kênh**. Ô **Tìm link** lọc theo mã, tên nhân viên hoặc kênh.

## Kiểm thử

```bash
node --test "tests/*.test.js"
```

Test tự chạy server riêng trên cổng 3970–3999 với dữ liệu tạm, không đụng `data/`.

Tài khoản admin local: ghi trong file `*.local.md` trên máy (đã nằm trong `.gitignore`), không ghi vào README.