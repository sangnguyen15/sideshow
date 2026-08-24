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

  /**
   * Smart fit:
   * - User chọn cover/fill → theo setting
   * - contain (mặc định) + ảnh ngang → contain đầy đủ
   * - contain + ảnh dọc → phóng vừa phải (~1.30× contain, trần 90% cover), neo trên
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

    fit = fit || 'contain';

    // cover / fill: theo setting người dùng
    if (fit === 'cover') {
      img.style.objectFit = 'cover';
      img.style.objectPosition = 'center center';
      img.style.width = '100%';
      img.style.height = '100%';
      img.classList.add('fit-cover');
      return;
    }
    if (fit === 'fill') {
      img.style.objectFit = 'fill';
      img.style.width = '100%';
      img.style.height = '100%';
      img.classList.add('fit-fill');
      return;
    }

    // contain + nhận diện ngang/dọc
    var iw = (photo && photo.width) || img.naturalWidth || 0;
    var ih = (photo && photo.height) || img.naturalHeight || 0;
    var isPortrait = (iw > 0 && ih > 0 && (iw / ih) < 1.05);

    if (!isPortrait || iw <= 0 || ih <= 0) {
      // Ảnh ngang / vuông / chưa biết size → contain chuẩn
      img.style.objectFit = 'contain';
      img.style.objectPosition = 'center center';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      return;
    }

    // === Ảnh dọc: phóng vừa phải, neo trên ===
    var cw = window.innerWidth || document.documentElement.clientWidth || 1920;
    var ch = window.innerHeight || document.documentElement.clientHeight || 1080;

    var containScale = Math.min(cw / iw, ch / ih);
    var coverScale = Math.max(cw / iw, ch / ih);

    // Trung bình an toàn: 1.30× contain, không vượt 90% cover
    var scale = Math.min(containScale * 1.30, coverScale * 0.90);

    // Không upscale quá mạnh so với pixel gốc (tránh mờ trên TV 1x)
    // Cho phép tối đa ~1.15× natural pixel để vẫn còn nét chấp nhận được
    if (scale > 1.15) {
      scale = 1.15;
    }

    // Vẫn phải lớn hơn contain một chút nếu có thể (nếu bị clamp 1.15)
    if (scale < containScale) {
      scale = containScale;
    }

    var dispW = Math.round(iw * scale);
    var dispH = Math.round(ih * scale);

    img.style.objectFit = 'fill';
    img.style.width = dispW + 'px';
    img.style.height = dispH + 'px';
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.position = 'absolute';
    img.style.top = '0';
    img.style.left = '50%';
    img.style.transform = 'translateX(-50%)';
    img.classList.add('fit-portrait');
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

    // Kiểm tra mạng trước khi tải ảnh mới
    if (!navigator.onLine) {
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
      if (!navigator.onLine) {
        this.handleOffline();
        return;
      }
      this.currentPhotoIndex++;
      this.scheduleAfterHold();
      return;
    }

    const duration = this.getTransitionMs();
    const fit = this.settings.fit || 'contain';
    const effect = this.pickEffect();
    const ease = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

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

    void nextLayer.offsetWidth;

    this.setStartState(nextLayer, nextImg, currLayer, effect);
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
        if (effect !== 'kenburns') {
          activeImg.style.transition = 'none';
          // Giữ translateX(-50%) nếu là portrait
          if (!activeImg.classList.contains('fit-portrait')) {
            activeImg.style.transform = '';
          }
        }
        this.applyFit(activeImg, fit, photo);
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

  /**
   * Nguyên tắc chuyển cảnh:
   * - Slide/Push: 2 ảnh sát mép, cùng dịch chuyển, gần như không chồng
   * - Fade/Zoom: ảnh cũ mờ nhanh để luôn nhìn rõ ảnh mới
   * - Hết hiệu ứng → ảnh mới đúng giữa → bắt đầu đứng yên
   */
  setStartState(nextLayer, nextImg, currLayer, effect) {
    // Reset
    nextLayer.style.opacity = '1';
    nextImg.style.opacity = '1';

    switch (effect) {
      // === SLIDE / PUSH: ảnh mới đứng sát mép ngoài ===
      case 'slide-left':   // ảnh mới vào từ phải, cả hai đi sang trái
      case 'push-left':
        nextLayer.style.transform = 'translateX(100%)';
        break;
      case 'slide-right':  // ảnh mới vào từ trái, cả hai đi sang phải (đúng ví dụ user)
      case 'push-right':
        nextLayer.style.transform = 'translateX(-100%)';
        break;
      case 'slide-up':
        nextLayer.style.transform = 'translateY(100%)';
        break;
      case 'slide-down':
        nextLayer.style.transform = 'translateY(-100%)';
        break;

      // === FADE: bắt đầu trong suốt ===
      case 'fade':
      case 'fade-black':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'translateX(0)';
        break;

      // === ZOOM: scale khác nhau, opacity 0 ===
      case 'zoom-in':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(1.2)';
        break;
      case 'zoom-out':
      case 'soft-zoom':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'scale(0.85)';
        break;

      case 'kenburns':
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'translateX(0) scale(1)';
        nextImg.style.transform = 'scale(1) translate(0,0)';
        break;

      default:
        nextLayer.style.opacity = '0';
        nextLayer.style.transform = 'translateX(0)';
    }
  },

  runTransition(nextLayer, nextImg, currLayer, currImg, effect, duration, ease) {
    var t = duration + 'ms ' + ease;

    nextLayer.style.transition = 'transform ' + t + ', opacity ' + t;
    currLayer.style.transition = 'transform ' + t + ', opacity ' + t;
    nextLayer.classList.add('active');

    switch (effect) {
      // ========== SLIDE / PUSH: sát mép, cùng dịch, không chồng ==========
      // slide-right = ảnh mới từ trái vào, cả hai đi sang phải (ví dụ user)
      case 'slide-right':
      case 'push-right':
        nextLayer.style.transform = 'translateX(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateX(100%)';
        currLayer.style.opacity = '1'; // giữ rõ đến khi ra hết, không chồng
        break;

      case 'slide-left':
      case 'push-left':
        nextLayer.style.transform = 'translateX(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateX(-100%)';
        currLayer.style.opacity = '1';
        break;

      case 'slide-up':
        nextLayer.style.transform = 'translateY(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateY(-100%)';
        currLayer.style.opacity = '1';
        break;

      case 'slide-down':
        nextLayer.style.transform = 'translateY(0)';
        nextLayer.style.opacity = '1';
        currLayer.style.transform = 'translateY(100%)';
        currLayer.style.opacity = '1';
        break;

      // ========== FADE: ảnh cũ mờ nhanh để nhìn rõ ảnh mới ==========
      case 'fade':
        nextLayer.style.opacity = '1';
        nextLayer.style.transform = 'translateX(0)';
        // Ảnh cũ mờ nhanh hơn (dùng thời gian ngắn hơn một chút)
        currLayer.style.transition = 'opacity ' + Math.round(duration * 0.6) + 'ms ease';
        currLayer.style.opacity = '0';
        break;

      case 'fade-black':
        currLayer.style.transition = 'opacity ' + Math.round(duration * 0.45) + 'ms ease';
        currLayer.style.opacity = '0';
        setTimeout(function () {
          nextLayer.style.transition = 'opacity ' + Math.round(duration * 0.45) + 'ms ease';
          nextLayer.style.opacity = '1';
        }, Math.round(duration * 0.45));
        break;

      // ========== ZOOM: ảnh cũ mờ nhanh + thu nhỏ nhẹ ==========
      case 'zoom-in':
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.transition = 'opacity ' + Math.round(duration * 0.5) + 'ms ease, transform ' + t;
        currLayer.style.opacity = '0';
        currLayer.style.transform = 'scale(0.92)';
        break;

      case 'zoom-out':
      case 'soft-zoom':
        nextLayer.style.transform = 'scale(1)';
        nextLayer.style.opacity = '1';
        currLayer.style.transition = 'opacity ' + Math.round(duration * 0.5) + 'ms ease, transform ' + t;
        currLayer.style.opacity = '0';
        currLayer.style.transform = 'scale(1.06)';
        break;

      case 'kenburns':
        nextLayer.style.opacity = '1';
        currLayer.style.transition = 'opacity ' + Math.round(duration * 0.5) + 'ms ease';
        currLayer.style.opacity = '0';
        nextImg.style.transition = 'none';
        nextImg.style.transform = 'scale(1) translate(0,0)';
        void nextImg.offsetWidth;
        var hold = this.getHoldMs();
        nextImg.style.transition = 'transform ' + (hold + duration) + 'ms ease-out';
        nextImg.style.transform = 'scale(1.08) translate(-1.5%, -1%)';
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
    if (!this.onStatus) return;
    const src = this.sources[photo.sourceIndex];
    this.onStatus(
      'Folder ' + (photo.sourceIndex + 1) + '/' + this.sources.length +
      ' · Ảnh ' + (photo.photoIndex + 1) + '/' + src.photos.length +
      ' · ' + photo.name
    );
  }
};
