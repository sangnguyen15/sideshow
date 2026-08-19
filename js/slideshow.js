/**
 * slideshow.js – Double buffering + preload + nhiều hiệu ứng nhẹ
 * Hướng A: khi ảnh đứng yên → full ảnh (contain), không cắt nội dung
 * Trong lúc transition được phép scale/pan tạm thời, sau đó reset về full ảnh
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

  // Nhiều hiệu ứng nhẹ
  effects: [
    'fade',
    'fade-black',
    'slide-left',
    'slide-right',
    'slide-up',
    'slide-down',
    'zoom-in',
    'zoom-out',
    'kenburns',
    'push-left',
    'push-right',
    'soft-zoom'
  ],

  init(settings, onStatus, onError) {
    this.settings = settings;
    this.onStatus = onStatus;
    this.onError = onError;

    this.layerA = document.getElementById('layer-a');
    this.layerB = document.getElementById('layer-b');
    this.activeLayer = 'a';
    this.recentIds = new Set(Storage.getRecent());

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
    this.showCurrent(true);
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
   * Hiển thị ảnh đứng yên → luôn full ảnh (contain) theo hướng A
   */
  showCurrent(isFirst = false) {
    const photo = this.getPhotoAtOffset(0);
    if (!photo) return;

    const layer = this.activeLayer === 'a' ? this.layerA : this.layerB;
    const img = layer.querySelector('img');

    // Reset hoàn toàn về trạng thái đứng yên
    layer.className = 'slide-layer active';
    layer.style.opacity = '1';
    layer.style.transform = '';
    layer.style.transition = '';

    this.applyFit(img, this.settings.fit || 'contain');
    img.style.transform = '';
    img.style.transition = '';
    img.src = photo.url;

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
   * Áp dụng chế độ hiển thị ảnh (contain = full ảnh)
   */
  applyFit(img, fit) {
    img.classList.remove('fit-cover', 'fit-fill');
    if (fit === 'cover') {
      img.style.objectFit = 'cover';
      img.style.width = '100%';
      img.style.height = '100%';
      img.classList.add('fit-cover');
    } else if (fit === 'fill') {
      img.style.objectFit = 'fill';
      img.style.width = '100%';
      img.style.height = '100%';
      img.classList.add('fit-fill');
    } else {
      // contain – full ảnh, không cắt
      img.style.objectFit = 'contain';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
    }
  },

  pickEffect() {
    if (this.settings.effect === 'random') {
      return this.effects[Math.floor(Math.random() * this.effects.length)];
    }
    return this.settings.effect || 'fade';
  },

  getTransitionMs() {
    const sec = parseFloat(this.settings.transition) || 1.0;
    return Math.round(Math.max(0.3, Math.min(3, sec)) * 1000);
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

    // Preload
    try {
      await Drive.preloadImage(photo.url);
    } catch (e) {
      console.warn('Skip image', e);
      this.currentPhotoIndex++;
      this.scheduleNext(400);
      return;
    }

    const duration = this.getTransitionMs();
    const fit = this.settings.fit || 'contain';

    // Chuẩn bị layer mới – bắt đầu từ trạng thái full ảnh
    this.applyFit(nextImg, fit);
    nextImg.src = photo.url;
    nextImg.style.transform = '';
    nextImg.style.transition = '';
    nextLayer.className = 'slide-layer next';
    nextLayer.style.opacity = '0';
    nextLayer.style.transform = '';
    nextLayer.style.transition = '';

    // Force reflow
    void nextLayer.offsetWidth;

    const effect = this.pickEffect();

    // ========== HIỆU ỨNG NHẸ ==========
    if (effect === 'fade') {
      nextLayer.style.transition = `opacity ${duration}ms ease`;
      currLayer.style.transition = `opacity ${duration}ms ease`;
      nextLayer.style.opacity = '1';
      currLayer.style.opacity = '0';
      nextLayer.classList.add('active');
    }
    else if (effect === 'fade-black') {
      // Fade ra đen rồi fade vào
      currLayer.style.transition = `opacity ${duration / 2}ms ease`;
      currLayer.style.opacity = '0';
      setTimeout(() => {
        nextLayer.style.transition = `opacity ${duration / 2}ms ease`;
        nextLayer.style.opacity = '1';
        nextLayer.classList.add('active');
      }, duration / 2);
    }
    else if (effect === 'slide-left') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      nextLayer.style.transform = 'translateX(100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(-30%)';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'slide-right') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      nextLayer.style.transform = 'translateX(-100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(30%)';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'slide-up') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      nextLayer.style.transform = 'translateY(100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateY(0)';
        currLayer.style.transform = 'translateY(-25%)';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'slide-down') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease`;
      nextLayer.style.transform = 'translateY(-100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateY(0)';
        currLayer.style.transform = 'translateY(25%)';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'zoom-in') {
      nextLayer.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
      nextLayer.style.transform = 'scale(1.15)';
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
      nextLayer.style.transform = 'scale(0.88)';
      nextLayer.style.opacity = '0';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'kenburns') {
      // Fade + Ken Burns nhẹ trong lúc đứng
      nextLayer.style.transition = `opacity ${duration}ms ease`;
      currLayer.style.transition = `opacity ${duration}ms ease`;
      nextLayer.style.opacity = '1';
      currLayer.style.opacity = '0';
      nextLayer.classList.add('active');

      // Ken Burns nhẹ trên ảnh mới (chỉ trong thời gian đứng)
      nextImg.style.transition = 'none';
      nextImg.style.transform = 'scale(1) translate(0,0)';
      void nextImg.offsetWidth;
      const holdTime = (this.settings.duration || 5) * 1000;
      nextImg.style.transition = `transform ${holdTime}ms ease-out`;
      nextImg.style.transform = 'scale(1.08) translate(-1.5%, -1%)';
    }
    else if (effect === 'push-left') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
      nextLayer.style.transform = 'translateX(100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(-100%)';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'push-right') {
      nextLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
      currLayer.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
      nextLayer.style.transform = 'translateX(-100%)';
      nextLayer.style.opacity = '1';
      requestAnimationFrame(() => {
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(100%)';
      });
      nextLayer.classList.add('active');
    }
    else if (effect === 'soft-zoom') {
      nextLayer.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
      nextLayer.style.transform = 'scale(1.06)';
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

    // Sau khi hết hiệu ứng → ép về trạng thái full ảnh đứng yên
    setTimeout(() => {
      if (!this.isPlaying) return;
      const active = this.activeLayer === 'a' ? this.layerA : this.layerB;
      const activeImg = active.querySelector('img');
      active.style.transform = '';
      if (activeImg) {
        this.applyFit(activeImg, fit);
      }
    }, duration + 50);

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
