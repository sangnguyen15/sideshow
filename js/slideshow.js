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
  isOffline: false,
  timer: null,
  offlineCheckTimer: null,
  settings: {},
  recentIds: new Set(),

  layerA: null,
  layerB: null,
  activeLayer: 'a',

  onStatus: null,
  onError: null,

  effects: [
    'slide-h',
    'slide-v',
    'diag-bl',
    'diag-br',
    'zoom-center'
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
    this._busy = false;

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
    if (this.offlineCheckTimer) {
      clearInterval(this.offlineCheckTimer);
      this.offlineCheckTimer = null;
    }
    this.showOffline(false);
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
        var meta = await Drive.preloadImage(photo.url);
        if (meta && meta.width) {
          photo.width = meta.width;
          photo.height = meta.height;
        }
      } catch (e) {
        console.warn('Preload fail', photo.name);
      }
    }
    this.showLoading(false);
  },

  /** Tổng số ảnh đang phát */
  getTotalPhotoCount() {
    var total = 0;
    for (var i = 0; i < this.sources.length; i++) {
      var p = this.sources[i] && this.sources[i].photos;
      if (p) total += p.length;
    }
    return total;
  },

  /**
   * Lấy ảnh theo offset, tự quay vòng toàn bộ list (mọi folder).
   */
  getPhotoAtOffset(offset) {
    var total = this.getTotalPhotoCount();
    if (total <= 0) return null;

    var abs = 0;
    for (var i = 0; i < this.currentSourceIndex; i++) {
      abs += (this.sources[i].photos || []).length;
    }
    abs += this.currentPhotoIndex + (offset || 0);
    abs = ((abs % total) + total) % total;

    for (var sIdx = 0; sIdx < this.sources.length; sIdx++) {
      var photos = this.sources[sIdx].photos || [];
      if (abs < photos.length) {
        var photo = photos[abs];
        return Object.assign({}, photo, { sourceIndex: sIdx, photoIndex: abs });
      }
      abs -= photos.length;
    }
    return null;
  },

  /**
   * Tiến 1 ảnh; hết list → về đầu + xáo lại.
   */
  advanceIndex() {
    if (!this.sources.length) return;

    this.currentPhotoIndex++;
    var guard = 0;
    while (guard++ < 10000) {
      var src = this.sources[this.currentSourceIndex];
      var len = (src && src.photos) ? src.photos.length : 0;

      if (len > 0 && this.currentPhotoIndex < len) {
        return; // vị trí hợp lệ
      }

      // Hết folder hiện tại (hoặc folder rỗng) → folder sau
      this.currentSourceIndex++;
      this.currentPhotoIndex = 0;

      if (this.currentSourceIndex >= this.sources.length) {
        // Hết tất cả → vòng mới
        this.currentSourceIndex = 0;
        this.reshuffleAll();
      }
    }
  },

  /** Xáo lại toàn bộ nguồn đang phát (1 list gộp hoặc từng folder) */
  reshuffleAll() {
    for (var i = 0; i < this.sources.length; i++) {
      var photos = this.sources[i] && this.sources[i].photos;
      if (!photos || photos.length < 2) continue;
      for (var j = photos.length - 1; j > 0; j--) {
        var k = Math.floor(Math.random() * (j + 1));
        var tmp = photos[j];
        photos[j] = photos[k];
        photos[k] = tmp;
      }
    }
  },

  /**
   * - Ảnh ngang / vuông: cover (full màn, không méo, cắt rìa nhẹ nếu lệch tỷ lệ)
   * - Ảnh dọc: contain (đúng tỷ lệ gốc, không cắt, không phóng)
   * - Setting cover/fill: theo lựa chọn user
   */
  applyFit(img, fit, photo) {
    img.classList.remove('fit-cover', 'fit-fill', 'fit-portrait');
    img.style.position = '';
    img.style.top = '';
    img.style.left = '';
    img.style.right = '';
    img.style.bottom = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    img.style.transform = '';

    fit = fit || 'contain';

    if (fit === 'fill') {
      img.style.objectFit = 'fill';
      img.style.objectPosition = 'center center';
      img.style.width = '100%';
      img.style.height = '100%';
      img.classList.add('fit-fill');
      return;
    }

    if (fit === 'cover') {
      img.style.objectFit = 'cover';
      img.style.objectPosition = 'center center';
      img.style.width = '100%';
      img.style.height = '100%';
      img.classList.add('fit-cover');
      return;
    }

    var iw = (photo && photo.width) || img.naturalWidth || 0;
    var ih = (photo && photo.height) || img.naturalHeight || 0;
    var isPortrait = (iw > 0 && ih > 0 && (iw / ih) < 1.05);

    if (isPortrait) {
      img.style.objectFit = 'contain';
      img.style.objectPosition = 'center center';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.classList.add('fit-portrait');
      return;
    }

    img.style.objectFit = 'cover';
    img.style.objectPosition = 'center center';
    img.style.width = '100%';
    img.style.height = '100%';
    img.classList.add('fit-cover');
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

    img.style.transform = '';
    img.style.transition = 'none';
    img.src = photo.url;
    // Đợi ảnh load để có natural size nếu chưa có
    var self = this;
    var fit = this.settings.fit || 'contain';
    if (photo.width && photo.height) {
      this.applyFit(img, fit, photo);
    } else {
      img.onload = function () {
        photo.width = img.naturalWidth;
        photo.height = img.naturalHeight;
        self.applyFit(img, fit, photo);
      };
      this.applyFit(img, fit, photo);
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

  pickEffect() {
    if (this.settings.effect === 'random') {
      return this.effects[Math.floor(Math.random() * this.effects.length)];
    }
    var e = this.settings.effect;
    if (this.effects.indexOf(e) >= 0) return e;
    return 'slide-h';
  },

  getTransitionMs() {
    const sec = parseFloat(this.settings.transition);
    if (isNaN(sec)) return 30000;
    return Math.round(Math.max(0.5, Math.min(180, sec)) * 1000);
  },

  getHoldMs() {
    const sec = parseFloat(this.settings.duration);
    if (isNaN(sec)) return 120000;
    return Math.round(Math.max(1, Math.min(600, sec)) * 1000);
  },

  scheduleAfterHold() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.isPlaying) return;
    var self = this;
    this.timer = setTimeout(function () {
      self.next();
    }, this.getHoldMs());
  },

  /**
   * Chuyển ảnh tiếp theo. Luôn quay vòng; lỗi 1 ảnh không làm dừng cả hệ thống.
   */
  async next() {
    if (!this.isPlaying) return;
    if (this._busy) return;
    this._busy = true;

    try {
      if (!this.sources || !this.sources.length || this.getTotalPhotoCount() === 0) {
        this._busy = false;
        this.scheduleAfterHold();
        return;
      }

      this.advanceIndex();

      var photo = this.getPhotoAtOffset(0);
      if (!photo) {
        // Thử về đầu
        this.currentSourceIndex = 0;
        this.currentPhotoIndex = 0;
        this.reshuffleAll();
        photo = this.getPhotoAtOffset(0);
      }
      if (!photo) {
        this._busy = false;
        this.scheduleAfterHold();
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this._busy = false;
        this.handleOffline();
        return;
      }

      try {
        var meta = await Drive.preloadImage(photo.url);
        if (meta && meta.width) {
          photo.width = meta.width;
          photo.height = meta.height;
        }
      } catch (e) {
        console.warn('Skip image', e);
        this._busy = false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          this.handleOffline();
          return;
        }
        // Bỏ ảnh lỗi, thử ảnh kế sau 0.5s (không kẹt)
        var selfSkip = this;
        this.timer = setTimeout(function () {
          selfSkip.next();
        }, 500);
        return;
      }

      if (!this.isPlaying) {
        this._busy = false;
        return;
      }

      var nextLayer = this.activeLayer === 'a' ? this.layerB : this.layerA;
      var currLayer = this.activeLayer === 'a' ? this.layerA : this.layerB;
      var nextImg = nextLayer.querySelector('img');
      var currImg = currLayer.querySelector('img');

      var duration = this.getTransitionMs();
      var fit = this.settings.fit || 'contain';
      var effect = this.pickEffect();
      var ease = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

      nextImg.src = photo.url;
      if (photo.width && photo.height) {
        this.applyFit(nextImg, fit, photo);
      } else {
        var self2 = this;
        nextImg.onload = function () {
          photo.width = nextImg.naturalWidth;
          photo.height = nextImg.naturalHeight;
          self2.applyFit(nextImg, fit, photo);
        };
        this.applyFit(nextImg, fit, photo);
      }
      nextImg.style.transition = 'none';
      nextImg.style.transform = '';
      nextLayer.className = 'slide-layer next';
      nextLayer.style.transition = 'none';
      nextLayer.style.opacity = '0';
      nextLayer.style.transform = '';

      currLayer.style.transition = 'none';
      currLayer.style.transform = 'translate3d(0,0,0)';
      currLayer.style.opacity = '1';
      currLayer.classList.add('active');

      void nextLayer.offsetWidth;
      this.setStartState(nextLayer, nextImg, currLayer, effect);
      void nextLayer.offsetWidth;

      var self = this;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          self.runTransition(nextLayer, nextImg, currLayer, currImg, effect, duration, ease);
        });
      });

      this.activeLayer = this.activeLayer === 'a' ? 'b' : 'a';

      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(function () {
        self._busy = false;
        if (!self.isPlaying) return;

        var active = self.activeLayer === 'a' ? self.layerA : self.layerB;
        var other = self.activeLayer === 'a' ? self.layerB : self.layerA;
        var activeImg = active.querySelector('img');

        active.style.transition = 'none';
        active.style.transform = '';
        active.style.opacity = '1';
        active.className = 'slide-layer active';

        other.style.transition = 'none';
        other.style.opacity = '0';
        other.style.transform = '';
        other.className = 'slide-layer';

        if (activeImg) {
          activeImg.style.transition = 'none';
          if (!activeImg.classList.contains('fit-portrait')) {
            activeImg.style.transform = '';
          }
          self.applyFit(activeImg, fit, photo);
        }

        Storage.saveProgress({
          sourceIndex: photo.sourceIndex,
          photoIndex: photo.photoIndex,
          timestamp: Date.now()
        });
        Storage.addRecent(photo.id);

        self.updateStatus(photo);
        self.preloadAhead();
        self.scheduleAfterHold();
      }, duration + 50);

      this.updateStatus(photo);
      this.preloadAhead();
    } catch (err) {
      console.error('next() error', err);
      this._busy = false;
      // Không bao giờ dừng hẳn: thử lại sau 2s
      var selfErr = this;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(function () {
        selfErr.next();
      }, 2000);
    }
  },

  /**
   * 5 hiệu ứng (sát mép / nhìn rõ):
   * slide-h: cũ → phải, mới từ trái → giữa
   * slide-v: cũ → trên, mới từ dưới → giữa
   * diag-bl: mới từ dưới-trái, cũ ra trên-phải
   * diag-br: mới từ dưới-phải, cũ ra trên-trái
   * zoom-center: cũ mờ dần, mới từ tâm phóng to dần
   */
  setStartState(nextLayer, nextImg, currLayer, effect) {
    nextLayer.style.opacity = '1';
    nextImg.style.opacity = '1';

    switch (effect) {
      case 'slide-h':
        // mới đứng sát mép trái (ngoài màn hình)
        nextLayer.style.transform = 'translate3d(-100%,0,0)';
        break;
      case 'slide-v':
        nextLayer.style.transform = 'translate3d(0,100%,0)';
        break;
      case 'diag-bl':
        // góc dưới-trái
        nextLayer.style.transform = 'translate3d(-100%,100%,0)';
        break;
      case 'diag-br':
        // góc dưới-phải
        nextLayer.style.transform = 'translate3d(100%,100%,0)';
        break;
      case 'zoom-center':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(0.6)';
        break;
      default:
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'translateX(0) scale(1)';
    }
  },

  runTransition(nextLayer, nextImg, currLayer, currImg, effect, duration, ease) {
    var t = duration + 'ms ' + ease;

    nextLayer.style.transition = 'transform ' + t + ', opacity ' + t;
    currLayer.style.transition = 'transform ' + t + ', opacity ' + t;
    nextLayer.classList.add('active');

    switch (effect) {
      case 'slide-h':
        nextLayer.style.transform = 'translate3d(0,0,0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translate3d(100%,0,0)';
        currLayer.style.opacity = '1';
        break;

      case 'slide-v':
        nextLayer.style.transform = 'translate3d(0,0,0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translate3d(0,-100%,0)';
        currLayer.style.opacity = '1';
        break;

      case 'diag-bl':
        nextLayer.style.transform = 'translate3d(0,0,0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translate3d(100%,-100%,0)';
        currLayer.style.opacity = '1';
        break;

      case 'diag-br':
        nextLayer.style.transform = 'translate3d(0,0,0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translate3d(-100%,-100%,0)';
        currLayer.style.opacity = '1';
        break;

      case 'zoom-center':
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        // ảnh cũ mờ nhanh để luôn nhìn rõ ảnh mới
        currLayer.style.transition = 'opacity ' + Math.round(duration * 0.55) + 'ms ease, transform ' + t;
        currLayer.style.opacity = '0';
        currLayer.style.transform = 'scale(1.05)';
        break;

      default:
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'scale(1)';
        currLayer.style.opacity = '0';
    }
  },

  async preloadAhead() {
    for (let i = 1; i <= 3; i++) {
      const photo = this.getPhotoAtOffset(i);
      if (photo) {
        Drive.preloadImage(photo.url).then(function (meta) {
          if (meta && meta.width) {
            photo.width = meta.width;
            photo.height = meta.height;
          }
        }).catch(function () {});
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

  showOffline(show) {
    const el = document.getElementById('offline-overlay');
    if (el) el.classList.toggle('show', show);
    this.isOffline = !!show;
  },

  /**
   * Khi mất mạng: giữ ảnh hiện tại, hiện thông báo, dừng chuyển ảnh.
   * Khi có mạng lại: ẩn thông báo và tiếp tục.
   */
  handleOffline() {
    if (this.isOffline) return;
    this.showOffline(true);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Kiểm tra mạng định kỳ
    if (this.offlineCheckTimer) clearInterval(this.offlineCheckTimer);
    this.offlineCheckTimer = setInterval(() => {
      if (navigator.onLine) {
        this.handleOnline();
      }
    }, 3000);
  },

  handleOnline() {
    if (!this.isOffline) return;
    this.showOffline(false);
    if (this.offlineCheckTimer) {
      clearInterval(this.offlineCheckTimer);
      this.offlineCheckTimer = null;
    }
    // Tiếp tục chiếu nếu đang ở chế độ playing
    if (this.isPlaying) {
      this.scheduleAfterHold();
    }
  },

  updateStatus(photo) {
    if (!this.onStatus || !photo) return;
    var src = this.sources[photo.sourceIndex];
    var totalInFolder = (src && src.photos) ? src.photos.length : '?';
    var totalAll = this.getTotalPhotoCount();
    this.onStatus(
      'Folder ' + (photo.sourceIndex + 1) + '/' + this.sources.length +
      ' · Ảnh ' + (photo.photoIndex + 1) + '/' + totalInFolder +
      ' · Tổng ' + totalAll +
      ' · ' + (photo.name || '')
    );
  }
};
