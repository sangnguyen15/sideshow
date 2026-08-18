/**
 * slideshow.js – Double buffering + preload + nhiều hiệu ứng chuyển cảnh ngẫu nhiên
 * Sửa lỗi tỷ lệ ảnh (dùng <img> + object-fit)
 */

const Slideshow = {
  sources: [],
  currentSourceIndex: 0,
  currentPhotoIndex: 0,
  isPlaying: false,
  timer: null,
  settings: {},
  recentIds: new Set(),

  layerA: null,
  layerB: null,
  activeLayer: 'a',

  onStatus: null,
  onError: null,

  // Danh sách hiệu ứng có thể random
  effects: ['fade', 'kenburns', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out'],

  init(settings, onStatus, onError) {
    this.settings = settings;
    this.onStatus = onStatus;
    this.onError = onError;

    this.layerA = document.getElementById('layer-a');
    this.layerB = document.getElementById('layer-b');
    this.activeLayer = 'a';
    this.recentIds = new Set(Storage.getRecent());

    // Tạo thẻ img bên trong mỗi layer nếu chưa có
    this.ensureImg(this.layerA);
    this.ensureImg(this.layerB);
  },

  ensureImg(layer) {
    if (!layer.querySelector('img')) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      layer.appendChild(img);
    }
  },

  setSources(sources) {
    this.sources = sources.filter(s => s.photos && s.photos.length > 0);
  },

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
        this.currentPhotoIndex = Math.min(
          progress.photoIndex,
          this.sources[progress.sourceIndex].photos.length - 1
        );
      } else {
        this.currentSourceIndex = 0;
        this.currentPhotoIndex = 0;
      }
    } else {
      this.currentSourceIndex = 0;
      this.currentPhotoIndex = 0;
    }

    await this.prepareInitial();
    this.showCurrent(true); // first show, no transition
    this.scheduleNext();
  },

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  async prepareInitial() {
    this.showLoading(true);
    for (let i = 0; i < 3; i++) {
      const photo = this.getPhotoAtOffset(i);
      if (!photo) break;
      try {
        await Drive.preloadImage(photo.url);
      } catch (e) {
        console.warn('Preload fail', photo.name);
      }
    }
    this.showLoading(false);
  },

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

    // Loop về đầu
    if (this.sources.length > 0) {
      const first = this.sources[0];
      const idx = ((pIdx % first.photos.length) + first.photos.length) % first.photos.length;
      return { ...first.photos[idx], sourceIndex: 0, photoIndex: idx };
    }
    return null;
  },

  /**
   * Hiển thị ảnh (lần đầu hoặc sau transition)
   */
  showCurrent(isFirst = false) {
    const photo = this.getPhotoAtOffset(0);
    if (!photo) return;

    const layer = this.activeLayer === 'a' ? this.layerA : this.layerB;
    const img = layer.querySelector('img');

    // Reset
    layer.className = 'slide-layer active';
    img.style.objectFit = this.settings.fit || 'cover';
    img.src = photo.url;

    // Ken Burns chỉ khi hiệu ứng là kenburns
    if (this.settings.effect === 'kenburns' || this.settings.effect === 'random') {
      // sẽ xử lý trong next()
    }

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
   * Chọn hiệu ứng (nếu setting = random thì random)
   */
  pickEffect() {
    if (this.settings.effect === 'random') {
      return this.effects[Math.floor(Math.random() * this.effects.length)];
    }
    return this.settings.effect || 'fade';
  },

  async next() {
    if (!this.isPlaying) return;

    // Tăng index
    this.currentPhotoIndex++;
    const currentSource = this.sources[this.currentSourceIndex];

    if (this.currentPhotoIndex >= currentSource.photos.length) {
      this.currentSourceIndex++;
      this.currentPhotoIndex = 0;

      if (this.currentSourceIndex >= this.sources.length) {
        this.currentSourceIndex = 0;
      }

      if (this.settings.shuffle) {
        this.shuffleCurrentFolder();
      }
    }

    const nextLayer = this.activeLayer === 'a' ? this.layerB : this.layerA;
    const currLayer = this.activeLayer === 'a' ? this.layerA : this.layerB;
    const nextImg = nextLayer.querySelector('img');
    const currImg = currLayer.querySelector('img');

    const photo = this.getPhotoAtOffset(0);
    if (!photo) {
      this.scheduleNext();
      return;
    }

    // Preload / load ảnh
    try {
      await Drive.preloadImage(photo.url);
    } catch (e) {
      console.warn('Skip image', e);
      this.currentPhotoIndex++;
      this.scheduleNext(400);
      return;
    }

    // Chuẩn bị layer mới
    nextImg.style.objectFit = this.settings.fit || 'cover';
    nextImg.src = photo.url;
    nextLayer.className = 'slide-layer next';
    nextLayer.style.opacity = '0';
    nextLayer.style.transform = '';
    nextImg.style.transform = '';

    const effect = this.pickEffect();
    const duration = 1100; // ms

    // Reset transition
    nextLayer.style.transition = '';
    currLayer.style.transition = '';
    nextImg.style.transition = '';
    currImg.style.transition = '';

    // ========== CÁC HIỆU ỨNG ==========
    if (effect === 'fade') {
      nextLayer.style.transition = `opacity ${duration}ms ease`;
      currLayer.style.transition = `opacity ${duration}ms ease`;
      nextLayer.style.opacity = '1';
      currLayer.style.opacity = '0';
      nextLayer.classList.add('active');
    }
    else if (effect === 'kenburns') {
      nextLayer.style.transition = `opacity ${duration}ms ease`;
      currLayer.style.transition = `opacity ${duration}ms ease`;
      nextLayer.style.opacity = '1';
      currLayer.style.opacity = '0';
      nextLayer.classList.add('active');

      // Ken Burns trên ảnh mới
      nextImg.style.transition = 'none';
      nextImg.style.transform = 'scale(1) translate(0,0)';
      // force reflow
      void nextImg.offsetWidth;
      nextImg.style.transition = 'transform 9s ease-out';
      nextImg.style.transform = 'scale(1.13) translate(-2.5%, -1.8%)';
    }
    else if (effect === 'slide-left') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${duration}ms ease`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${duration}ms ease`;
      nextLayer.style.transform = 'translateX(100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(-40%)';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'slide-right') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${duration}ms ease`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${duration}ms ease`;
      nextLayer.style.transform = 'translateX(-100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(40%)';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'zoom-in') {
      nextLayer.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
      nextLayer.style.transform = 'scale(1.2)';
      nextLayer.style.opacity = '0';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'zoom-out') {
      nextLayer.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
      nextLayer.style.transform = 'scale(0.85)';
      nextLayer.style.opacity = '0';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else {
      // fallback fade
      nextLayer.style.transition = `opacity ${duration}ms ease`;
      currLayer.style.transition = `opacity ${duration}ms ease`;
      nextLayer.style.opacity = '1';
      currLayer.style.opacity = '0';
      nextLayer.classList.add('active');
    }

    // Đổi active layer
    this.activeLayer = this.activeLayer === 'a' ? 'b' : 'a';

    // Lưu progress
    Storage.saveProgress({
      sourceIndex: photo.sourceIndex,
      photoIndex: photo.photoIndex,
      timestamp: Date.now()
    });
    Storage.addRecent(photo.id);

    this.updateStatus(photo);
    this.preloadAhead();
    this.scheduleNext();
  },

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
    const ms = delay || (this.settings.duration * 1000);
    this.timer = setTimeout(() => this.next(), ms);
  },

  shuffleCurrentFolder() {
    const folder = this.sources[this.currentSourceIndex];
    if (!folder || !folder.photos) return;
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
    this.onStatus(
      `Folder ${photo.sourceIndex + 1}/${this.sources.length} · Ảnh ${photo.photoIndex + 1}/${src.photos.length} · ${photo.name}`
    );
  }
};
