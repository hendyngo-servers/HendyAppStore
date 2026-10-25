# Hướng dẫn Build & Deploy Hendy App Store trên Cloudflare Workers và Pages

Tài liệu này phân biệt hai cách triển khai có mục đích khác nhau. **Khuyến nghị dùng GitHub Actions để triển khai toàn bộ hệ thống production**, vì repository có nhiều Worker và tài nguyên cần tạo theo đúng thứ tự. Workers Builds phù hợp với một Worker độc lập.

## 1. Kiến trúc

- **Public Store**: giao diện tĩnh được xuất ra `dist/pages`, triển khai lên Cloudflare Pages.
- **Backend API Worker** (`hendy-app-store-api`): API, xác thực Cloudflare Access, D1, KV, R2, Queue và các endpoint quản trị.
- **Alert Notifier Worker** (`hendy-app-store-alerts`): nhận callback build có chữ ký HMAC.
- **Edge Router Worker** (`hendy-app-store-edge`): định tuyến public/Admin, thực thi kiểm tra Access trước khi trả tệp Admin.
- **D1 / KV / R2 / Queues**: dữ liệu metadata, cache cấu hình, artifact và hàng đợi build.

Quy trình production của GitHub Actions là:

`validate → test → build → kiểm tra token → provision resources → render IDs → dry-run Worker bundles → migrate D1 → deploy API → set secrets → deploy alert Worker → deploy Edge Router → deploy Pages → smoke test`

Mỗi bước remote cần tài khoản Cloudflare thật và API token đủ quyền. Kiểm tra CI thành công không tự nó chứng minh đã triển khai lên tài khoản Cloudflare.

## 2. Chuẩn bị GitHub

1. Mở repository: <https://github.com/hendyngo-servers/HendyAppStore>.
2. Vào **Settings → Secrets and variables → Actions**.
3. Tạo Environment tên `cloudflare-production` nếu workflow của repository đang yêu cầu environment này. Các secret được đặt ở cấp repository hoặc environment đều được, miễn đúng scope của workflow.
4. Thêm các giá trị bootstrap dưới đây.

