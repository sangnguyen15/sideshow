/**
 * slideshow.js
 * Logic mới:
 * - Thời gian hiệu ứng = thời gian ảnh mới di chuyển/zoom vào (có thể dài)
 * - Ảnh cũ và ảnh mới chạy song song (cùng lúc)
 * - Sau khi hết hiệu ứng → ảnh đứng yên theo "duration"
 * - Khi đứng yên: full ảnh (contain) theo Hướng A
 * - Setting mới mặc định áp dụng từ ảnh tiếp theo
 * - applySettingsNow() = chuyển ngay sang ảnh mới với setting hiện tại
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
    this.settings = { ...settings };
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
    // Ảnh đầu tiên hiện luôn (không hiệu ứng), rồi đứng yên
    this.showStaticCurrent();
    this.scheduleAfterHold();
  },

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  /**
   * Áp dụng setting ngay: hủy timer, chuyển sang ảnh tiếp theo với setting mới
   */
  applySettingsNow() {
    if (!this.isPlaying) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.next();
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

    if (this.sources.length > 0) {
      const first = this.sources[0];
      const idx = ((pIdx % first.photos.length) + first.photos.length) % first.photos.length;
      return { ...first.photos[idx], sourceIndex: 0, photoIndex: idx };
    }
    return null;
  },

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
      img.style.objectFit = 'contain';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
    }
  },

  showStaticCurrent() {
    const photo = this.getPhotoAtOffset(0);
    if (!photo) return;

    const layer = this.activeLayer === 'a' ? this.layerA : this.layerB;
    const other = this.activeLayer === 'a' ? this.layerB : this.layerA;
    const img = layer.querySelector('img');

    layer.className = 'slide-layer active';
    layer.style.opacity = '1';
    layer.style.transform = '';
    layer.style.transition = 'none';

    other.className = 'slide-layer';
    other.style.opacity = '0';
    other.style.transform = '';
    other.style.transition = 'none';

    this.applyFit(img, this.settings.fit || 'contain');
    img.style.transform = '';
    img.style.transition = 'none';
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

  pickEffect() {
    if (this.settings.effect === 'random') {
      return this.effects[Math.floor(Math.random() * this.effects.length)];
    }
    return this.settings.effect || 'fade';
  },

  getTransitionMs() {
    const sec = parseFloat(this.settings.transition);
    if (isNaN(sec)) return 8000;
    return Math.round(Math.max(0.5, Math.min(60, sec)) * 1000);
  },

  getHoldMs() {
    const sec = parseFloat(this.settings.duration);
    if (isNaN(sec)) return 5000;
    return Math.round(Math.max(1, Math.min(60, sec)) * 1000);
  },

  scheduleAfterHold() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), this.getHoldMs());
  },

  async next() {
    if (!this.isPlaying) return;

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
      this.scheduleAfterHold();
      return;
    }

    try {
      await Drive.preloadImage(photo.url);
    } catch (e) {
      console.warn('Skip image', e);
      this.currentPhotoIndex++;
      this.scheduleAfterHold();
      return;
    }

    const duration = this.getTransitionMs();
    const fit = this.settings.fit || 'contain';
    const effect = this.pickEffect();
    const ease = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

    this.applyFit(nextImg, fit);
    nextImg.src = photo.url;
    nextImg.style.transition = 'none';
    nextImg.style.transform = '';
    nextLayer.className = 'slide-layer next';
    nextLayer.style.transition = 'none';
    nextLayer.style.opacity = '0';
    nextLayer.style.transform = '';

    void nextLayer.offsetWidth;

    this.setStartState(nextLayer, nextImg, effect);
    void nextLayer.offsetWidth;

    requestAnimationFrame(() => {
      this.runTransition(nextLayer, nextImg, currLayer, currImg, effect, duration, ease);
    });

    this.activeLayer = this.activeLayer === 'a' ? 'b' : 'a';

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.isPlaying) return;

      const active = this.activeLayer === 'a' ? this.layerA : this.layerB;
      const other = this.activeLayer === 'a' ? this.layerB : this.layerA;
      const activeImg = active.querySelector('img');

      active.style.transition = 'none';
      active.style.transform = '';
      active.style.opacity = '1';
      active.className = 'slide-layer active';

      other.style.transition = 'none';
      other.style.opacity = '0';
      other.style.transform = '';
      other.className = 'slide-layer';

      if (activeImg) {
        this.applyFit(activeImg, fit);
        if (effect !== 'kenburns') {
          activeImg.style.transition = 'none';
          activeImg.style.transform = '';
        }
      }

      Storage.saveProgress({
        sourceIndex: photo.sourceIndex,
        photoIndex: photo.photoIndex,
        timestamp: Date.now()
      });
      Storage.addRecent(photo.id);

      this.updateStatus(photo);
      this.preloadAhead();
      this.scheduleAfterHold();
    }, duration + 50);

    this.updateStatus(photo);
    this.preloadAhead();
  },

  setStartState(nextLayer, nextImg, effect) {
    switch (effect) {
      case 'fade':
      case 'fade-black':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(1)';
        break;
      case 'slide-left':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateX(100%)';
        break;
      case 'slide-right':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateX(-100%)';
        break;
      case 'slide-up':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateY(100%)';
        break;
      case 'slide-down':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateY(-100%)';
        break;
      case 'zoom-in':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(1.25)';
        break;
      case 'zoom-out':
      case 'soft-zoom':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(0.82)';
        break;
      case 'kenburns':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(1)';
        nextImg.style.transform = 'scale(1) translate(0,0)';
        break;
      case 'push-left':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateX(100%)';
        break;
      case 'push-right':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateX(-100%)';
        break;
      default:
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(1)';
    }
  },

  runTransition(nextLayer, nextImg, currLayer, currImg, effect, duration, ease) {
    const t = duration + 'ms ' + ease;

    nextLayer.style.transition = 'transform ' + t + ', opacity ' + t;
    currLayer.style.transition = 'transform ' + t + ', opacity ' + t;
    nextLayer.classList.add('active');

    switch (effect) {
      case 'fade':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'scale(1)';
        currLayer.style.opacity = '0';
        break;

      case 'fade-black':
        currLayer.style.transition = 'opacity ' + (duration / 2) + 'ms ease';
        currLayer.style.opacity = '0';
        setTimeout(() => {
          nextLayer.style.transition = 'opacity ' + (duration / 2) + 'ms ease';
          nextLayer.style.opacity = '1';
        }, duration / 2);
        break;

      case 'slide-left':
        nextLayer.style.transform = 'translateX(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateX(-35%)';
        currLayer.style.opacity = '0';
        break;

      case 'slide-right':
        nextLayer.style.transform = 'translateX(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateX(35%)';
        currLayer.style.opacity = '0';
        break;

      case 'slide-up':
        nextLayer.style.transform = 'translateY(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateY(-30%)';
        currLayer.style.opacity = '0';
        break;

      case 'slide-down':
        nextLayer.style.transform = 'translateY(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateY(30%)';
        currLayer.style.opacity = '0';
        break;

      case 'zoom-in':
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
        currLayer.style.transform = 'scale(0.92)';
        break;

      case 'zoom-out':
      case 'soft-zoom':
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
        currLayer.style.transform = 'scale(1.08)';
        break;

      case 'kenburns':
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
        nextImg.style.transition = 'none';
        nextImg.style.transform = 'scale(1) translate(0,0)';
        void nextImg.offsetWidth;
        var hold = this.getHoldMs();
        nextImg.style.transition = 'transform ' + (hold + duration) + 'ms ease-out';
        nextImg.style.transform = 'scale(1.1) translate(-2%, -1.5%)';
        break;

      case 'push-left':
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(-100%)';
        break;

      case 'push-right':
        nextLayer.style.transform = 'translateX(0)';
        currLayer.style.transform = 'translateX(100%)';
        break;

      default:
        nextLayer.style.opacity = '1';
        currLayer.style.opacity = '0';
    }
  },

  async preloadAhead() {
    for (let i = 1; i <= 3; i++) {
      const photo = this.getPhotoAtOffset(i);
      if (photo) {
        Drive.preloadImage(photo.url).catch(function () {});
      }
    }
  },

  shuffleCurrentFolder() {
    const folder = this.sources[this.currentSourceIndex];
    if (!folder || !folder.photos) return;
    for (let i = folder.photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      var tmp = folder.photos[i];
      folder.photos[i] = folder.photos[j];
      folder.photos[j] = tmp;
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
      'Folder ' + (photo.sourceIndex + 1) + '/' + this.sources.length +
      ' · Ảnh ' + (photo.photoIndex + 1) + '/' + src.photos.length +
      ' · ' + photo.name
    );
  }
};
