/**
 * storage.js – Quản lý localStorage
 * Lưu: sources, settings, progress, recent photos
 */

const Storage = {
  KEYS: {
    sources: 'fps_sources',
    settings: 'fps_settings',
    progress: 'fps_progress',
    apiKey: 'fps_api_key',
    recent: 'fps_recent'
  },

  getSources() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.sources)) || [];
    } catch {
      return [];
    }
  },

  saveSources(list) {
    localStorage.setItem(this.KEYS.sources, JSON.stringify(list));
  },

  getSettings() {
    const defaults = {
      duration: 120,
      transition: 30,
      effect: 'random',
      fit: 'contain',
      idle: 8,
      shuffle: true,
      resume: true
    };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(this.KEYS.settings)) };
    } catch {
      return defaults;
    }
  },

  saveSettings(settings) {
    localStorage.setItem(this.KEYS.settings, JSON.stringify(settings));
  },

  getApiKey() {
    return localStorage.getItem(this.KEYS.apiKey) || '';
  },

  saveApiKey(key) {
    localStorage.setItem(this.KEYS.apiKey, key);
  },

  getProgress() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.progress)) || null;
    } catch {
      return null;
    }
  },

  saveProgress(progress) {
    // progress = { sourceIndex, photoIndex, timestamp }
    localStorage.setItem(this.KEYS.progress, JSON.stringify(progress));
  },

  clearProgress() {
    localStorage.removeItem(this.KEYS.progress);
  },

  getRecent() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.recent)) || [];
    } catch {
      return [];
    }
  },

  addRecent(photoId) {
    let recent = this.getRecent();
    // Keep last 120 photos
    recent = recent.filter(id => id !== photoId);
    recent.unshift(photoId);
    if (recent.length > 120) recent = recent.slice(0, 120);
    localStorage.setItem(this.KEYS.recent, JSON.stringify(recent));
  },

  clearRecent() {
    localStorage.removeItem(this.KEYS.recent);
  }
};
