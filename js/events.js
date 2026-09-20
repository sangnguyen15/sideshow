/**
 * events.js – Thiệp sinh nhật / kỷ niệm ngày cưới
 * - Dùng iframe trỏ vào preview-frames/
 * - Nhiều sự kiện trong ngày → chiếu lần lượt liên tiếp
 * - Fix: _busy = false + delay trước khi trả slideshow
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
    this.settings = settings || Storage.getSettings();
    this.slideshowRef = slideshow;
  },

  setSettings: function (settings) {
    this.settings = settings || this.settings;
  },

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

  onSlideshowStarted: function () {
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
    this.hide();
    this.pendingShow = false;
  },

  requestShow: function () {
    if (!this.eventsToday.length) return;
    if (this.visible) return;
    this.pendingShow = true;
    this.tryShowWhenIdle();
  },

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

    /* Hết tất cả sự kiện → trả lại slideshow */
    if (this.eventIndex >= this.eventsToday.length) {
      this.hide();
      var self = this;
      setTimeout(function () {
        if (self.slideshowRef) {
          self.slideshowRef._busy = false;
          if (self.slideshowRef.isPlaying) {
            self.slideshowRef.scheduleAfterHold();
          }
        }
      }, 400);
      return;
    }

    var ev = this.eventsToday[this.eventIndex];
    this.render(ev);
    this.visible = true;

    /* Tạm dừng slideshow, reset _busy */
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
      self.visible = false;
      self.eventIndex++;
      self.showNext();
    }, sec * 1000);
  },

  hide: function () {
    var el = document.getElementById('event-overlay');
    if (el) {
      el.classList.remove('show');
      setTimeout(function () { el.innerHTML = ''; }, 500);
    }
    this.visible = false;
  },

  render: function (ev) {
    var el = document.getElementById('event-overlay');
    if (!el) return;

    var frameUrl = this.buildFrameUrl(ev);
    el.className = 'event-overlay show';

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
