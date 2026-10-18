# Hiển thị giới hạn sử dụng trong 9router

![Danh sách tài khoản Codex và quota còn lại](https://raw.githubusercontent.com/hgn389/Display-usage-limits-in-9router/main/images/OpenAI%20Codex%201.jpg)

![Giao diện dashboard OpenAI Codex](https://raw.githubusercontent.com/hgn389/Display-usage-limits-in-9router/main/images/OpenAI%20Codex.png)

Phiên bản **v1.0.0** · [English](Readme.md) · [Hướng dẫn cài chi tiết](INSTALL.txt)

Bổ sung quota Codex và ghi chú quản trị vào trang gốc của 9router:
`/dashboard/providers/codex`. Không cần cài tiện ích trình duyệt hoặc đổi cổng dashboard.

## Tính năng

- Thanh **Weekly** bên trái, **5h** ở giữa và **End date:** bên phải.
- Hiện phần trăm còn lại, đếm ngược reset và giờ reset cho 5h. Rê chuột để xem đầy đủ ngày giờ theo múi giờ trình duyệt.
- Tự cập nhật khoảng **30 giây/lần** khi tab Codex hiển thị, tối đa hai request quota đồng thời. Tab ẩn sẽ tạm dừng; quay lại sẽ cập nhật nếu đã đến hạn.
- End date là **ghi chú text tự do**, ví dụ `ngày 24 hết gói Plus`. Nhấn nút bút trong ô vuông để sửa. Bấm **Save**, Enter hoặc nhấp ra ngoài để lưu; Escape để hủy. Không kiểm tra ngày và không tự vô hiệu hóa tài khoản.
- Ghi chú lưu trong file **`data/package-expiry.json`** riêng của addon, theo ID kết nối. Addon không cần SQLite hay database.
- Nút **Check Update** dưới End date kiểm tra bản Release đã công bố trên GitHub. Có bản mới hợp lệ sẽ hiện **Install update vX.Y.Z**; chỉ cài khi người quản trị bấm nút.

Dữ liệu quota thiếu sẽ hiện unavailable, không đoán thành 0% hoặc 100%. Đọc quota
chỉ dùng API usage sẵn có, không gửi prompt đến model hoặc đổi reset credit.
9router có thể tự làm mới OAuth nội bộ khi đọc quota.

## Yêu cầu

- Node.js **22+**, Git và 9router đã chạy.
- Phần gắn giao diện được phát triển theo **9router 0.5.99**. Đường dẫn mặc định của bản cài global là `/usr/lib/node_modules/9router/app`; có thể truyền đường dẫn khác cho công cụ cài.
- Quyền ghi một file JavaScript giao diện trong package đã cài. Không cần restart 9router, đổi cổng inference hoặc sửa database 9router.
- Trình duyệt phải truy cập được dịch vụ addon cổng **9092**, cùng hostname với dashboard. Cấu hình hiện tại dùng HTTP trong mạng tin cậy; HTTPS/TLS cần cấu hình tích hợp riêng.

### Dashboard dùng cổng tùy chỉnh

Addon không tự dò cổng dashboard. Dashboard chạy ở cổng khác, ví dụ **20128**,
vẫn dùng được nếu cấu hình dịch vụ addon đúng origin đó và đúng cổng 9router nội
bộ; trình duyệt đồng thời phải truy cập được API addon ở cổng **9092** cùng
hostname với dashboard. Ví dụ 9router lắng nghe nội bộ ở cổng 20128:

```sh
HOST=192.168.1.10 PORT=9092 DASHBOARD_ORIGIN=http://192.168.1.10:20128 UPSTREAM=http://127.0.0.1:20128 node service.mjs
```

Thay địa chỉ ví dụ bằng địa chỉ server của bạn và đặt cùng cấu hình trong trình
quản lý dịch vụ/tường lửa. Cổng dashboard và cổng API addon riêng biệt; đổi cổng
dashboard không tự chuyển API addon khỏi cổng 9092.

## Cài trên dashboard gốc

Sau khi mã nguồn được công bố, clone vào thư mục riêng, không đặt trong package 9router:

```sh
git clone https://github.com/hgn389/Display-usage-limits-in-9router.git
cd Display-usage-limits-in-9router
node --version
node native-ui.mjs prepare
node native-ui.mjs apply
HOST=127.0.0.1 PORT=9092 DASHBOARD_ORIGIN=http://127.0.0.1:9090 node service.mjs
```

Runtime chỉ dùng thư viện sẵn có của Node.js, không cần `npm install` để chạy.
Nếu app 9router nằm ở chỗ khác, truyền đường dẫn đó sau lệnh `prepare` và `apply`,
đồng thời đặt biến `ROUTER_APP_DIR` cho dịch vụ addon trước khi dùng chức năng cài update.
`prepare` sao lưu file giao diện gốc vào `.native-ui/`; `apply` áp dụng bản vá.
Công cụ từ chối ghi đè khi file cài đặt đã thay đổi ngoài dự kiến.

Nếu mở từ máy khác, thay `HOST` bằng địa chỉ LAN của server và `DASHBOARD_ORIGIN`
bằng **đúng origin** đang mở, gồm giao thức, hostname và cổng. `localhost` là máy
đang dùng nó, không tự trỏ về server. Nếu có tường lửa, cho phép TCP **9092** chỉ
từ mạng client tin cậy. Client dùng cùng hostname với dashboard và cổng 9092;
không tự đổi riêng cổng dịch vụ. Giữ inference và tunnel ở endpoint gateway hiện có.

Mở dashboard gốc, đăng nhập bình thường rồi **Ctrl+F5 hoặc xóa cache trình duyệt**.
9router đánh dấu cache JavaScript rất lâu nên trình duyệt có thể giữ giao diện cũ.
Sao lưu riêng `.native-ui/` và file ghi chú; không đưa chúng vào Git.

## Chạy lâu dài

`node service.mjs` chỉ giám sát dịch vụ addon và nạp lại dịch vụ này sau khi update
thành công. Nó không restart 9router. Lệnh chạy foreground không tự cấu hình chạy
sau reboot. Xem ví dụ systemd trong `INSTALL.txt`. Unit systemd dạng transient
không đồng nghĩa đã bật khởi động sau reboot.

| Biến | Mặc định | Công dụng |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Địa chỉ lắng nghe của addon |
| `PORT` | `9092` | Cổng API ghi chú/update; client gốc dùng 9092 |
| `DASHBOARD_ORIGIN` | `http://127.0.0.1:9090` | Origin trình duyệt được phép |
| `UPSTREAM` | `http://127.0.0.1:9090` | HTTP 9router nội bộ để kiểm tra đăng nhập |
| `DATA_DIR` | `data` cạnh mã addon | Thư mục ghi chú |
| `ROUTER_APP_DIR` | `/usr/lib/node_modules/9router/app` | Thư mục app cài đặt để cập nhật bản vá |

API yêu cầu phiên quản trị HttpOnly hiện có. Ghi dữ liệu cần đúng Origin và header
addon. Không ghi cookie, token hoặc thông tin đăng nhập vào source, gói update hay log.

## Kiểm tra và cài cập nhật

Bấm **Check Update** dưới End date. Khi chưa có Release ổn định, nút báo
**No published releases yet**. Commit thông thường, tag chưa có Release, bản nháp
và prerelease không được cài. Kết quả kiểm tra được cache 60 giây; cập nhật quota
không tự gọi kiểm tra phiên bản GitHub.

Release cần đính kèm `9router-addon-vX.Y.Z.json`, tạo bằng `npm run build:release`.
Installer kiểm tra digest từ GitHub và SHA-256 từng file, giới hạn danh sách file
được thay thế, từ chối hạ phiên bản hoặc ghi đè source đã sửa riêng. Source cũ lưu
trong `.updates/`. Không chạy npm lifecycle script, sửa lịch sử Git hay chạm database.
Nếu kiểm tra hoặc áp dụng giao diện thất bại, source addon được hoàn tác.
File ghi chú và `.native-ui/` được giữ nguyên. Server cần truy cập được GitHub.

Sau khi cài, chỉ dịch vụ addon được nạp lại; 9router vẫn chạy. Tải lại trang và xóa
cache nếu cần. Update trong giao diện có thể làm working tree khác Git HEAD;
các lần cập nhật sau đối chiếu checksum của lần cài thành công gần nhất.

Hoàn tác giao diện gốc:

```sh
node native-ui.mjs restore
```

Công cụ chỉ hoàn tác nếu file hiện có đúng bản addon dự kiến. Cập nhật 9router
có thể ghi đè bản vá; không chép file cũ đè lên package mới. Hãy lưu trữ backup
`.native-ui/` cũ rồi chuẩn bị backup mới theo phiên bản mới. Khi gỡ addon chỉ dừng
dịch vụ addon, không dừng 9router.

### Sau khi nâng cấp 9router

Bản vá giao diện native nằm trong một file JavaScript của package 9router đã cài.
Nâng cấp 9router có thể thay file này, khiến thanh quota và ghi chú tạm thời biến
mất cho tới khi áp dụng lại bản vá. Mã nguồn addon, file ghi chú trong `data/` và
dịch vụ addon được lưu riêng nên không cần cài lại addon. Sau khi nâng cấp, sao
lưu `.native-ui/`, rồi chuẩn bị và áp dụng bản vá cho package mới:

```sh
cp -a .native-ui .native-ui-before-router-upgrade
node native-ui.mjs prepare
node native-ui.mjs apply
```

Nếu lúc cài ban đầu bạn truyền đường dẫn app riêng, hãy dùng lại đúng đường dẫn
đó. Nếu `prepare` báo giao diện provider không nhận diện được, phiên bản 9router
mới đã đổi cấu trúc trang; hãy chờ addon hỗ trợ phiên bản đó, không khôi phục file
giao diện cũ. Sau khi áp dụng, tải mạnh lại dashboard hoặc xóa cache.

## Phát triển và chuẩn bị phát hành

```sh
npm ci --ignore-scripts
npm test
npm run build:release
```

Test dùng tài khoản giả, upstream giả và file tách riêng; có kiểm tra ghi chú,
gắn DOM, kiểm tra gói update và hoàn tác. Vẫn cần kiểm tra trình duyệt đã đăng nhập
sau khi cài. Nếu UI/API hoặc ngôn ngữ giao diện 9router thay đổi có thể phải sửa addon;
dòng tài khoản không khớp duy nhất sẽ được bỏ qua để tránh gán nhầm quota.

Gói ở `dist/` chỉ chứa runtime và tài liệu, không có ghi chú, thông tin đăng nhập,
file 9router đã cài, metadata Git hay đường dẫn riêng của máy. Build từ source đã
kiểm tra. Chỉ khi người quản trị cho phép mới push nhánh đã duyệt, tạo tag ổn định
trùng phiên bản và đính kèm JSON vào GitHub Release. Updater tin các Release do
maintainer của repository công bố; chỉ phát hành code đã kiểm tra.
Build local không tự upload hoặc phát hành.

Các chế độ userscript/proxy cũ vẫn được giữ trong `INSTALL.txt`; nơi lưu ngày của
chúng tách riêng với ghi chú ở chế độ native.

Giấy phép: [MIT](LICENSE).
