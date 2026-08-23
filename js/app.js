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
      // Làm mới: dừng + load lại từ đầu
      loadConfigAndStart(false);
    });

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

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'].forEach(function (evt) {
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (isIdle) showPanel();
        else hidePanel();
      }
    });
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
      duration: parseInt(settingDuration.value, 10) || 5,
      transition: parseFloat(settingTransition.value) || 8,
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

    if (Slideshow.settings.shuffle) {
      sources.forEach(function (s) {
        for (var i = s.photos.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = s.photos[i];
          s.photos[i] = s.photos[j];
          s.photos[j] = t;
        }
      });
    }

    Slideshow.setSources(sources);
    hidePanel();
    await Slideshow.start(resume);
  }

  function hidePanel() {
    panel.classList.add('hidden');
    btnOpenPanel.classList.add('show');
    resetIdleTimer();
  }

  function showPanel() {
    panel.classList.remove('hidden');
    btnOpenPanel.classList.remove('show');
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
      if (Slideshow.isPlaying) {
        document.body.classList.add('idle');
        isIdle = true;
        panel.classList.add('hidden');
        btnOpenPanel.classList.remove('show');
      }
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
