# Triển khai Hello DANAVA lên cPanel (hello.danava.vn)

Ứng dụng chạy bằng **Setup Node.js App** của cPanel (Phusion Passenger). Không cần `npm install`: dự án không có thư viện ngoài.

Trong hướng dẫn, `<user>` là tên tài khoản cPanel của bạn (xem góc phải cPanel hoặc đường dẫn `/home/<user>`).

## Thông tin server (cho cả nhóm)

| Mục | Giá trị |
|---|---|
| Tên miền | `https://hello.danava.vn` (quản trị: `/admin`) |
| Hosting | cPanel, **Setup Node.js App** (CloudLinux / Passenger), Node 24 |
| Thư mục code trên server | `/home/<user>/hellodanava` (clone từ GitHub, nhánh `main`) |
| Thư mục dữ liệu | `/home/<user>/hellodanava-data` (SQLite, **không** nằm trong git) |
| File khởi động | `app.cjs` |
| Biến môi trường | `DATA_DIR`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SECURE_COOKIES=1` (đặt trong Setup Node.js App, không ghi vào repo) |
| Log lỗi | `/home/<user>/hellodanava/stderr.log` |

Repo GitHub (giữ hai repo luôn giống nhau, cùng nhánh `main`):
- Tổ chức: `https://github.com/danava-org/DANAVA_Hello.git`
- Cá nhân (server đang kéo code từ đây): `https://github.com/HungNguyen3205/hellodanava.git`

Tài khoản cPanel, mật khẩu admin và dữ liệu khách **không** lưu trong repo. Xin người quản lý server cấp riêng.

## Cách nhanh: Terminal của cPanel

Điều kiện: tên miền `hello.danava.vn` đã được tạo trong **Domains**, và bản ghi DNS `hello` đã trỏ về IP của server cPanel.

**Cài lần đầu.** Thay email và mật khẩu thật (12–128 ký tự). Không ghi mật khẩu vào repo:
```bash
cd ~ && git clone https://github.com/HungNguyen3205/hellodanava.git
ADMIN_EMAIL='admin@danava.vn' ADMIN_PASSWORD='mat-khau-cua-ban' bash ~/hellodanava/deploy.sh
```

**Cập nhật bản mới** (sau khi code đã lên nhánh `main` trên GitHub):
```bash
bash ~/hellodanava/deploy.sh
```

Script tự làm các việc sau:
- kiểm tra phiên bản Node;
- kéo code mới về;
- tạo app nếu chưa có, còn nếu đã có thì giữ nguyên cấu hình và dữ liệu, chỉ khởi động lại;
- xin SSL nếu chưa có chứng chỉ;
- kiểm tra trang qua `https://hello.danava.vn`.

Các mục 0–4 bên dưới là cách làm tương đương trên giao diện cPanel.

## 0. Kiểm tra trước

1. cPanel → **Setup Node.js App** → **Create Application** → mở danh sách **Node.js version**.
   - Cần **Node 24** (khuyến nghị) hoặc tối thiểu **22.13**. Dự án dùng SQLite có sẵn trong Node (`node:sqlite`).
   - Nếu danh sách chỉ có từ 22.12 trở xuống thì app **không chạy được**. Nhờ nhà cung cấp hosting bật Node 24 trước.
2. Server lấy code từ nhánh `main` trên GitHub.

## 1. Đưa code lên server (chọn một cách)

> Đặt code **ngoài** thư mục `/hello.danava.vn` (document root), vì thư mục đó do cPanel quản lý.
> Thư mục dữ liệu cũng phải ở ngoài, để không ai tải được file database qua web.

**Cách A — Git (khuyến nghị, cập nhật nhanh):**
cPanel → **Git™ Version Control** → **Create**
- Clone URL: `https://github.com/HungNguyen3205/hellodanava.git`
- Repository Path: `/home/<user>/hellodanava`
- Repository Name: `hellodanava` → **Create**. Sau đó vào **Manage** và chọn nhánh `main`.

**Cách B — Upload file zip:**
Trên máy, tại thư mục dự án, chạy:
```bash
git archive --format=zip -o hellodanava.zip HEAD
```
cPanel → **File Manager** → tạo thư mục `/home/<user>/hellodanava` → **Upload** file zip → **Extract**.
(File zip chỉ chứa code đã commit, không có `data/`, `.env`, `tests/` hay file ghi chú mật khẩu `*.local.md`.)

## 2. Tạo ứng dụng Node

cPanel → **Setup Node.js App** → **Create Application**:

