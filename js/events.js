/**
 * events.js – Thiệp sinh nhật / kỷ niệm ngày cưới
 * - Dùng iframe trỏ vào preview-frames/ thay vì build HTML thủ công
 * - Nhiều sự kiện trong ngày → chiếu lần lượt liên tiếp, sau đó mới dừng
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

  /* Đường dẫn tương đối từ index.html tới thư mục preview-frames */
  FRAME_BASE: 'preview-frames/',

  init: function (settings, slideshow) {
    this.settings = settings || Storage.getSettings();
    this.slideshowRef = slideshow;
  },

  setSettings: function (settings) {
    this.settings = settings || this.settings;
  },

  /** Lọc sự kiện đúng ngày hôm nay */
  setEventsFromConfig: function (allEvents) {
    var now = new Date();
    var m = now.getMonth() + 1;
    var d = now.getDate();
    var list = (allEvents || []).filter(function (ev) {
      return Number(ev.month) === m && Number(ev.day) === d;
    });
    this.eventsToday = list;
    this.eventIndex  = 0;
  },

  /** Chuyển link Drive → URL ảnh trực tiếp (lh3) */
  toImageUrl: function (link) {
    if (!link) return '';
    if (/^[a-zA-Z0-9_-]{20,}$/.test(link.trim())) {
      return 'https://lh3.googleusercontent.com/d/' + link.trim();
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

  /** Build URL cho iframe */
  buildFrameUrl: function (ev) {
    var isBirthday = ev.template === 'birthday';
    var base = this.FRAME_BASE +
      (isBirthday ? 'frame-birthday-v8.html' : 'frame-wedding-v4.html');

    var params = new URLSearchParams();
    params.set('day',   ev.day);
    params.set('month', ev.month);
    params.set('year',  ev.year);

    var imgUrl = this.toImageUrl(ev.imageLink);
    if (imgUrl) params.set('photo_url', imgUrl);

    if (isBirthday) {
      params.set('title_name', ev.titleName || '');
    } else {
      params.set('pair_left',  ev.pairLeft  || '');
      params.set('pair_right', ev.pairRight || '');
    }

    return base + '?' + params.toString();
  },

  /** Gọi sau khi slideshow bắt đầu */
  onSlideshowStarted: function () {
    this.eventIndex = 0;
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
    this.hide();
    this.pendingShow = false;
  },

  /** Đến giờ – đợi slideshow rảnh rồi hiện */
  requestShow: function () {
    if (!this.eventsToday.length) return;
    if (this.visible) return;
    this.pendingShow = true;
    this.tryShowWhenIdle();
  },

  /** Slideshow gọi khi vừa xong một ảnh (hold xong / trước next) */
  onPhotoHoldComplete: function () {
    if (this.pendingShow) this.tryShowWhenIdle();
  },

  tryShowWhenIdle: function () {
    if (!this.pendingShow || this.visible) return;
    if (this.slideshowRef && this.slideshowRef._busy) return;
    this.pendingShow = false;
    /* Reset index về 0 để chiếu từ đầu danh sách */
    this.eventIndex = 0;
    this.showNext();
  },

  /**
   * Chiếu sự kiện tại eventIndex.
   * Khi xong → tự động chiếu sự kiện tiếp theo (nếu còn).
   * Sau khi hết tất cả → ẩn overlay, slideshow tiếp tục.
   */
  showNext: function () {
    if (!this.eventsToday.length) return;
    if (this.eventIndex >= this.eventsToday.length) {
      /* Hết tất cả sự kiện → trả lại slideshow */
      this.hide();
      if (this.slideshowRef && this.slideshowRef.isPlaying) {
        this.slideshowRef.scheduleAfterHold();
      }
      return;
    }

    var ev = this.eventsToday[this.eventIndex];
    this.render(ev);
    this.visible = true;

    /* Tạm dừng slideshow */
    if (this.slideshowRef && this.slideshowRef.timer) {
      clearTimeout(this.slideshowRef.timer);
      this.slideshowRef.timer = null;
    }

    var sec = (this.settings && this.settings.event_duration) || 60;
    sec = Math.max(5, Math.min(300, Number(sec) || 60));
    var self = this;

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(function () {
      self.eventIndex++;
      self.visible = false;
      self.showNext(); /* chiếu sự kiện tiếp theo */
    }, sec * 1000);
  },

  hide: function () {
    var el = document.getElementById('event-overlay');
    if (el) {
      el.classList.remove('show');
      el.innerHTML = ''; /* xóa iframe để dừng load */
    }
    this.visible = false;
  },

  render: function (ev) {
    var el = document.getElementById('event-overlay');
    if (!el) return;

    var frameUrl = this.buildFrameUrl(ev);
    el.className = 'event-overlay show';

    /* iframe chiếm toàn bộ overlay */
    el.innerHTML =
      '<iframe' +
        ' src="' + frameUrl + '"' +
        ' class="event-iframe"' +
        ' frameborder="0"' +
        ' scrolling="no"' +
        ' allowtransparency="true"' +
        ' title="Thiệp sự kiện"' +
      '></iframe>';
  }
};
