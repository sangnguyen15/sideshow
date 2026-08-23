# Family Photo Slideshow – Google Drive + Google Sheet

Web app chiếu slideshow ảnh gia đình.  
Cấu hình (API Key + danh sách folder) lấy từ **Google Sheet** qua **Google Apps Script**.

Tối ưu cho Android TV Box, preload thông minh, nhiều hiệu ứng, full ảnh khi đứng yên.

---

## Luồng hoạt động

```
Bạn sửa Google Sheet
        ↓
Google Apps Script (Web App) đọc Sheet → trả JSON
        ↓
Web App (GitHub Pages) gọi GAS → lấy apiKey + folder links
        ↓
Gọi Google Drive API lấy ảnh → chiếu slideshow
```

- Nhiều thiết bị cùng dùng 1 Sheet.
- Không nhập API Key trên giao diện.
- Bấm **Làm mới danh sách thư mục** → dừng và load lại từ đầu.

---

## Bước 1: Tạo Google Sheet

1. Tạo file Google Sheet mới.
2. Đổi tên 2 tab:

### Tab `Config`

| A (key)  | B (value)        |
|----------|------------------|
| api_key  | AIzaSy... (API Key của bạn) |

### Tab `Sources`

| A (name)         | B (link)                                         | C (enabled) | D (order) |
|------------------|--------------------------------------------------|-------------|-----------|
| Album gia đình   | https://drive.google.com/drive/folders/FOLDER_ID | TRUE        | 1         |
| Ảnh cưới         | https://drive.google.com/drive/folders/FOLDER_ID | TRUE        | 2         |

- `enabled = FALSE` → bỏ qua folder đó.
- Folder Drive phải share **Anyone with the link → Viewer**.

3. Copy **Sheet ID** từ URL:
   `https://docs.google.com/spreadsheets/d/SHEET_ID_Ở_ĐÂY/edit`

---

## Bước 2: Tạo Google Drive API Key

1. Vào [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project → Enable **Google Drive API**
3. Credentials → Create API Key
4. (Khuyến nghị) Restrict key chỉ cho Google Drive API
5. Dán API Key vào tab **Config** cột B

---

## Bước 3: Google Apps Script

1. Mở Sheet → **Extensions → Apps Script**
2. Xóa code mặc định, dán toàn bộ nội dung file `gas/Code.gs`
3. Sửa dòng:
   ```js
   var SHEET_ID = 'DÁN_SHEET_ID_VÀO_ĐÂY';
   ```
4. Lưu → **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorize → Copy **Web App URL**
   (dạng `https://script.google.com/macros/s/xxxxx/exec`)

---

## Bước 4: Cấu hình Web App

1. Mở file `js/config.js`
2. Dán URL GAS vào:
   ```js
   GAS_URL: 'https://script.google.com/macros/s/xxxxx/exec',
   ```
3. Đưa code lên GitHub → bật GitHub Pages  
   (hoặc mở `index.html` trực tiếp để test)

---

## Bước 5: Chạy

1. Mở trang web app
2. App tự gọi GAS → lấy danh sách folder + API Key → tải ảnh → **tự bắt đầu chiếu**
3. Muốn cập nhật folder mới từ Sheet → mở panel cài đặt → bấm **Làm mới danh sách thư mục**  
   (sẽ dừng và chiếu lại từ đầu với danh sách mới)

---

## Giao diện cài đặt

| Mục                              | Có hiện? | Ghi chú                          |
|----------------------------------|----------|----------------------------------|
| Danh sách thư mục ảnh            | Có       | Tên + số lượng ảnh               |
| Nút Làm mới danh sách thư mục    | Có       | Load lại từ Sheet, chiếu từ đầu  |
| Thời gian / hiệu ứng / full ảnh  | Có       | Lưu trên từng thiết bị           |
| API Key                          | Không    | Chỉ lấy từ Sheet                 |
| Link GAS / Sheet                 | Không    | Ghi trong code                   |

---

## Cài đặt trên Android TV Box

1. Cài Fully Kiosk Browser (hoặc trình duyệt hỗ trợ)
2. Start URL = link GitHub Pages
3. Bật: Fullscreen, Keep Screen On, Launch on Boot
4. Hệ thống: Screen saver = Never, Stay awake = ON

---

## Cấu trúc thư mục

```
google-drive-slideshow/
├── index.html
├── css/style.css
├── js/
│   ├── config.js       ← Dán GAS_URL ở đây
│   ├── storage.js
│   ├── drive.js
│   ├── slideshow.js
│   └── app.js
├── gas/
│   └── Code.gs         ← Code Google Apps Script
└── README.md
```

---

## Lưu ý

- Folder Drive phải share **Anyone with the link**.
- GAS Web App để **Anyone** thì web app mới gọi được.
- API Key nên restrict chỉ Drive API.
- Android 4.4: WebView rất cũ, nên dùng box Android 7+ hoặc cài trình duyệt mới hơn.

---

MIT License
