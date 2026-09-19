/**
 * storage.js – localStorage (cache + progress)
 */
const Storage = {
  KEYS: {
    sources: 'fps_sources',
    settings: 'fps_settings',
    progress: 'fps_progress',
    apiKey: 'fps_api_key',
    recent: 'fps_recent',
    settingsUpdatedAt: 'fps_settings_updated_at'
  },

  defaults: function () {
    return {
      duration: 120,
      transition: 30,
      effect: 'random',
      fit: 'contain',
      idle: 8,
      shuffle: true,
      resume: true,
      event_duration: 60,
      event_interval_minutes: 60
    };
  },

  getSources: function () {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.sources)) || [];
    } catch (e) {
      return [];
    }
  },

  saveSources: function (list) {
    localStorage.setItem(this.KEYS.sources, JSON.stringify(list));
  },

  getSettings: function () {
    var defaults = this.defaults();
    try {
      return Object.assign({}, defaults, JSON.parse(localStorage.getItem(this.KEYS.settings) || '{}'));
    } catch (e) {
      return defaults;
    }
  },

  saveSettings: function (settings) {
    localStorage.setItem(this.KEYS.settings, JSON.stringify(settings));
  },

  getSettingsUpdatedAt: function () {
    return localStorage.getItem(this.KEYS.settingsUpdatedAt) || '';
  },

  saveSettingsUpdatedAt: function (iso) {
    if (iso) localStorage.setItem(this.KEYS.settingsUpdatedAt, iso);
  },

  getApiKey: function () {
    return localStorage.getItem(this.KEYS.apiKey) || '';
  },

  saveApiKey: function (key) {
    localStorage.setItem(this.KEYS.apiKey, key);
  },

  getProgress: function () {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.progress)) || null;
    } catch (e) {
      return null;
    }
  },

  saveProgress: function (progress) {
    localStorage.setItem(this.KEYS.progress, JSON.stringify(progress));
  },

  clearProgress: function () {
    localStorage.removeItem(this.KEYS.progress);
  },

  getRecent: function () {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.recent)) || [];
    } catch (e) {
      return [];
    }
  },

  addRecent: function (photoId) {
    var recent = this.getRecent();
    recent = recent.filter(function (id) { return id !== photoId; });
    recent.unshift(photoId);
    if (recent.length > 120) recent = recent.slice(0, 120);
    localStorage.setItem(this.KEYS.recent, JSON.stringify(recent));
  },

  clearRecent: function () {
    localStorage.removeItem(this.KEYS.recent);
  }
};