| Ô | Giá trị |
|---|---|
| Node.js version | 24.x (hoặc ≥ 22.13) |
| Application mode | Production |
| Application root | `hellodanava` |
| Application URL | `hello.danava.vn` (để trống phần đường dẫn phía sau) |
| Application startup file | `app.cjs` |

Mục **Environment variables** → **Add Variable** cho từng dòng:

| Tên | Giá trị | Ghi chú |
|---|---|---|
| `DATA_DIR` | `/home/<user>/hellodanava-data` | Database nằm ở đây. Không đặt trong `public_html` hay `/hello.danava.vn`. |
| `ADMIN_EMAIL` | email admin thật | Chỉ dùng ở **lần chạy đầu** để tạo tài khoản admin. |
| `ADMIN_PASSWORD` | mật khẩu 12–128 ký tự | Đặt mật khẩu mạnh, **khác** mật khẩu local. Đăng nhập xong có thể đổi trong tab Tài khoản. |
| `SECURE_COOKIES` | `1` | Bắt buộc khi chạy HTTPS. |

Bấm **Create**, rồi **Start App** (hoặc **Restart**).

> Không cần bấm **Run NPM Install**: dự án không có thư viện ngoài.
> Thiếu `ADMIN_EMAIL` hoặc `ADMIN_PASSWORD` ở lần chạy đầu thì app dừng và báo
> "Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD…".

## 3. Bật HTTPS

1. cPanel → **SSL/TLS Status** → chọn `hello.danava.vn` → **Run AutoSSL**. Chờ có chứng chỉ (biểu tượng khóa xanh).
2. cPanel → **Domains** → dòng `hello.danava.vn` → bật **Force HTTPS Redirect**.
3. Nên bật nén: cPanel → **Optimize Website** → **Compress All Content** (giúp thư viện 3D khoảng 690KB tải nhanh hơn).

## 4. Kiểm tra sau khi chạy

1. Mở `https://hello.danava.vn` → thấy trang báo giá và mô hình 3D.
2. Mở `https://hello.danava.vn/admin` → đăng nhập bằng `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Tab **Link nhân viên** → tạo nhân viên → cấp link → đặt mã (ví dụ `006`) → mở `https://hello.danava.vn/r/006` → phải chuyển về trang chủ với `?ref=006`.
4. Tab **Tổng quan** → thấy lượt truy cập vừa mở.

## 5. Cập nhật phiên bản mới

- **Nhanh nhất:** Terminal → `bash ~/hellodanava/deploy.sh`, tự kéo code và khởi động lại.
- Nếu `deploy.sh` trên server là bản cũ, kéo code trước rồi chạy: `cd ~/hellodanava && git pull --ff-only && bash deploy.sh`.
- **Cách A (Git):** cPanel → **Git Version Control** → **Manage** → tab **Pull or Deploy** → **Update from Remote**.
- **Cách B (zip):** upload và giải nén đè lên `/home/<user>/hellodanava`.

Sau đó vào **Setup Node.js App** → **Restart**. Dữ liệu trong `DATA_DIR` được giữ nguyên.

## 6. Sao lưu

- Dữ liệu chỉ nằm trong `/home/<user>/hellodanava-data` (`studio.sqlite`, `studio.sqlite-wal`, `studio.sqlite-shm`).
- Cách an toàn nhất: **Stop App** → nén cả thư mục `hellodanava-data` → tải về → **Start App**.
- Hoặc dùng cPanel → **Backup** (sao lưu toàn bộ thư mục home).

## 7. Lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| Trang báo lỗi 503 / "Incomplete response" | Xem log: Setup Node.js App → mở app → file `stderr.log` trong thư mục app (hoặc **Errors** trong cPanel). |
| Log có `No such built-in module: node:sqlite` | Phiên bản Node quá cũ. Chọn Node 24 (hoặc ≥ 22.13). |
| Log có `ERR_REQUIRE_ESM` | Startup file phải là `app.cjs`, không phải `backend/server.js`. |
| App dừng với "Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD…" | Thiếu biến môi trường ở lần chạy đầu, hoặc mật khẩu ngắn hơn 12 ký tự. |
| Đăng nhập xong bị đăng xuất ngay | Đang mở bằng `http://`. Bật Force HTTPS Redirect (cookie có cờ `Secure`). |
| Khách bị báo "Vui lòng thử lại sau" dù ít truy cập | Giới hạn tần suất đang tính chung một IP cho mọi khách. Thử thêm biến `TRUST_PROXY=1` rồi Restart. Nếu vẫn bị thì báo lại để kiểm tra IP mà hosting chuyển vào. |
