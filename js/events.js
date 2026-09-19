/**
 * events.js – Thiệp sinh nhật / kỷ niệm ngày cưới
 */
var EventCards = {
  eventsToday: [],
  eventIndex: 0,
  settings: null,
  startedAt: 0,
  intervalTimer: null,
  hideTimer: null,
  visible: false,
  pendingShow: false,
  slideshowRef: null,

  init: function (settings, slideshow) {
    this.settings = settings || Storage.getSettings();
    this.slideshowRef = slideshow;
  },

  setSettings: function (settings) {
    this.settings = settings || this.settings;
  },

  /**
   * events từ GAS – lọc đúng ngày hôm nay
   */
  setEventsFromConfig: function (allEvents) {
    var now = new Date();
    var m = now.getMonth() + 1;
    var d = now.getDate();
    var list = (allEvents || []).filter(function (ev) {
      return Number(ev.month) === m && Number(ev.day) === d;
    });
    this.eventsToday = list;
    this.eventIndex = 0;
    this.preloadImages();
  },

  preloadImages: function () {
    this.eventsToday.forEach(function (ev) {
      if (!ev.imageLink) return;
      var url = EventCards.toImageUrl(ev.imageLink);
      if (!url) return;
      var img = new Image();
      img.src = url;
      ev._resolvedUrl = url;
    });
  },

  toImageUrl: function (link) {
    if (!link) return '';
    // File id thuần
    if (/^[a-zA-Z0-9_-]{20,}$/.test(link.trim())) {
      return 'https://drive.google.com/uc?export=view&id=' + link.trim();
    }
    var m = link.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
      link.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
      link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) {
      return 'https://drive.google.com/uc?export=view&id=' + m[1];
    }
    if (/^https?:\/\//i.test(link)) return link;
    return '';
  },

  /** Gọi sau khi slideshow bắt đầu (ảnh đầu đã hiện) */
  onSlideshowStarted: function () {
    this.startedAt = Date.now();
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
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
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
    this.showNext();
  },

  showNext: function () {
    if (!this.eventsToday.length) return;
    var ev = this.eventsToday[this.eventIndex % this.eventsToday.length];
    this.eventIndex = (this.eventIndex + 1) % this.eventsToday.length;
    this.render(ev);
    this.visible = true;

    // Tạm dừng slideshow
    if (this.slideshowRef && this.slideshowRef.timer) {
      clearTimeout(this.slideshowRef.timer);
      this.slideshowRef.timer = null;
    }

    var sec = (this.settings && this.settings.event_duration) || 60;
    sec = Math.max(5, Math.min(300, Number(sec) || 60));
    var self = this;
    this.hideTimer = setTimeout(function () {
      self.hide();
      if (self.slideshowRef && self.slideshowRef.isPlaying) {
        self.slideshowRef.scheduleAfterHold();
      }
    }, sec * 1000);
  },

  hide: function () {
    var el = document.getElementById('event-overlay');
    if (el) el.classList.remove('show');
    this.visible = false;
  },

  pad2: function (n) {
    n = Number(n) || 0;
    return n < 10 ? '0' + n : String(n);
  },

  render: function (ev) {
    var el = document.getElementById('event-overlay');
    if (!el) return;

    var now = new Date();
    var N = Math.max(0, now.getFullYear() - Number(ev.year));
    var startDate = this.pad2(ev.day) + '/' + this.pad2(ev.month) + '/' + ev.year;
    var endDate = this.pad2(now.getDate()) + '/' + this.pad2(now.getMonth() + 1) + '/' + now.getFullYear();
    var range = startDate + ' – ' + endDate;
    var imgUrl = ev._resolvedUrl || this.toImageUrl(ev.imageLink);

    var isBirthday = ev.template === 'birthday';
    var frameSrc = isBirthday ? 'assets/frame-birthday.jpg' : 'assets/frame-wedding.jpg';

    el.className = 'event-overlay show ' + (isBirthday ? 'theme-birthday' : 'theme-wedding');

    var photoHtml = imgUrl
      ? '<img class="event-user-photo" src="' + imgUrl + '" alt="" />'
      : '<div class="event-user-photo event-user-photo-empty"></div>';

    var textHtml = '';
    if (isBirthday) {
      textHtml =
        '<p class="ev-line1">Chúc mừng sinh nhật</p>' +
        '<p class="ev-name">' + this.escapeHtml(ev.titleName || '') + '</p>' +
        '<p class="ev-count-label">Lần thứ</p>' +
        '<p class="ev-count-num">' + N + '</p>' +
        '<p class="ev-range">' + range + '</p>';
    } else {
      textHtml =
        '<p class="ev-line1">Kỷ niệm</p>' +
        '<p class="ev-count-num wedding-n">' + N + '</p>' +
        '<p class="ev-count-label">Năm ngày cưới</p>' +
        '<p class="ev-pair">' +
          this.escapeHtml(ev.pairLeft || '') +
          '<span class="ev-heart">♥</span>' +
          this.escapeHtml(ev.pairRight || '') +
        '</p>' +
        '<p class="ev-range">' + range + '</p>';
    }

    // Khung PNG/JPG mẫu + ảnh sự kiện đè vùng trái + chữ động vùng phải
    el.innerHTML =
      '<div class="event-card event-card-frame">' +
        '<img class="event-frame-bg" src="' + frameSrc + '" alt="" />' +
        '<div class="event-photo-slot">' + photoHtml + '</div>' +
        '<div class="event-text-slot">' + textHtml + '</div>' +
      '</div>';
  },

  escapeHtml: function (s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
};
