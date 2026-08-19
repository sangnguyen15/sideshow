/**
 * app.js – Điều khiển giao diện + kết nối các module
 */

(function () {
  // Elements
  const panel = document.getElementById('control-panel');
  const btnOpenPanel = document.getElementById('btn-open-panel');
  const btnClosePanel = document.getElementById('btn-close-panel');
  const inputLink = document.getElementById('input-drive-link');
  const btnAddSource = document.getElementById('btn-add-source');
  const sourceList = document.getElementById('source-list');
  const inputApiKey = document.getElementById('input-api-key');
  const btnSaveKey = document.getElementById('btn-save-key');
  const btnStart = document.getElementById('btn-start');
  const btnResume = document.getElementById('btn-resume');
  const btnResetProgress = document.getElementById('btn-reset-progress');
  const statusBar = document.getElementById('status-bar');

  // Settings inputs
  const settingDuration = document.getElementById('setting-duration');
  const settingTransition = document.getElementById('setting-transition');
  const settingEffect = document.getElementById('setting-effect');
  const settingFit = document.getElementById('setting-fit');
  const settingIdle = document.getElementById('setting-idle');
  const settingShuffle = document.getElementById('setting-shuffle');
  const settingResume = document.getElementById('setting-resume');

  let sources = []; // {id, name, link, photos: []}
  let idleTimer = null;
  let isIdle = false;

  // ---------- Init ----------
  function init() {
    // Load saved data
    sources = Storage.getSources();
    const settings = Storage.getSettings();
    const apiKey = Storage.getApiKey();

    // Fill UI
    inputApiKey.value = apiKey;
    settingDuration.value = settings.duration;
    settingTransition.value = settings.transition;
    settingEffect.value = settings.effect;
    settingFit.value = settings.fit;
    settingIdle.value = settings.idle;
    settingShuffle.checked = settings.shuffle;
    settingResume.checked = settings.resume;

    renderSourceList();
    bindEvents();
    resetIdleTimer();

    // Init slideshow engine
    Slideshow.init(settings, updateStatus, showError);

    // Auto start if có nguồn + đã có progress (tiện cho TV box)
    if (sources.length > 0 && apiKey && settings.resume) {
      // Không tự chạy ngay để người dùng kịp chỉnh, chỉ khi bấm
    }
  }

  // ---------- Events ----------
  function bindEvents() {
    btnClosePanel.addEventListener('click', hidePanel);
    btnOpenPanel.addEventListener('click', showPanel);

    btnAddSource.addEventListener('click', addSource);
    inputLink.addEventListener('keydown', e => {
      if (e.key === 'Enter') addSource();
    });

    btnSaveKey.addEventListener('click', () => {
      const key = inputApiKey.value.trim();
      Storage.saveApiKey(key);
      alert('Đã lưu API Key');
    });

    btnStart.addEventListener('click', () => startSlideshow(false));
    btnResume.addEventListener('click', () => startSlideshow(true));
    btnResetProgress.addEventListener('click', () => {
      Storage.clearProgress();
      Storage.clearRecent();
      alert('Đã reset vị trí chiếu');
    });

    // Settings change → save
    [settingDuration, settingTransition, settingEffect, settingFit, settingIdle, settingShuffle, settingResume].forEach(el => {
      el.addEventListener('change', saveSettingsFromUI);
    });

    // Idle detection
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'].forEach(evt => {
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    // Remote / keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (isIdle) {
          showPanel();
        } else {
          hidePanel();
        }
      }
      if (e.key === ' ' || e.key === 'Enter') {
        if (!panel.classList.contains('hidden')) return;
        // Space = pause/resume nếu cần sau này
      }
    });
  }

  // ---------- Sources ----------
  async function addSource() {
    const link = inputLink.value.trim();
    if (!link) return;

    const folderId = Drive.extractFolderId(link);
    if (!folderId) {
      alert('Không nhận diện được Folder ID từ link.\nHãy dán đúng link folder Google Drive.');
      return;
    }

    // Tránh trùng
    if (sources.some(s => s.id === folderId)) {
      alert('Folder này đã được thêm rồi.');
      return;
    }

    const apiKey = Storage.getApiKey() || inputApiKey.value.trim();
    if (!apiKey) {
      alert('Vui lòng nhập Google Drive API Key trước.');
      return;
    }

    btnAddSource.disabled = true;
    btnAddSource.textContent = 'Đang tải...';

    try {
      const photos = await Drive.listImages(folderId, apiKey);
      if (photos.length === 0) {
        alert('Folder không có ảnh hoặc chưa share "Anyone with the link".');
        return;
      }

      const name = `Folder ${sources.length + 1} (${photos.length} ảnh)`;
      sources.push({
        id: folderId,
        name,
        link,
        photos
      });

      Storage.saveSources(sources.map(s => ({
        id: s.id,
        name: s.name,
        link: s.link
        // không lưu photos vào localStorage (quá lớn)
      })));

      inputLink.value = '';
      renderSourceList();
      alert(`Đã thêm ${photos.length} ảnh từ folder.`);
    } catch (err) {
      console.error(err);
      alert('Lỗi khi lấy ảnh: ' + (err.message || err));
    } finally {
      btnAddSource.disabled = false;
      btnAddSource.textContent = 'Thêm';
    }
  }

  function renderSourceList() {
    sourceList.innerHTML = '';
    sources.forEach((s, idx) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${s.name || s.id}</span>
        <button class="remove" data-idx="${idx}" title="Xóa">✕</button>
      `;
      sourceList.appendChild(li);
    });

    sourceList.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.dataset.idx, 10);
        sources.splice(idx, 1);
        Storage.saveSources(sources.map(s => ({
          id: s.id,
          name: s.name,
          link: s.link
        })));
        renderSourceList();
      });
    });
  }

  // ---------- Settings ----------
  function saveSettingsFromUI() {
    const settings = {
      duration: parseInt(settingDuration.value, 10) || 5,
      transition: parseFloat(settingTransition.value) || 1.0,
      effect: settingEffect.value,
      fit: settingFit.value || 'contain',
      idle: parseInt(settingIdle.value, 10) || 8,
      shuffle: settingShuffle.checked,
      resume: settingResume.checked
    };
    Storage.saveSettings(settings);
    Slideshow.settings = settings;
  }

  // ---------- Start slideshow ----------
  async function startSlideshow(resume) {
    saveSettingsFromUI();

    const apiKey = Storage.getApiKey() || inputApiKey.value.trim();
    if (!apiKey) {
      alert('Chưa có API Key');
      return;
    }

    if (sources.length === 0) {
      alert('Chưa có nguồn ảnh nào');
      return;
    }

    // Nếu sources chưa có photos (mới load từ localStorage) → fetch lại
    const needFetch = sources.some(s => !s.photos || s.photos.length === 0);
    if (needFetch) {
      Slideshow.showLoading(true);
      try {
        for (const s of sources) {
          if (!s.photos || s.photos.length === 0) {
            s.photos = await Drive.listImages(s.id, apiKey);
          }
        }
        // Loại bỏ folder rỗng
        sources = sources.filter(s => s.photos && s.photos.length > 0);
        if (sources.length === 0) {
          alert('Không lấy được ảnh từ các folder.');
          Slideshow.showLoading(false);
          return;
        }
      } catch (err) {
        alert('Lỗi tải ảnh: ' + err.message);
        Slideshow.showLoading(false);
        return;
      }
      Slideshow.showLoading(false);
    }

    // Shuffle nếu cần
    if (Slideshow.settings.shuffle) {
      sources.forEach(s => {
        for (let i = s.photos.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [s.photos[i], s.photos[j]] = [s.photos[j], s.photos[i]];
        }
      });
    }

    Slideshow.setSources(sources);
    hidePanel();
    await Slideshow.start(resume);
  }

  // ---------- Panel & Idle ----------
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

    const idleSec = parseInt(settingIdle.value, 10) || 8;
    idleTimer = setTimeout(() => {
      // Chỉ ẩn khi đang chiếu
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

  // ---------- Boot ----------
  init();
})();
