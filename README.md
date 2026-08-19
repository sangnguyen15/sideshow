# Family Photo Slideshow – Google Drive

Web app chiếu slideshow ảnh gia đình từ nhiều folder Google Drive đã share.  
Tối ưu cho Android TV Box, chạy mượt, preload thông minh, hỗ trợ nhiều tỷ lệ màn hình.

## Tính năng chính

- Thêm nhiều link folder Google Drive (Anyone with the link)
- Chiếu lần lượt theo từng folder
- Preload 2–3 ảnh phía trước → không bị trắng màn hình
- Double buffering + nhiều hiệu ứng nhẹ (Fade, Slide, Zoom, Ken Burns, Push…)
- Tách riêng thời gian hiển thị ảnh và thời gian hiệu ứng chuyển
- **Khi ảnh đứng yên: ưu tiên full ảnh (không cắt nội dung)** – Hướng A
- Trong lúc chuyển cảnh vẫn có hiệu ứng động
- Tự ẩn giao diện sau X giây không tương tác
- Lưu vị trí chiếu → mở lại tiếp tục đúng chỗ
- Giảm chiếu trùng ảnh gần đây
- Chạy tĩnh trên GitHub Pages, không cần server / database

## Cách sử dụng nhanh

### 1. Tạo Google Drive API Key (bắt buộc)

1. Vào [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới (hoặc chọn project có sẵn)
3. Vào **APIs & Services → Library** → tìm **Google Drive API** → Enable
4. Vào **APIs & Services → Credentials** → **Create Credentials → API Key**
5. (Khuyến nghị) Restrict key chỉ cho Google Drive API
6. Copy API Key và dán vào web app

### 2. Share folder ảnh

- Mở folder trên Google Drive
- Share → **Anyone with the link** → Viewer
- Copy link folder

### 3. Chạy web app

- Mở trang web (GitHub Pages hoặc mở file `index.html` local)
- Dán API Key → Lưu
- Dán link folder → Thêm
- Chỉnh thời gian / hiệu ứng / tỷ lệ màn hình
- Bấm **Bắt đầu chiếu** hoặc **Tiếp tục từ vị trí cũ**

## Cài đặt trên Android TV Box (khuyến nghị)

1. Cài **Fully Kiosk Browser**
2. Đặt Start URL = link GitHub Pages của bạn
3. Bật các tùy chọn:
   - Fullscreen Mode
   - Keep Screen On
   - Keep Screen On while in Fullscreen Mode
   - Launch on Boot
4. Trong hệ thống Android TV:
   - Screen saver = None / Never
   - Developer options → Stay awake = ON

## Cấu trúc thư mục

```
google-drive-slideshow/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── storage.js      # localStorage
│   ├── drive.js        # Google Drive API
│   ├── slideshow.js    # Preload + double buffer + effects
│   └── app.js          # Giao diện + điều khiển
└── README.md
```

## Lưu ý quan trọng

- Folder **phải** share “Anyone with the link”, nếu không API Key sẽ không đọc được.
- API Key nên để mỗi người tự tạo (không dùng chung) để tránh vượt quota.
- Ảnh được lấy ở kích thước vừa phải (thumbnail s1920) để load nhanh trên TV Box.
- Dữ liệu nguồn + cài đặt + vị trí chiếu được lưu bằng localStorage trên trình duyệt.

## Phát triển tiếp (tùy chọn)

- Thêm nhạc nền
- Hỗ trợ Google Photos
- Xuất/nhập cấu hình
- Chế độ trộn tất cả folder

---

MIT License – Tự do sử dụng và chỉnh sửa.