| Tên | Loại | Bắt buộc? | Ghi chú |
|---|---|---:|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Có | API token Cloudflare đang hoạt động, có quyền tạo/cập nhật Workers và tài nguyên cần thiết |
| `CLOUDFLARE_ACCOUNT_ID` | Variable hoặc Secret | Có | Account ID 32 ký tự hex, không phải Zone ID |
| `CF_ACCESS_TEAM_DOMAIN` | Variable hoặc Secret | Để mở Admin | Host của Access team; có thể nhập hostname hoặc URL, ví dụ `team-name.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Variable hoặc Secret | Để mở Admin | AUD tag của ứng dụng Cloudflare Access |
| `CF_ACCESS_ADMIN_EMAILS` | Variable hoặc Secret | Để mở Admin | Danh sách email được phép quản trị, phân tách bằng dấu phẩy |

Access là nhóm **all-or-none**: nếu muốn dùng Admin thì phải thiết lập đủ cả ba giá trị `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_ADMIN_EMAILS`. Nếu để cả ba trống, workflow có thể triển khai Public Store, nhưng API quản trị chủ động từ chối truy cập cho đến khi Access được cấu hình.

Token chỉ xuất hiện một lần khi tạo. Không đặt token, mật khẩu, certificate hoặc key vào mã nguồn/commit. Xem tài liệu chính thức về [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) và [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/).

Các quyền account tối thiểu cần xem xét cho workflow này gồm:
- Workers Scripts Edit/quyền quản lý Worker cần để tạo và deploy Workers.
- Cloudflare Pages Write.
- D1 Edit.
- Workers KV Storage Edit.
- Workers R2 Storage Edit.
- Queues Edit.
- Quyền account cần thiết để thiết lập/đọc workers.dev subdomain nếu tài khoản chưa có subdomain.

Chỉ cấp các quyền cần thiết trên đúng account. Nếu Cloudflare báo thiếu quyền ở một endpoint, kiểm tra tên quyền được ghi trong thông báo; không chia sẻ token để người khác chẩn đoán.

## 3. Triển khai toàn bộ full-stack (khuyến nghị)

### Bước 1 — Kiểm tra CI trước

Mở **Actions → Hendy App Store CI** hoặc chạy trực tiếp:

```bash
npm install --no-audit --no-fund
npm run validate
npm test
npm run build
```

Workflow CI cũng dựng ID D1/KV giả lập hợp lệ về định dạng rồi chạy `wrangler deploy --dry-run` trên bốn config Worker. Đây là kiểm tra build/configuration; nó không tạo tài nguyên trên Cloudflare.

### Bước 2 — Chạy deployment workflow

Mở <https://github.com/hendyngo-servers/HendyAppStore/actions/workflows/deploy-cloudflare.yml> → **Run workflow** → nhánh `main`.

Workflow sẽ:
1. Kiểm tra token và Account ID.
2. Tạo hoặc dùng lại R2 bucket, Pages project, D1 database, KV namespace và Queues.
3. Render các ID vào Wrangler configs trong môi trường CI, không commit ID runtime vào repository.
4. Chạy D1 schema.
5. Triển khai API trước, rồi cấu hình secrets runtime.
6. Triển khai Alert Notifier, sau đó Edge Router với service binding tới API đã tồn tại.
7. Build/triển khai Public Pages với URL API và Admin thực tế.
8. Gọi health endpoint và kiểm tra catalog/config của trang.

Mở phần **Deployment summary** ở cuối run để lấy URL thực tế do Cloudflare trả về. Đừng đoán hoặc tự ghép hostname nếu workflow chưa báo thành công.

### Bước 3 — Cấu hình Cloudflare Access cho Admin

Sau khi các Worker đã được triển khai:
1. Trong Cloudflare Zero Trust, tạo Access application/policy tương ứng với hostname dùng cho Edge/Admin.
2. Chỉ cho phép identity/email quản trị được phê duyệt.
3. Lấy AUD tag của Access application, hostname của Access team và danh sách email quản trị.
4. Thêm/cập nhật ba giá trị `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_ADMIN_EMAILS` trong GitHub Actions Secrets/Variables.
5. Chạy lại workflow deploy để đồng bộ các giá trị vào Backend API Worker.
6. Kiểm tra đường dẫn Admin sau khi đăng nhập qua Access. Nếu chưa thiết lập Access, phản hồi 401/403/503 là hành vi từ chối có chủ đích, không phải lý do để bỏ lớp bảo vệ.

### Bước 4 — Kiểm tra sau deploy

Trong Deployment summary xác nhận cả các URL Public Store, Edge Router và API đã được in ra. Có thể kiểm tra health endpoint trên hostname đã được workflow trả về:

```bash
curl -i https://<api-worker-hostname>/api/health
curl -i https://<edge-worker-hostname>/healthz
curl -i https://<pages-hostname>/
curl -i https://<pages-hostname>/config.js
```

API/Edge health phải báo trạng thái healthy, Pages trả HTML, và `config.js` phải trỏ tới API Worker thực tế. Sau đó kiểm tra trang Admin qua Access, catalog, tải xuống và các chức năng upload/build tùy theo bindings/secrets đã cấu hình.

## 4. Dùng Cloudflare Workers Builds để triển khai một Worker độc lập

Root `wrangler.toml` là **bootstrap config** cho Worker Builds có tên `hendyappstore`. Nó không có service binding tới Backend API, vì vậy tránh lỗi `Service binding ... Worker ... was not found` khi API chưa tồn tại.

Trong Cloudflare Dashboard → **Workers & Pages → hendyappstore → Settings → Builds**:
- Repository: `hendyngo-servers/HendyAppStore`.
- Production branch: `main`.
- Root directory: thư mục gốc repository (để trống hoặc `/`, theo giao diện).
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Node.js: 22+ (Node 22 hoặc môi trường Node 24 hiện tại đều đáp ứng `engines.node >=22`).

Đây là một Worker độc lập, không thay thế deployment workflow đầy đủ: root config không có binding `BACKEND_API`, nên API/Admin không thể hoạt động đầy đủ ở chế độ bootstrap. Để triển khai toàn bộ ứng dụng, dùng mục 3.

Nếu muốn để GitHub Actions làm nguồn triển khai duy nhất, hãy tắt Workers Builds auto-deploy cho cấu hình bootstrap (hoặc coi `hendyappstore` là Worker thử nghiệm độc lập). Không nên đồng thời cho nhiều hệ thống tự động cùng deploy lên **cùng một Worker/Pages project** vì có thể ghi đè phiên bản hoặc tạo ra trạng thái khó xác định.

## 5. Triển khai Public Pages độc lập qua Dashboard (chỉ khi không dùng Pages deploy trong workflow)

Pages project của workflow đã được cấu hình để deploy qua Wrangler; không bật thêm Git integration cho cùng project trong lúc workflow cũng phát hành nó. Nếu muốn Pages Git integration là phương thức riêng, dùng một Pages project riêng để tránh tranh chấp deployment.

Với một Pages project riêng:
- Build command: `npm run build`.
- Build output directory: `dist/pages`.
- Root directory: repository root.
- Environment variables tùy chọn:
  - `HENDY_API_BASE_URL`: origin HTTPS của API Worker, không kèm path `/api`.
  - `HENDY_EDGE_BASE_URL`: origin HTTPS của Edge Worker, không kèm path `/admin`.
- Nếu tùy chọn này khác origin của API, thêm chính xác hostname Pages vào `ALLOWED_ORIGINS` của Backend API để CORS chỉ cho phép các trang đáng tin cậy.

## 6. Xử lý lỗi phổ biến

| Lỗi/log | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `assets.not_found_handling ... got "404"` | Giá trị enum Wrangler không hợp lệ | Root config hiện dùng `none`; không đổi thành `404`. Các giá trị hợp lệ gồm `single-page-application`, `404-page`, `none`. |
| `Worker name ... expected hendyappstore` | Tên trong config không khớp tên dự án Workers Builds | Root config đặt `name = "hendyappstore"`; pull commit mới nhất và build lại. |
| `Service binding ... hendy-app-store-api ... not found` | Deploy Edge Router trước API hoặc dùng integrated config trong lần bootstrap đầu | Dùng root `wrangler.toml` cho bootstrap; production workflow deploy API trước `workers/edge-router/wrangler.toml`. |
| `Set CLOUDFLARE_API_TOKEN` | GitHub Secret không tồn tại, đặt sai Environment, hoặc workflow không đọc được secret | Thêm secret đúng cấp và kiểm tra Environment `cloudflare-production`. Không đưa token vào log. |
| `CLOUDFLARE_ACCOUNT_ID must be 32 hex characters` | Nhập Zone ID/URL/giá trị sai | Dùng Account ID 32 ký tự hex. |
| `Authentication error` / API 403 | Token sai hoặc thiếu quyền cho API endpoint | Kiểm tra trạng thái token và đúng account/resource permissions. |
| `Pages project name already exists` | Tên Pages đã được sử dụng hoặc subdomain không khả dụng toàn cầu | Provision script sẽ thử tên fallback theo Account ID; lấy hostname chính xác từ Deployment summary. |
| Admin trả 401/403/503 | Access chưa đăng nhập, AUD/email không khớp hoặc Access secrets chưa cấu hình | Cấu hình Access app/policy và đủ ba giá trị Access; không vô hiệu hóa xác thực. |
| Build thành công nhưng Pages không gọi được API | `config.js` còn dùng same-origin, API URL sai, hoặc CORS chưa cho phép Pages origin | Dùng config sinh từ production workflow hoặc đặt `HENDY_API_BASE_URL`, `HENDY_EDGE_BASE_URL` và `ALLOWED_ORIGINS` đúng. |

## 7. Những gì “thành công” có nghĩa

- **Install thành công**: dependency được cài.
- **Build thành công**: UI bundle và Pages output được tạo.
- **Dry-run thành công**: Wrangler phân tích/đóng gói Worker config, nhưng chưa deploy từ xa.
- **Deploy thành công**: Cloudflare chấp nhận phát hành từng Worker/Pages.
- **Full-stack thành công**: smoke test đạt; API, Edge, Pages và config runtime đều phản hồi đúng. Admin chỉ được chia sẻ sau khi Access policy được thiết lập và kiểm tra.

Tài liệu chính thức:
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Pages monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
