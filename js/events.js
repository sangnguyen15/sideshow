/**
 * events.js – Thiệp sinh nhật / kỷ niệm ngày cưới
 * Fix:
 *   - Frame cuối tắt hẳn trước khi slideshow tiếp tục
 *   - Không dùng URLSearchParams (tương thích Android WebView cũ)
 *   - visible/pendingShow reset đúng sau mỗi chu kỳ
 */
var EventCards = {
  eventsToday: [],
  eventIndex: 0,
  settings: null,
  intervalTimer: null,
  hideTimer: null,
  visible: false,
  pendingShow: false,
  slideshowRef: null,

  FRAME_BASE: 'preview-frames/',

  init: function (settings, slideshow) {
    this.settings     = settings || Storage.getSettings();
    this.slideshowRef = slideshow;
  },

  setSettings: function (settings) {
    this.settings = settings || this.settings;
  },

  setEventsFromConfig: function (allEvents) {
    var now = new Date();
    var m   = now.getMonth() + 1;
    var d   = now.getDate();
    var list = (allEvents || []).filter(function (ev) {
      return Number(ev.month) === m && Number(ev.day) === d;
    });
    this.eventsToday = list;
    this.eventIndex  = 0;
  },

  toImageUrl: function (link) {
    if (!link) return '';
    link = String(link).trim();
    if (/^[a-zA-Z0-9_-]{20,}$/.test(link)) {
      return 'https://lh3.googleusercontent.com/d/' + link;
    }
    var m = link.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
            link.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
            link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) {
      return 'https://lh3.googleusercontent.com/d/' + m[1];
    }
    if (/^https?:\/\//i.test(link)) return link;
    return '';
  },

  /* Thay URLSearchParams bằng encode thủ công – tương thích mọi WebView */
  buildFrameUrl: function (ev) {
    var isBirthday = ev.template === 'birthday';
    var base = this.FRAME_BASE +
      (isBirthday ? 'frame-birthday-v8.html' : 'frame-wedding-v4.html');

    var imgUrl = this.toImageUrl(ev.imageLink);

    var parts = [
      'day='   + encodeURIComponent(ev.day   || ''),
      'month=' + encodeURIComponent(ev.month || ''),
      'year='  + encodeURIComponent(ev.year  || '')
    ];

    if (imgUrl) {
      parts.push('photo_url=' + encodeURIComponent(imgUrl));
    }

    if (isBirthday) {
      parts.push('title_name=' + encodeURIComponent(ev.titleName || ''));
    } else {
      parts.push('pair_left='  + encodeURIComponent(ev.pairLeft  || ''));
      parts.push('pair_right=' + encodeURIComponent(ev.pairRight || ''));
    }

    return base + '?' + parts.join('&');
  },

  /**
   * LỚP BẢO VỆ QUAN TRỌNG:
   * Hàm này có thể bị gọi lại bất ngờ giữa chừng (ví dụ do poll
   * cấu hình từ cloud phát hiện "thay đổi" — kể cả false positive).
   * Nếu đang hiển thị 1 sự kiện (visible = true), TUYỆT ĐỐI không
   * được reset timer/eventIndex — nếu không sẽ làm treo/chớp frame
   * đang hiện. Chỉ được phép reset khi slideshow THẬT SỰ mới bắt đầu
   * (không có sự kiện nào đang hiển thị).
   */
  onSlideshowStarted: function () {
    if (this.visible) {
      /* Đang hiện sự kiện → bỏ qua lệnh reset này hoàn toàn */
      return;
    }

    this.eventIndex  = 0;
    this.pendingShow = false;
    this.clearTimers();
    if (!this.eventsToday.length) return;

    var mins = (this.settings && this.settings.event_interval_minutes) || 60;
    mins = Math.max(1, Math.min(24 * 60, Number(mins) || 60));
    var self = this;
    this.intervalTimer = setInterval(function () {
      self.requestShow();
    }, mins * 60 * 1000);
  },

  clearTimers: function () {
    if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
    if (this.hideTimer)     { clearTimeout(this.hideTimer);      this.hideTimer     = null; }
  },

  stop: function () {
    this.clearTimers();
    this.forceHide();
    this.pendingShow = false;
    this.visible     = false;
  },

  /**
   * Đến giờ (mốc interval N phút) → chỉ ĐÁNH DẤU cờ chờ.
   * KHÔNG hiện ngay lập tức, kể cả khi ảnh đang đứng yên (_busy = false).
   * Phải đợi đúng lúc slideshow hoàn tất trọn vẹn 1 chu kỳ hold
   * (slideshow.js gọi onPhotoHoldComplete() ngay trước khi next() chạy)
   * mới được phép chuyển sang frame sự kiện.
   */
  requestShow: function () {
    if (!this.eventsToday.length) return;
    if (this.visible) return;          /* đang chiếu → bỏ qua lần này */
    this.pendingShow = true;
    /* KHÔNG gọi tryShowWhenIdle() ở đây — chỉ chờ onPhotoHoldComplete() */
  },

  /**
   * Slideshow gọi đúng lúc 1 ảnh vừa đứng yên xong (hold hết giờ),
   * TRƯỚC khi chuyển sang ảnh kế tiếp. Đây là thời điểm DUY NHẤT
   * được phép chen sự kiện vào — đảm bảo không bao giờ cắt ngang
   * ảnh đang đứng yên hay đang chuyển cảnh.
   */
  onPhotoHoldComplete: function () {
    if (this.pendingShow) this.tryShowWhenIdle();
  },

  tryShowWhenIdle: function () {
    if (!this.pendingShow || this.visible) return;
    if (this.slideshowRef && this.slideshowRef._busy) return;
    this.pendingShow = false;
    this.eventIndex  = 0;
    this.showNext();
  },

  showNext: function () {
    if (!this.eventsToday.length) return;

    /* ── Hết tất cả sự kiện trong chu kỳ này ── */
    if (this.eventIndex >= this.eventsToday.length) {
      var self = this;
      /* 1. Fade out overlay */
      this.fadeHide(function () {
        /* 2. Xóa iframe hoàn toàn */
        var el = document.getElementById('event-overlay');
        if (el) el.innerHTML = '';
        self.visible = false;
        /* 3. Trả slideshow sau khi overlay đã tắt hẳn */
        if (self.slideshowRef) {
          self.slideshowRef._busy = false;
          if (self.slideshowRef.isPlaying) {
            self.slideshowRef.scheduleAfterHold();
          }
        }
      });
      return;
    }

    var ev = this.eventsToday[this.eventIndex];
    this.render(ev);
    this.visible = true;

    /* Dừng timer slideshow, reset busy */
    if (this.slideshowRef) {
      if (this.slideshowRef.timer) {
        clearTimeout(this.slideshowRef.timer);
        this.slideshowRef.timer = null;
      }
      this.slideshowRef._busy = false;
    }

    var sec = (this.settings && this.settings.event_duration) || 60;
    sec = Math.max(5, Math.min(300, Number(sec) || 60));
    var self = this;

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(function () {
      /* Chuyển sang sự kiện tiếp theo */
      self.eventIndex++;
      self.visible = false;
      self.showNext();
    }, sec * 1000);
  },

  /**
   * Fade out overlay rồi chạy callback – đảm bảo animation xong mới callback
   */
  fadeHide: function (callback) {
    var el = document.getElementById('event-overlay');
    if (!el) {
      if (callback) callback();
      return;
    }
    el.classList.remove('show');
    /* Đợi đúng thời gian transition CSS (0.5s) rồi callback */
    setTimeout(function () {
      if (callback) callback();
    }, 520);
  },

  /**
   * Tắt ngay lập tức không cần animation (dùng khi stop/reset)
   */
  forceHide: function () {
    var el = document.getElementById('event-overlay');
    if (el) {
      el.classList.remove('show');
      el.innerHTML = '';
    }
    this.visible = false;
  },

  render: function (ev) {
    var el = document.getElementById('event-overlay');
    if (!el) return;

    /* Xóa iframe cũ trước khi render mới – tránh flash nội dung cũ */
    el.innerHTML = '';
    el.className = 'event-overlay show';

    var frameUrl = this.buildFrameUrl(ev);

    var iframe = document.createElement('iframe');
    iframe.src              = frameUrl;
    iframe.className        = 'event-iframe';
    iframe.frameBorder      = '0';
    iframe.scrolling        = 'no';
    iframe.allowTransparency = 'true';
    iframe.title            = 'Thiep su kien';
    el.appendChild(iframe);
  }
};
