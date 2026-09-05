/**
 * app.js – Giao diện + lấy cấu hình từ Google Apps Script + điều khiển slideshow
 */

(function () {
  const panel = document.getElementById('control-panel');
  const btnOpenPanel = document.getElementById('btn-open-panel');
  const btnClosePanel = document.getElementById('btn-close-panel');
  const sourceList = document.getElementById('source-list');
  const sourcesHint = document.getElementById('sources-hint');
  const btnRefreshSources = document.getElementById('btn-refresh-sources');
  const btnStart = document.getElementById('btn-start');
  const btnResume = document.getElementById('btn-resume');
  const btnApplyNow = document.getElementById('btn-apply-now');
  const btnResetProgress = document.getElementById('btn-reset-progress');
  const btnHardReload = document.getElementById('btn-hard-reload');
  const statusBar = document.getElementById('status-bar');

  const settingDuration = document.getElementById('setting-duration');
  const settingTransition = document.getElementById('setting-transition');
  const settingEffect = document.getElementById('setting-effect');
  const settingFit = document.getElementById('setting-fit');
  const settingIdle = document.getElementById('setting-idle');
  const settingShuffle = document.getElementById('setting-shuffle');
  const settingResume = document.getElementById('setting-resume');

  // Runtime state
  let sources = [];          // {id, name, link, photos: []}
  let apiKey = '';
  let idleTimer = null;
  let isIdle = false;
  let isLoadingConfig = false;

  function init() {
    const settings = Storage.getSettings();

    settingDuration.value = settings.duration;
    settingTransition.value = settings.transition;
    settingEffect.value = settings.effect;
    settingFit.value = settings.fit;
    settingIdle.value = settings.idle;
    settingShuffle.checked = settings.shuffle;
    settingResume.checked = settings.resume;

    bindEvents();
    // Lần đầu vào trang: ẩn panel, ẩn bánh răng
    hidePanel();
    hideGear();
    resetIdleTimer();
    Slideshow.init(settings, updateStatus, showError);

    window.addEventListener('offline', function () {
      if (Slideshow.isPlaying) Slideshow.handleOffline();
    });
    window.addEventListener('online', function () {
      Slideshow.handleOnline();
    });

    // Tự load cấu hình từ GAS rồi tự chiếu
    loadConfigAndStart(true);
  }

  function bindEvents() {
    btnClosePanel.addEventListener('click', hidePanel);
    btnOpenPanel.addEventListener('click', showPanel);

    btnRefreshSources.addEventListener('click', function () {
      // Chỉ cập nhật Sheet/Drive, không reload code
      loadConfigAndStart(false);
    });

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
        alert('Chưa đang chiếu. Setting đã được lưu.');
      }
    });
    btnResetProgress.addEventListener('click', function () {
      Storage.clearProgress();
      Storage.clearRecent();
      alert('Đã reset vị trí chiếu');
    });

    [settingDuration, settingTransition, settingEffect, settingFit, settingIdle, settingShuffle, settingResume].forEach(function (el) {
      el.addEventListener('change', saveSettingsFromUI);
    });

    // Di chuyển chuột / chạm → hiện bánh răng + reset idle
    ['mousemove', 'mousedown', 'pointerdown', 'touchstart', 'keydown'].forEach(function (evt) {
      document.addEventListener(evt, onUserActivity, { passive: true });
    });

    var panelBody = document.getElementById('panel-body') || panel.querySelector('.panel-body');

    function scrollPanelBy(dy) {
      if (!panelBody) panelBody = panel.querySelector('.panel-body');
      if (!panelBody) return;
      panelBody.scrollTop += dy;
    }

    // 1) Lăn chuột / trackpad
    document.addEventListener('wheel', function (e) {
      if (panel.classList.contains('hidden')) return;
      if (!panelBody) return;
      var dy = e.deltaY;
      // deltaMode: 1 = dòng, 2 = trang
      if (e.deltaMode === 1) dy *= 24;
      if (e.deltaMode === 2) dy *= panelBody.clientHeight;
      scrollPanelBy(dy);
      if (e.cancelable) e.preventDefault();
      onUserActivity();
    }, { passive: false, capture: true });

    // 2) Kéo chuột (drag) để cuộn – dùng khi wheel không ăn trên WebView
    var dragState = null;
    if (panelBody) {
      panelBody.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        // không bắt đầu drag khi bấm input/button/select
        var t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'SELECT' || t === 'BUTTON' || t === 'A' || t === 'LABEL') return;
        dragState = { y: e.clientY, scroll: panelBody.scrollTop };
        panelBody.classList.add('is-dragging');
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragState) return;
        var dy = dragState.y - e.clientY;
        panelBody.scrollTop = dragState.scroll + dy;
        onUserActivity();
      });
      document.addEventListener('mouseup', function () {
        if (!dragState) return;
        dragState = null;
        panelBody.classList.remove('is-dragging');
      });
    }

    // 3) Nút ▲ ▼
    var btnUp = document.getElementById('btn-panel-up');
    var btnDown = document.getElementById('btn-panel-down');
    if (btnUp) {
      btnUp.addEventListener('click', function (e) {
        e.preventDefault();
        scrollPanelBy(-120);
        onUserActivity();
      });
    }
    if (btnDown) {
      btnDown.addEventListener('click', function (e) {
        e.preventDefault();
        scrollPanelBy(120);
        onUserActivity();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (panel.classList.contains('hidden')) showPanel();
        else hidePanel();
        return;
      }
      // Cuộn panel bằng phím khi menu đang mở (TV / màn nhỏ)
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
    // Ép tải bản mới: bỏ cache query cũ, gắn timestamp
    var base = location.href.split('#')[0];
    var clean = base.split('?')[0];
    // Xóa Cache API nếu có (PWA/kiosk đôi khi giữ)
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
    // Hiện bánh răng khi có tương tác (chuột / phím / chạm)
    if (panel.classList.contains('hidden')) {
      showGear();
    }
    resetIdleTimer();
  }

  /**
   * Gọi Google Apps Script lấy apiKey + danh sách sources
   */
  function fetchConfigFromGAS() {
    return new Promise(function (resolve, reject) {
      var url = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.GAS_URL) ? APP_CONFIG.GAS_URL : '';
      if (!url || url.indexOf('DÁN_URL_GAS') !== -1) {
        reject(new Error('Chưa cấu hình GAS_URL trong js/config.js'));
        return;
      }

      var timeout = (APP_CONFIG && APP_CONFIG.GAS_TIMEOUT) || 15000;
      var timer = setTimeout(function () {
        reject(new Error('Hết thời gian chờ Google Sheet (timeout)'));
      }, timeout);

      // Dùng fetch nếu có, fallback XMLHttpRequest cho máy cũ
      if (typeof fetch === 'function') {
        fetch(url, { method: 'GET', redirect: 'follow' })
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
        xhr.open('GET', url, true);
        xhr.onload = function () {
          clearTimeout(timer);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(new Error('JSON không hợp lệ từ GAS'));
            }
          } else {
            reject(new Error('HTTP ' + xhr.status));
          }
        };
        xhr.onerror = function () {
          clearTimeout(timer);
          reject(new Error('Lỗi mạng khi gọi GAS'));
        };
        xhr.send();
      }
    });
  }

  /**
   * Load config từ GAS → lấy ảnh Drive → (tuỳ chọn) bắt đầu chiếu
   * @param {boolean} autoStart - true = tự chiếu sau khi load
   */
  async function loadConfigAndStart(autoStart) {
    if (isLoadingConfig) return;
    isLoadingConfig = true;

    Slideshow.stop();
    Slideshow.showLoading(true);
    if (sourcesHint) sourcesHint.textContent = 'Đang tải cấu hình từ Google Sheet...';
    sourceList.innerHTML = '';

    try {
      var data = await fetchConfigFromGAS();

      if (data.error) {
        throw new Error(data.error);
      }
      if (!data.apiKey) {
        throw new Error('Sheet chưa có api_key trong tab Config');
      }
      if (!data.sources || data.sources.length === 0) {
        throw new Error('Sheet chưa có thư mục ảnh nào (tab Sources)');
      }

      apiKey = data.apiKey;

      // Build sources (chưa có photos)
      sources = data.sources.map(function (s, idx) {
        var folderId = Drive.extractFolderId(s.link);
        return {
          id: folderId || ('src-' + idx),
          name: s.name || ('Folder ' + (idx + 1)),
          link: s.link,
          photos: []
        };
      }).filter(function (s) { return s.id; });

      if (sources.length === 0) {
        throw new Error('Không trích xuất được Folder ID từ các link trong Sheet');
      }

      // Lấy danh sách ảnh từng folder
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

      // Bỏ folder không có ảnh
      sources = sources.filter(function (s) { return s.photos && s.photos.length > 0; });

      if (sources.length === 0) {
        throw new Error('Không lấy được ảnh nào. Kiểm tra folder đã share "Anyone with the link" chưa.');
      }

      renderSourceList();
      if (sourcesHint) {
        sourcesHint.textContent = 'Đã tải ' + sources.length + ' thư mục. Cập nhật lúc ' + new Date().toLocaleTimeString();
      }

      Slideshow.showLoading(false);
      isLoadingConfig = false;

      if (autoStart) {
        var settings = Storage.getSettings();
        startSlideshow(!!settings.resume);
      } else {
        // Làm mới thủ công → luôn bắt đầu lại từ đầu
        startSlideshow(false);
      }
    } catch (err) {
      console.error(err);
      Slideshow.showLoading(false);
      isLoadingConfig = false;
      if (sourcesHint) sourcesHint.textContent = 'Lỗi: ' + (err.message || err);
      renderSourceList();
      alert('Không tải được cấu hình:\n' + (err.message || err));
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
      var count = (s.photos && s.photos.length) ? s.photos.length : 0;
      li.innerHTML = '<span>' + escapeHtml(s.name) + ' <small style="opacity:0.6">(' + count + ' ảnh)</small></span>';
      sourceList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function saveSettingsFromUI() {
    var settings = {
      duration: parseInt(settingDuration.value, 10) || 120,
      transition: parseFloat(settingTransition.value) || 30,
      effect: settingEffect.value,
      fit: settingFit.value || 'contain',
      idle: parseInt(settingIdle.value, 10) || 8,
      shuffle: settingShuffle.checked,
      resume: settingResume.checked
    };
    Storage.saveSettings(settings);
    Slideshow.settings = settings;
  }

  async function startSlideshow(resume) {
    saveSettingsFromUI();

    if (!apiKey) {
      alert('Chưa có API Key (lấy từ Google Sheet). Bấm "Làm mới danh sách thư mục".');
      return;
    }
    if (!sources.length) {
      alert('Chưa có thư mục ảnh. Kiểm tra Google Sheet hoặc bấm Làm mới.');
      return;
    }

    // Nếu thiếu photos (hiếm) → fetch lại
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
      // Bật: gộp tất cả ảnh mọi folder → xáo một lần
      var allPhotos = [];
      sources.forEach(function (s) {
        (s.photos || []).forEach(function (p) {
          allPhotos.push(p);
        });
      });
      shuffleArr(allPhotos);
      playSources = [{
        id: 'merged-all',
        name: 'Tất cả (' + allPhotos.length + ' ảnh)',
        link: '',
        photos: allPhotos
      }];
    } else {
      // Tắt: xáo trong từng folder, chiếu hết folder này mới sang folder khác
      playSources = sources.map(function (s) {
        var photos = (s.photos || []).slice();
        shuffleArr(photos);
        return {
          id: s.id,
          name: s.name,
          link: s.link,
          photos: photos
        };
      });
    }

    Slideshow.setSources(playSources);
    hidePanel();
    await Slideshow.start(resume);
    // Báo Telegram: box đã bật / slideshow chạy
    notifyTelegram('on');
    startStillOnWatcher();
  }

  /**
   * Gửi notify qua GAS → Telegram
   * event: 'on' | 'still_on'
   */
  function notifyTelegram(event) {
    try {
      var base = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.GAS_URL) ? APP_CONFIG.GAS_URL : '';
      if (!base || base.indexOf('DÁN_URL_GAS') !== -1) return;

      var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'action=notify&event=' + encodeURIComponent(event);

      if (typeof fetch === 'function') {
        fetch(url, { method: 'GET', mode: 'cors', redirect: 'follow' }).catch(function () {});
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.send();
      }
    } catch (err) {
      console.warn('notifyTelegram', err);
    }
  }

  var stillOnTimer = null;

  /**
   * Mỗi phút kiểm tra: nếu >= 22:01 và vẫn đang chiếu → gửi still_on 1 lần/ngày
   */
  function startStillOnWatcher() {
    if (stillOnTimer) return;
    stillOnTimer = setInterval(function () {
      if (!Slideshow.isPlaying) return;

      var now = new Date();
      var h = now.getHours();
      var m = now.getMinutes();
      // 22:01 trở đi
      if (h < 22 || (h === 22 && m < 1)) return;

      var dayKey = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
      try {
        if (localStorage.getItem('telegram_still_on_date') === dayKey) return;
        localStorage.setItem('telegram_still_on_date', dayKey);
      } catch (e) {}

      notifyTelegram('still_on');
    }, 60 * 1000);
  }

  function hidePanel() {
    panel.classList.add('hidden');
    // Ẩn panel nhưng vẫn có thể hiện gear nếu vừa có hoạt động
    resetIdleTimer();
  }

  function showPanel() {
    panel.classList.remove('hidden');
    hideGear(); // panel đang mở → không cần icon
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
      // Ẩn panel + bánh răng khi không tương tác
      panel.classList.add('hidden');
      hideGear();
    }, idleSec * 1000);
  }

  function updateStatus(text) {
    statusBar.textContent = text || '';
  }

  function showError(msg) {
    alert(msg);
  }

  init();
})();
