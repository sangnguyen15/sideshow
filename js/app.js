/**
 * app.js – UI + GAS config + settings cloud + events + slideshow
 *          + Remote Command (Giai đoạn 1: điều khiển từ xa qua remote.html)
 */
(function () {
  const panel = document.getElementById('control-panel');
  const btnOpenPanel = document.getElementById('btn-open-panel');
  const btnClosePanel = document.getElementById('btn-close-panel');
  const sourceList = document.getElementById('source-list');
  const sourcesHint = document.getElementById('sources-hint');
  const btnStart = document.getElementById('btn-start');
  const btnResume = document.getElementById('btn-resume');
  const btnApplyNow = document.getElementById('btn-apply-now');
  const btnResetProgress = document.getElementById('btn-reset-progress');
  const btnHardReload = document.getElementById('btn-hard-reload');
  const btnSaveCloud = document.getElementById('btn-save-cloud');
  const btnRefreshConfig = document.getElementById('btn-refresh-config');
  const btnSaveCloudFoot = document.getElementById('btn-save-cloud-foot');
  const btnRefreshConfigFoot = document.getElementById('btn-refresh-config-foot');
  const statusBar = document.getElementById('status-bar');

  const settingDuration = document.getElementById('setting-duration');
  const settingTransition = document.getElementById('setting-transition');
  const settingEffect = document.getElementById('setting-effect');
  const settingFit = document.getElementById('setting-fit');
  const settingIdle = document.getElementById('setting-idle');
  const settingShuffle = document.getElementById('setting-shuffle');
  const settingResume = document.getElementById('setting-resume');
  const settingEventDuration = document.getElementById('setting-event-duration');
  const settingEventInterval = document.getElementById('setting-event-interval');

  let sources = [];
  let apiKey = '';
  let lastUpdatedAt = '';
  let allEvents = [];
  let idleTimer = null;
  let isIdle = false;
  let isLoadingConfig = false;
  let pollTimer = null;

  /* Chống xử lý trùng lặp khi có 2 lượt poll chồng nhau xử lý cùng 1 lệnh */
  let remoteCmdBusy = false;

  const POLL_MS = 2 * 60 * 1000;

  function init() {
    applySettingsToUI(Storage.getSettings());
    bindEvents();
    hidePanel();
    hideGear();
    resetIdleTimer();

    var settings = Storage.getSettings();
    Slideshow.init(settings, updateStatus, showError);
    EventCards.init(settings, Slideshow);

    window.addEventListener('offline', function () {
      if (Slideshow.isPlaying) Slideshow.handleOffline();
    });
    window.addEventListener('online', function () {
      Slideshow.handleOnline();
    });

    startTelegramWatchers();
    loadConfigAndStart(true);
    startSettingsPoll();
  }

  function applySettingsToUI(s) {
    if (!s) return;
    settingDuration.value = s.duration;
    settingTransition.value = s.transition;
    settingEffect.value = s.effect;
    settingFit.value = s.fit;
    settingIdle.value = s.idle;
    settingShuffle.checked = !!s.shuffle;
    settingResume.checked = !!s.resume;
    if (settingEventDuration) settingEventDuration.value = s.event_duration != null ? s.event_duration : 60;
    if (settingEventInterval) settingEventInterval.value = s.event_interval_minutes != null ? s.event_interval_minutes : 60;
  }

  function collectSettingsFromUI() {
    return {
      duration: parseInt(settingDuration.value, 10) || 120,
      transition: parseFloat(settingTransition.value) || 30,
      effect: settingEffect.value,
      fit: settingFit.value || 'contain',
      idle: parseInt(settingIdle.value, 10) || 8,
      shuffle: settingShuffle.checked,
      resume: settingResume.checked,
      event_duration: parseInt(settingEventDuration && settingEventDuration.value, 10) || 60,
      event_interval_minutes: parseInt(settingEventInterval && settingEventInterval.value, 10) || 60
    };
  }

  function saveSettingsFromUI() {
    var settings = collectSettingsFromUI();
    Storage.saveSettings(settings);
    Slideshow.settings = settings;
    EventCards.setSettings(settings);
    return settings;
  }

  function applyRemoteSettings(settings, updatedAt) {
    if (!settings) return;
    var merged = Object.assign({}, Storage.defaults(), settings);
    Storage.saveSettings(merged);
    if (updatedAt) {
      lastUpdatedAt = updatedAt;
      Storage.saveSettingsUpdatedAt(updatedAt);
    }
    applySettingsToUI(merged);
    Slideshow.settings = merged;
    EventCards.setSettings(merged);
    if (Slideshow.isPlaying && EventCards.eventsToday.length) {
      EventCards.onSlideshowStarted();
    }
  }

  function bindEvents() {
    btnClosePanel.addEventListener('click', hidePanel);
    btnOpenPanel.addEventListener('click', showPanel);

    function doRefresh() {
      loadConfigAndStart(false);
    }
    function doSaveCloud() {
      saveSettingsToCloud();
    }

    if (btnRefreshConfig) btnRefreshConfig.addEventListener('click', doRefresh);
    if (btnRefreshConfigFoot) btnRefreshConfigFoot.addEventListener('click', doRefresh);
    if (btnSaveCloud) btnSaveCloud.addEventListener('click', doSaveCloud);
    if (btnSaveCloudFoot) btnSaveCloudFoot.addEventListener('click', doSaveCloud);

    if (btnHardReload) {
      btnHardReload.addEventListener('click', function () {
        if (!confirm('Tải lại bản app mới nhất từ server?\nTrang sẽ reload (code mới + Sheet/Drive mới).')) return;
        hardReloadApp();
      });
    }

    btnStart.addEventListener('click', function () { startSlideshow(false); });
    btnResume.addEventListener('click', function () { startSlideshow(true); });
    btnApplyNow.addEventListener('click', function () {
      saveSettingsFromUI();
      if (Slideshow.isPlaying) {
        Slideshow.applySettingsNow();
      } else {
        alert('Chưa đang chiếu. Setting đã lưu trên máy này.');
      }
    });
    btnResetProgress.addEventListener('click', function () {
      Storage.clearProgress();
      Storage.clearRecent();
      alert('Đã reset vị trí chiếu');
    });

    var settingEls = [
      settingDuration, settingTransition, settingEffect, settingFit, settingIdle,
      settingShuffle, settingResume, settingEventDuration, settingEventInterval
    ];
    settingEls.forEach(function (el) {
      if (el) el.addEventListener('change', saveSettingsFromUI);
    });

    ['mousemove', 'mousedown', 'pointerdown', 'touchstart', 'keydown'].forEach(function (evt) {
      document.addEventListener(evt, onUserActivity, { passive: true });
    });

    var panelBody = document.getElementById('panel-body') || panel.querySelector('.panel-body');

    function scrollPanelBy(dy) {
      if (!panelBody) panelBody = panel.querySelector('.panel-body');
      if (!panelBody) return;
      panelBody.scrollTop += dy;
    }

    document.addEventListener('wheel', function (e) {
      if (panel.classList.contains('hidden')) return;
      if (!panelBody) return;
      var dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 24;
      if (e.deltaMode === 2) dy *= panelBody.clientHeight;
      scrollPanelBy(dy);
      if (e.cancelable) e.preventDefault();
      onUserActivity();
    }, { passive: false, capture: true });

    var dragState = null;
    if (panelBody) {
      panelBody.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'SELECT' || t === 'BUTTON' || t === 'A' || t === 'LABEL') return;
        dragState = { y: e.clientY, scroll: panelBody.scrollTop };
        panelBody.classList.add('is-dragging');
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragState) return;
        panelBody.scrollTop = dragState.scroll + (dragState.y - e.clientY);
        onUserActivity();
      });
      document.addEventListener('mouseup', function () {
        if (!dragState) return;
        dragState = null;
        panelBody.classList.remove('is-dragging');
      });
    }

    var btnUp = document.getElementById('btn-panel-up');
    var btnDown = document.getElementById('btn-panel-down');
    if (btnUp) btnUp.addEventListener('click', function (e) { e.preventDefault(); scrollPanelBy(-120); onUserActivity(); });
    if (btnDown) btnDown.addEventListener('click', function (e) { e.preventDefault(); scrollPanelBy(120); onUserActivity(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (panel.classList.contains('hidden')) showPanel();
        else hidePanel();
        return;
      }
      if (!panel.classList.contains('hidden')) {
        var body = panel.querySelector('.panel-body');
        if (!body) return;
        var step = 80;
        if (e.key === 'ArrowDown' || e.key === 'PageDown') {
          e.preventDefault();
          body.scrollTop += (e.key === 'PageDown' ? step * 4 : step);
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault();
          body.scrollTop -= (e.key === 'PageUp' ? step * 4 : step);
        } else if (e.key === 'Home') {
          e.preventDefault();
          body.scrollTop = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          body.scrollTop = body.scrollHeight;
        }
      }
    });
  }

  function hardReloadApp() {
    var base = location.href.split('#')[0];
    var clean = base.split('?')[0];
    var go = function () {
      location.replace(clean + '?v=' + Date.now());
    };
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).catch(function () {}).then(go);
    } else {
      go();
    }
  }

  function showGear() {
    btnOpenPanel.classList.add('gear-visible');
  }
  function hideGear() {
    btnOpenPanel.classList.remove('gear-visible');
  }
  function onUserActivity() {
    if (panel.classList.contains('hidden')) showGear();
    resetIdleTimer();
  }

  function getGasUrl() {
    return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.GAS_URL) ? APP_CONFIG.GAS_URL : '';
  }

  function fetchConfigFromGAS() {
    return new Promise(function (resolve, reject) {
      var url = getGasUrl();
      if (!url || url.indexOf('DÁN_URL_GAS') !== -1) {
        reject(new Error('Chưa cấu hình GAS_URL trong js/config.js'));
        return;
      }
      var timeout = (APP_CONFIG && APP_CONFIG.GAS_TIMEOUT) || 15000;
      var timer = setTimeout(function () {
        reject(new Error('Hết thời gian chờ Google Sheet (timeout)'));
      }, timeout);

      var full = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();

      if (typeof fetch === 'function') {
        fetch(full, { method: 'GET', redirect: 'follow', cache: 'no-store' })
          .then(function (res) {
            clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(resolve)
          .catch(function (err) {
            clearTimeout(timer);
            reject(err);
          });
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', full, true);
        xhr.onload = function () {
          clearTimeout(timer);
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { reject(new Error('JSON không hợp lệ từ GAS')); }
          } else reject(new Error('HTTP ' + xhr.status));
        };
        xhr.onerror = function () {
          clearTimeout(timer);
          reject(new Error('Lỗi mạng khi gọi GAS'));
        };
        xhr.send();
      }
    });
  }

  function saveSettingsToCloud() {
    var url = getGasUrl();
    if (!url || url.indexOf('DÁN_URL_GAS') !== -1) {
      alert('Chưa cấu hình GAS_URL');
      return;
    }
    var pin = prompt('Nhập mã PIN lưu cấu hình (để trống nếu chưa đặt PIN):', '') || '';
    var settings = saveSettingsFromUI();

    var payload = JSON.stringify({
      action: 'saveSettings',
      pin: pin,
      settings: settings
    });

    Slideshow.showLoading(true);
    fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        Slideshow.showLoading(false);
        if (data && data.ok) {
          if (data.updatedAt) {
            lastUpdatedAt = data.updatedAt;
            Storage.saveSettingsUpdatedAt(data.updatedAt);
          }
          alert('Đã lưu cấu hình lên cloud.\nBox sẽ tự nhận trong ~2 phút (hoặc bấm Cập nhật trên box).');
        } else {
          alert('Lưu thất bại: ' + ((data && data.error) || 'unknown'));
        }
      })
      .catch(function (err) {
        Slideshow.showLoading(false);
        alert('Lỗi lưu cloud: ' + (err.message || err));
      });
  }

  /* ══════════════════════ REMOTE COMMAND (Giai đoạn 1) ══════════════════════ */

  /**
   * Báo cho GAS biết box đã xử lý xong lệnh (thành công/thất bại).
   * GAS sẽ tự xóa cờ lệnh trên Sheet + gửi Telegram báo kết quả.
   * KHÔNG cần PIN vì đây là bước dọn dẹp nội bộ, không phải khởi
   * tạo lệnh mới.
   */
  function ackRemoteCommandOnServer(command, status, message) {
    var url = getGasUrl();
    if (!url || url.indexOf('DÁN_URL_GAS') !== -1) return Promise.resolve(false);

    var payload = JSON.stringify({
      action: 'ackRemoteCommand',
      command: command,
      status: status,
      message: message || ''
    });

    return fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { return !!(data && data.ok); })
      .catch(function () { return false; });
  }

  /**
   * Kiểm tra dữ liệu vừa fetch từ GAS có lệnh điều khiển từ xa
   * đang chờ hay không (do remote.html đặt), và thực thi tương ứng.
   *
   * - reload_code : ACK trước rồi mới reload (vì trang sẽ điều
   *                 hướng đi mất, không gọi API được sau khi
   *                 navigate).
   * - reload_data : Tải lại nguồn ảnh + sự kiện, GIỮ NGUYÊN vị trí
   *                 đang chiếu (autoStart=true → tôn trọng
   *                 settings.resume đã lưu), rồi mới ACK theo đúng
   *                 kết quả thành công/thất bại thực tế.
   */
  function checkRemoteCommand(data) {
    if (remoteCmdBusy) return;
    var rc = data && data.remoteCommand;
    if (!rc || !rc.command) return;

    var command = rc.command;
    remoteCmdBusy = true;

    if (command === 'reload_code') {
      ackRemoteCommandOnServer('reload_code', 'triggered')
        .finally(function () {
          hardReloadApp();
          /* Trang sẽ điều hướng đi ngay sau đây, không cần reset cờ */
        });
      return;
    }

    if (command === 'reload_data') {
      loadConfigAndStart(true)
        .then(function () {
          return ackRemoteCommandOnServer('reload_data', 'success');
        })
        .catch(function (err) {
          return ackRemoteCommandOnServer('reload_data', 'error', (err && err.message) || String(err));
        })
        .finally(function () {
          remoteCmdBusy = false;
        });
      return;
    }

    /* Lệnh lạ không xác định – vẫn ACK để dọn cờ, tránh kẹt vĩnh viễn */
    ackRemoteCommandOnServer(command, 'error', 'Lệnh không xác định: ' + command)
      .finally(function () {
        remoteCmdBusy = false;
      });
  }

  /** Poll nhẹ: chỉ so updatedAt / settings + kiểm tra lệnh từ xa, không dừng chiếu */
  function startSettingsPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      pollConfigSoft();
    }, POLL_MS);
  }

  function pollConfigSoft() {
    fetchConfigFromGAS().then(function (data) {
      if (!data || data.error) return;

      /* Kiểm tra lệnh điều khiển từ xa trước tiên, độc lập với
         việc settings có đổi hay không */
      checkRemoteCommand(data);

      var remoteAt = data.updatedAt || '';
      if (data.settings) {
        var local = Storage.getSettings();
        var changed = false;
        ['duration', 'transition', 'effect', 'fit', 'idle', 'shuffle', 'resume', 'event_duration', 'event_interval_minutes'].forEach(function (k) {
          if (data.settings[k] !== undefined && String(data.settings[k]) !== String(local[k])) changed = true;
        });
        if (changed || (remoteAt && remoteAt !== lastUpdatedAt)) {
          applyRemoteSettings(data.settings, remoteAt);
          if (data.events) {
            allEvents = data.events;
            EventCards.setEventsFromConfig(allEvents);
          }
          updateStatus('Đã tự cập nhật cấu hình từ cloud');
        } else if (remoteAt) {
          lastUpdatedAt = remoteAt;
        }
      }
    }).catch(function () {});
  }

  async function loadConfigAndStart(autoStart) {
    if (isLoadingConfig) return;
    isLoadingConfig = true;

    EventCards.stop();
    Slideshow.stop();
    Slideshow.showLoading(true);
    if (sourcesHint) sourcesHint.textContent = 'Đang tải cấu hình từ Google Sheet...';
    sourceList.innerHTML = '';

    try {
      var data = await fetchConfigFromGAS();
      if (data.error) throw new Error(data.error);
      if (!data.apiKey) throw new Error('Sheet chưa có api_key trong tab Config');
      if (!data.sources || data.sources.length === 0) {
        throw new Error('Sheet chưa có thư mục ảnh nào (tab Sources)');
      }

      apiKey = data.apiKey;
      lastUpdatedAt = data.updatedAt || '';
      if (lastUpdatedAt) Storage.saveSettingsUpdatedAt(lastUpdatedAt);

      if (data.settings) {
        applyRemoteSettings(data.settings, data.updatedAt);
      }

      allEvents = data.events || [];
      EventCards.setEventsFromConfig(allEvents);

      sources = data.sources.map(function (s, idx) {
        var folderId = Drive.extractFolderId(s.link);
        return {
          id: folderId || ('src-' + idx),
          name: s.name || ('Folder ' + (idx + 1)),
          link: s.link,
          photos: []
        };
      }).filter(function (s) { return s.id; });

      if (!sources.length) throw new Error('Không trích xuất được Folder ID từ các link trong Sheet');

      for (var i = 0; i < sources.length; i++) {
        if (sourcesHint) {
          sourcesHint.textContent = 'Đang tải ảnh folder ' + (i + 1) + '/' + sources.length + '...';
        }
        try {
          sources[i].photos = await Drive.listImages(sources[i].id, apiKey);
        } catch (err) {
          console.warn('Lỗi folder', sources[i].name, err);
          sources[i].photos = [];
        }
      }

      sources = sources.filter(function (s) { return s.photos && s.photos.length > 0; });
      if (!sources.length) {
        throw new Error('Không lấy được ảnh nào. Kiểm tra folder đã share "Anyone with the link".');
      }

      renderSourceList();
      if (sourcesHint) {
        sourcesHint.textContent = 'Đã tải ' + sources.length + ' thư mục · Sự kiện hôm nay: ' +
          EventCards.eventsToday.length + ' · ' + new Date().toLocaleTimeString();
      }

      Slideshow.showLoading(false);
      isLoadingConfig = false;

      if (autoStart) {
        startSlideshow(!!Storage.getSettings().resume);
      } else {
        startSlideshow(false);
      }
    } catch (err) {
      console.error(err);
      Slideshow.showLoading(false);
      isLoadingConfig = false;
      if (sourcesHint) sourcesHint.textContent = 'Lỗi: ' + (err.message || err);
      renderSourceList();
      /* Ném lỗi tiếp để checkRemoteCommand() bắt được và báo Telegram
         thất bại thay vì chỉ alert() im lặng trên box */
      throw err;
    }
  }

  function renderSourceList() {
    sourceList.innerHTML = '';
    if (!sources.length) {
      var li = document.createElement('li');
      li.textContent = 'Chưa có thư mục nào';
      sourceList.appendChild(li);
      return;
    }
    sources.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s.name + ' (' + (s.photos ? s.photos.length : 0) + ' ảnh)';
      sourceList.appendChild(li);
    });
  }

  async function startSlideshow(resume) {
    saveSettingsFromUI();

    if (!apiKey) {
      alert('Chưa có API Key (lấy từ Google Sheet). Bấm Cập nhật.');
      return;
    }
    if (!sources.length) {
      alert('Chưa có thư mục ảnh. Kiểm tra Google Sheet hoặc bấm Cập nhật.');
      return;
    }

    var needFetch = sources.some(function (s) { return !s.photos || !s.photos.length; });
    if (needFetch) {
      Slideshow.showLoading(true);
      try {
        for (var i = 0; i < sources.length; i++) {
          if (!sources[i].photos || !sources[i].photos.length) {
            sources[i].photos = await Drive.listImages(sources[i].id, apiKey);
          }
        }
        sources = sources.filter(function (s) { return s.photos && s.photos.length; });
      } catch (err) {
        alert('Lỗi tải ảnh: ' + err.message);
        Slideshow.showLoading(false);
        return;
      }
      Slideshow.showLoading(false);
    }

    function shuffleArr(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }

    var playSources;
    if (Slideshow.settings.shuffle) {
      var allPhotos = [];
      sources.forEach(function (s) {
        (s.photos || []).forEach(function (p) { allPhotos.push(p); });
      });
      shuffleArr(allPhotos);
      playSources = [{
        id: 'merged-all',
        name: 'Tất cả (' + allPhotos.length + ' ảnh)',
        link: '',
        photos: allPhotos
      }];
    } else {
      playSources = sources.map(function (s) {
        var photos = (s.photos || []).slice();
        shuffleArr(photos);
        return { id: s.id, name: s.name, link: s.link, photos: photos };
      });
    }

    Slideshow.setSources(playSources);
    hidePanel();
    await Slideshow.start(resume);
    EventCards.setSettings(Storage.getSettings());
    EventCards.onSlideshowStarted();
    startTelegramWatchers();
  }

  function notifyTelegram(event) {
    return new Promise(function (resolve) {
      try {
        var base = getGasUrl();
        if (!base || base.indexOf('DÁN_URL_GAS') !== -1) {
          resolve(false);
          return;
        }
        var url = base + (base.indexOf('?') >= 0 ? '&' : '?') +
          'action=notify&event=' + encodeURIComponent(event) + '&_t=' + Date.now();
        if (typeof fetch === 'function') {
          fetch(url, { method: 'GET', mode: 'cors', redirect: 'follow', cache: 'no-store' })
            .then(function (res) { resolve(!!res && res.ok !== false); })
            .catch(function () { resolve(false); });
        } else {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.onload = function () { resolve(xhr.status >= 200 && xhr.status < 400); };
          xhr.onerror = function () { resolve(false); };
          xhr.send();
        }
      } catch (err) {
        resolve(false);
      }
    });
  }

  var telegramWatchTimer = null;
  var telegramSending = { on: false, still_on: false };

  function todayKey(now) {
    now = now || new Date();
    return now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  }

  function trySendOncePerDay(event, storageKey, day) {
    if (telegramSending[event]) return;
    try {
      if (localStorage.getItem(storageKey) === day) return;
    } catch (e) {}
    telegramSending[event] = true;
    notifyTelegram(event).then(function (ok) {
      telegramSending[event] = false;
      if (ok) {
        try { localStorage.setItem(storageKey, day); } catch (e2) {}
      }
    });
  }

  function startTelegramWatchers() {
    if (telegramWatchTimer) return;
    function tick() {
      var now = new Date();
      var h = now.getHours();
      var m = now.getMinutes();
      var day = todayKey(now);
      if (h > 7 || (h === 7 && m >= 5)) {
        trySendOncePerDay('on', 'telegram_on_date', day);
      }
      if (Slideshow.isPlaying && (h > 22 || (h === 22 && m >= 1))) {
        trySendOncePerDay('still_on', 'telegram_still_on_date', day);
      }
    }
    tick();
    telegramWatchTimer = setInterval(tick, 60 * 1000);
  }

  function hidePanel() {
    panel.classList.add('hidden');
    resetIdleTimer();
  }
  function showPanel() {
    panel.classList.remove('hidden');
    hideGear();
    document.body.classList.remove('idle');
    isIdle = false;
    resetIdleTimer();
  }
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    document.body.classList.remove('idle');
    isIdle = false;
    var idleSec = parseInt(settingIdle.value, 10) || 8;
    idleTimer = setTimeout(function () {
      isIdle = true;
      document.body.classList.add('idle');
      panel.classList.add('hidden');
      hideGear();
    }, idleSec * 1000);
  }

  function updateStatus(text) {
    if (statusBar) statusBar.textContent = text || '';
  }
  function showError(msg) {
    console.error(msg);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
