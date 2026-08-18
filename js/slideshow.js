/**
 * slideshow.js – Double buffering + preload 2-3 ảnh + chuyển folder mượt
 */

const Slideshow = {
  // State
  sources: [],          // [{id, name, link, photos: []}]
  currentSourceIndex: 0,
  currentPhotoIndex: 0,
  isPlaying: false,
  timer: null,
  settings: {},
  recentIds: new Set(),

  // Layers
  layerA: null,
  layerB: null,
  activeLayer: null,    // 'a' or 'b'
  preloadQueue: [],     // ảnh đã preload sẵn

  // Callbacks
  onStatus: null,
  onError: null,

  init(settings, onStatus, onError) {
    this.settings = settings;
    this.onStatus = onStatus;
    this.onError = onError;
    this.layerA = document.getElementById('layer-a');
    this.layerB = document.getElementById('layer-b');
    this.activeLayer = 'a';
    this.recentIds = new Set(Storage.getRecent());
  },

  /**
   * Nạp danh sách nguồn (đã có photos)
   */
  setSources(sources) {
    this.sources = sources.filter(s => s.photos && s.photos.length > 0);
  },

  /**
   * Bắt đầu chiếu từ đầu hoặc từ progress đã lưu
   */
  async start(resume = false) {
    if (this.sources.length === 0) {
      this.onError && this.onError('Chưa có nguồn ảnh nào');
      return;
    }

    this.stop();
    this.isPlaying = true;

    if (resume && this.settings.resume) {
      const progress = Storage.getProgress();
      if (progress && progress.sourceIndex < this.sources.length) {
        this.currentSourceIndex = progress.sourceIndex;
        this.currentPhotoIndex = Math.min(progress.photoIndex, this.sources[progress.sourceIndex].photos.length - 1);
      } else {
        this.currentSourceIndex = 0;
        this.currentPhotoIndex = 0;
      }
    } else {
      this.currentSourceIndex = 0;
      this.currentPhotoIndex = 0;
    }

    // Preload ảnh đầu tiên + 2 ảnh kế
    await this.prepareInitial();
    this.showCurrent();
    this.scheduleNext();
  },

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  /**
   * Chuẩn bị 2-3 ảnh đầu
   */
  async prepareInitial() {
    this.showLoading(true);
    this.preloadQueue = [];

    const needed = 3;
    for (let i = 0; i < needed; i++) {
      const photo = this.getPhotoAtOffset(i);
      if (!photo) break;
      try {
        await Drive.preloadImage(photo.url);
        this.preloadQueue.push(photo);
      } catch (e) {
        console.warn('Preload fail', photo.name, e);
      }
    }
    this.showLoading(false);
  },

  /**
   * Lấy ảnh theo offset so với vị trí hiện tại (xuyên folder)
   */
  getPhotoAtOffset(offset) {
    let sIdx = this.currentSourceIndex;
    let pIdx = this.currentPhotoIndex + offset;

    while (sIdx < this.sources.length) {
      const photos = this.sources[sIdx].photos;
      if (pIdx < photos.length) {
        return { ...photos[pIdx], sourceIndex: sIdx, photoIndex: pIdx };
      }
      pIdx -= photos.length;
      sIdx++;
    }

    // Quay lại đầu nếu cần
    if (this.sources.length > 0) {
      sIdx = 0;
      pIdx = pIdx % this.sources[0].photos.length;
      return { ...this.sources[0].photos[pIdx], sourceIndex: 0, photoIndex: pIdx };
    }
    return null;
  },

  /**
   * Hiển thị ảnh hiện tại lên layer active
   */
  showCurrent() {
    const photo = this.getPhotoAtOffset(0);
    if (!photo) return;

    const layer = this.activeLayer === 'a' ? this.layerA : this.layerB;
    const other = this.activeLayer === 'a' ? this.layerB : this.layerA;

    // Reset classes
    layer.className = 'slide-layer active fit-' + this.settings.fit;
    other.className = 'slide-layer next fit-' + this.settings.fit;

    // Apply background
    layer.style.backgroundImage = `url("${photo.url}")`;
    layer.style.opacity = '1';
    other.style.opacity = '0';

    // Effect
    if (this.settings.effect === 'kenburns') {
      layer.classList.add('kenburns-active');
    }

    // Lưu progress + recent
    Storage.saveProgress({
      sourceIndex: photo.sourceIndex,
      photoIndex: photo.photoIndex,
      timestamp: Date.now()
    });
    Storage.addRecent(photo.id);
    this.recentIds.add(photo.id);

    this.updateStatus(photo);
  },

  /**
   * Chuyển sang ảnh tiếp theo (mượt)
   */
  async next() {
    if (!this.isPlaying) return;

    // Tăng index
    this.currentPhotoIndex++;
    const currentSource = this.sources[this.currentSourceIndex];

    // Hết folder → chuyển folder
    if (this.currentPhotoIndex >= currentSource.photos.length) {
      this.currentSourceIndex++;
      this.currentPhotoIndex = 0;

      if (this.currentSourceIndex >= this.sources.length) {
        this.currentSourceIndex = 0; // loop
      }

      // Shuffle nếu bật
      if (this.settings.shuffle) {
        this.shuffleCurrentFolder();
      }
    }

    // Lấy layer đang ẩn
    const nextLayer = this.activeLayer === 'a' ? this.layerB : this.layerA;
    const currLayer = this.activeLayer === 'a' ? this.layerA : this.layerB;

    const photo = this.getPhotoAtOffset(0);
    if (!photo) {
      this.scheduleNext();
      return;
    }

    // Đảm bảo ảnh đã được preload, nếu chưa thì load ngay
    try {
      await Drive.preloadImage(photo.url);
    } catch (e) {
      console.warn('Next image load fail, skip', e);
      // Thử ảnh kế nữa
      this.currentPhotoIndex++;
      this.scheduleNext(500);
      return;
    }

    // Chuẩn bị layer ẩn
    nextLayer.className = 'slide-layer next fit-' + this.settings.fit;
    nextLayer.style.backgroundImage = `url("${photo.url}")`;
    nextLayer.style.opacity = '0';
    nextLayer.style.transform = '';

    // Hiệu ứng
    const effect = this.settings.effect;

    if (effect === 'fade' || effect === 'kenburns') {
      nextLayer.style.transition = 'opacity 1.1s ease';
      currLayer.style.transition = 'opacity 1.1s ease';
      nextLayer.style.opacity = '1';
      currLayer.style.opacity = '0';
      nextLayer.classList.add('active');
      if (effect === 'kenburns') {
        nextLayer.classList.add('kenburns-active');
      }
    } else if (effect === 'slide') {
      nextLayer.style.transition = 'transform 0.9s ease, opacity 0.9s ease';
      nextLayer.style.transform = 'translateX(100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(-30%)';
        currLayer.style.opacity = '0';
      });
    } else if (effect === 'zoom') {
      nextLayer.style.transition = 'opacity 1s ease, transform 1s ease';
      nextLayer.style.transform = 'scale(1.15)';
      nextLayer.style.opacity = '0';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
      });
    }

    // Đổi active
    this.activeLayer = this.activeLayer === 'a' ? 'b' : 'a';

    // Lưu progress
    Storage.saveProgress({
      sourceIndex: photo.sourceIndex,
      photoIndex: photo.photoIndex,
      timestamp: Date.now()
    });
    Storage.addRecent(photo.id);

    this.updateStatus(photo);

    // Preload thêm 2 ảnh phía trước
    this.preloadAhead();

    this.scheduleNext();
  },

  /**
   * Preload 2-3 ảnh phía trước (kể cả folder kế)
   */
  async preloadAhead() {
    for (let i = 1; i <= 3; i++) {
      const photo = this.getPhotoAtOffset(i);
      if (photo) {
        Drive.preloadImage(photo.url).catch(() => {});
      }
    }
  },

  scheduleNext(delay) {
    if (this.timer) clearTimeout(this.timer);
    const ms = (delay || this.settings.duration * 1000);
    this.timer = setTimeout(() => this.next(), ms);
  },

  shuffleCurrentFolder() {
    const folder = this.sources[this.currentSourceIndex];
    if (!folder || !folder.photos) return;
    // Fisher-Yates
    for (let i = folder.photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [folder.photos[i], folder.photos[j]] = [folder.photos[j], folder.photos[i]];
    }
  },

  showLoading(show) {
    const el = document.getElementById('loading-overlay');
    if (el) el.classList.toggle('show', show);
  },

  updateStatus(photo) {
    if (!this.onStatus) return;
    const src = this.sources[photo.sourceIndex];
    const totalInFolder = src.photos.length;
    this.onStatus(`Folder ${photo.sourceIndex + 1}/${this.sources.length} · Ảnh ${photo.photoIndex + 1}/${totalInFolder} · ${photo.name}`);
  }
};
