/**
 * drive.js – Lấy danh sách ảnh từ Google Drive folder công khai
 * Yêu cầu: Folder phải share "Anyone with the link"
 */

const Drive = {
  /**
   * Trích xuất Folder ID từ nhiều dạng link Google Drive
   */
  extractFolderId(url) {
    if (!url) return null;
    // Các dạng phổ biến:
    // https://drive.google.com/drive/folders/FOLDER_ID
    // https://drive.google.com/drive/u/0/folders/FOLDER_ID
    // https://drive.google.com/open?id=FOLDER_ID
    const patterns = [
      /\/folders\/([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m && m[1]) return m[1];
    }
    // Nếu người dùng chỉ dán ID thuần
    if (/^[a-zA-Z0-9_-]{10,}$/.test(url.trim())) {
      return url.trim();
    }
    return null;
  },

  /**
   * Lấy danh sách ảnh trong folder (hỗ trợ phân trang)
   * @returns {Promise<Array<{id, name, url, thumb}>>}
   */
  async listImages(folderId, apiKey) {
    if (!folderId || !apiKey) {
      throw new Error('Thiếu Folder ID hoặc API Key');
    }

    const images = [];
    let pageToken = null;
    const maxPages = 20; // giới hạn an toàn (~2000 ảnh)
    let page = 0;

    do {
      page++;
      if (page > maxPages) break;

      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      let url = `https://www.googleapis.com/drive/v3/files?q=${q}` +
                `&fields=nextPageToken,files(id,name,mimeType,thumbnailLink,webContentLink)` +
                `&pageSize=100` +
                `&key=${apiKey}`;

      if (pageToken) url += `&pageToken=${pageToken}`;

      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const files = data.files || [];

      for (const f of files) {
        if (f.mimeType && f.mimeType.startsWith('image/')) {
          // Ưu tiên thumbnail (nhanh), fallback sang direct view
          const thumb = f.thumbnailLink
            ? f.thumbnailLink.replace(/=s\d+$/, '=s1920') // tăng kích thước thumbnail
            : null;

          const direct = `https://drive.google.com/uc?export=view&id=${f.id}`;

          images.push({
            id: f.id,
            name: f.name || f.id,
            url: thumb || direct,
            direct: direct
          });
        }
      }

      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return images;
  },

  /**
   * Preload một ảnh (trả về Promise)
   */
  preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => reject(new Error('Load failed: ' + src));
      img.src = src;
      // Timeout 15s
      setTimeout(() => reject(new Error('Timeout')), 15000);
    });
  }
};
