/**
 * Family Slideshow – Config + Events + Settings + Telegram
 *
 * Script Properties:
 *   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, SETTINGS_PIN
 *
 * doGet:
 *   (no action) → apiKey, sources, settings, events, updatedAt
 *   ?action=notify&event=on|still_on
 *
 * doPost (Content-Type: text/plain JSON body):
 *   { action: "saveSettings", pin: "...", settings: { ... } }
 *
 * Sheet tabs: Config, Sources, Settings, Events
 */

// ===== SỬA DÒNG NÀY =====
var SHEET_ID = '1PiHBIHX2SQfcwPuIDfEM_enrx3CbXRJ4Mz9uJY--hmY';
// ========================

var DEFAULT_SETTINGS = {
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

function doGet(e) {
  try {
    e = e || {};
    var params = e.parameter || {};

    if (params.action === 'notify') {
      var event = String(params.event || '').trim();
      var msg = '';
      var now = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm:ss');

      if (event === 'on') {
        msg = '✅ Box đã BẬT – Slideshow đang chạy\n' + now;
      } else if (event === 'still_on') {
        msg = '⚠️ 22:01 – Box VẪN ĐANG BẬT\nHãy kiểm tra IR / tắt máy nếu cần.\n' + now;
      } else {
        msg = '🔔 Box notify: ' + (event || 'unknown') + '\n' + now;
      }
      return jsonResponse(sendTelegram(msg));
    }

    return jsonResponse(readSheetConfig());
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      body = e.parameter;
      if (typeof body.settings === 'string') {
        try { body.settings = JSON.parse(body.settings); } catch (x) {}
      }
    }

    if (body.action === 'saveSettings') {
      return jsonResponse(saveSettingsToSheet(body.pin, body.settings || {}));
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) });
  }
}

function readSheetConfig() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var configSheet = ss.getSheetByName('Config');
  var sourcesSheet = ss.getSheetByName('Sources');

  if (!configSheet || !sourcesSheet) {
    return { error: 'Thiếu tab Config hoặc Sources' };
  }

  var apiKey = '';
  var configData = configSheet.getDataRange().getValues();
  for (var i = 0; i < configData.length; i++) {
    var key = String(configData[i][0] || '').trim().toLowerCase();
    var val = String(configData[i][1] || '').trim();
    if (key === 'api_key' || key === 'apikey') apiKey = val;
  }

  var sourcesData = sourcesSheet.getDataRange().getValues();
  var sources = [];
  for (var r = 1; r < sourcesData.length; r++) {
    var name = String(sourcesData[r][0] || '').trim();
    var link = String(sourcesData[r][1] || '').trim();
    var enabled = sourcesData[r][2];
    var order = sourcesData[r][3];
    var isEnabled = enabled === true ||
      String(enabled).toLowerCase() === 'true' ||
      enabled === 1 ||
      String(enabled).toLowerCase() === 'x';
    if (!link || !isEnabled) continue;
    sources.push({
      name: name || ('Folder ' + (sources.length + 1)),
      link: link,
      order: Number(order) || (sources.length + 1)
    });
  }
  sources.sort(function (a, b) { return a.order - b.order; });

  var settings = readSettingsSheet(ss);
  var events = readEventsSheet(ss);

  return {
    apiKey: apiKey,
    sources: sources,
    settings: settings,
    events: events,
    updatedAt: new Date().toISOString()
  };
}

function readSettingsSheet(ss) {
  var sheet = ss.getSheetByName('Settings');
  var out = {};
  for (var k in DEFAULT_SETTINGS) {
    if (DEFAULT_SETTINGS.hasOwnProperty(k)) out[k] = DEFAULT_SETTINGS[k];
  }
  if (!sheet) return out;

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    if (!key || key.toLowerCase() === 'key') continue;
    var raw = data[i][1];
    var val = String(raw === null || raw === undefined ? '' : raw).trim();
    if (val === '') continue;

    if (key === 'shuffle' || key === 'resume') {
      out[key] = (val === true || val === 1 || String(val).toLowerCase() === 'true' || val === '1');
    } else if (key === 'effect' || key === 'fit') {
      out[key] = val;
    } else {
      var num = parseFloat(val);
      if (!isNaN(num)) out[key] = num;
      else out[key] = val;
    }
  }
  return out;
}

function readEventsSheet(ss) {
  var sheet = ss.getSheetByName('Events');
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var events = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var template = String(row[0] || '').trim().toLowerCase();
    var year = parseInt(row[1], 10);
    var month = parseInt(row[2], 10);
    var day = parseInt(row[3], 10);
    var titleName = String(row[4] || '').trim();
    var pairLeft = String(row[5] || '').trim();
    var pairRight = String(row[6] || '').trim();
    var imageLink = String(row[7] || '').trim();
    var enabled = row[8];
    var order = row[9];

    var isEnabled = enabled === true ||
      String(enabled).toLowerCase() === 'true' ||
      enabled === 1 ||
      String(enabled).toLowerCase() === 'x';

    if (!isEnabled) continue;
    if (template !== 'birthday' && template !== 'wedding') continue;
    if (!year || !month || !day) continue;

    events.push({
      template: template,
      year: year,
      month: month,
      day: day,
      titleName: titleName,
      pairLeft: pairLeft,
      pairRight: pairRight,
      imageLink: imageLink,
      order: Number(order) || (events.length + 1)
    });
  }

  events.sort(function (a, b) { return a.order - b.order; });
  return events;
}

function saveSettingsToSheet(pin, settings) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('SETTINGS_PIN') || '';
  if (expected) {
    if (String(pin || '') !== String(expected)) {
      return { ok: false, error: 'Sai mã PIN' };
    }
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    sheet = ss.insertSheet('Settings');
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
  }

  var allowed = {
    duration: true,
    transition: true,
    effect: true,
    fit: true,
    idle: true,
    shuffle: true,
    resume: true,
    event_duration: true,
    event_interval_minutes: true
  };

  var map = {};
  var data = sheet.getDataRange().getValues();
  var startRow = 1;
  if (data.length && String(data[0][0]).toLowerCase() === 'key') startRow = 1;
  for (var i = 0; i < data.length; i++) {
    var k = String(data[i][0] || '').trim();
    if (k) map[k] = i + 1;
  }

  if (!map['key'] && data.length === 0) {
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
  }

  for (var key in settings) {
    if (!settings.hasOwnProperty(key) || !allowed[key]) continue;
    var val = settings[key];
    if (typeof val === 'boolean') val = val ? 'true' : 'false';
    if (map[key]) {
      sheet.getRange(map[key], 2).setValue(val);
    } else {
      sheet.appendRow([key, val]);
    }
  }

  // Cập nhật mốc thời gian
  if (map['settings_updated_at']) {
    sheet.getRange(map['settings_updated_at'], 2).setValue(new Date().toISOString());
  } else {
    sheet.appendRow(['settings_updated_at', new Date().toISOString()]);
  }

  return { ok: true, updatedAt: new Date().toISOString() };
}

function sendTelegram(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN');
  var chatId = props.getProperty('TELEGRAM_CHAT_ID');

  if (!token || !chatId) {
    return { ok: false, error: 'Chua cau hinh TELEGRAM_TOKEN / TELEGRAM_CHAT_ID trong Script Properties' };
  }

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var payload = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    return { ok: false, error: 'Telegram HTTP ' + code, body: body };
  }
  return { ok: true, code: code };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testTelegramAuth() {
  sendTelegram('Test quyen UrlFetch tu Apps Script');
}
