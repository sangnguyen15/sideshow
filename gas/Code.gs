/**
 * Family Slideshow – Config + Events + Settings + Telegram + Remote Command
 *
 * Script Properties:
 *   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, SETTINGS_PIN
 *
 * doGet:
 *   (no action) → apiKey, sources, settings, events, updatedAt, remoteCommand
 *   ?action=notify&event=on|still_on
 *
 * doPost (Content-Type: text/plain JSON body):
 *   { action: "saveSettings", pin, settings }
 *   { action: "setRemoteCommand", pin, command }   // command: reload_code | reload_data
 *   { action: "ackRemoteCommand", command, status, message }
 *
 * Sheet tabs: Config, Sources, Settings, Events
 * Config tab (key/value), tự động thêm nếu chưa có:
 *   remote_command            – lệnh đang chờ box xử lý
 *   remote_command_at         – thời điểm lệnh được đặt
 *   last_command_applied_at   – thời điểm box xử lý xong lệnh gần nhất
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

var ALLOWED_REMOTE_COMMANDS = {
  reload_code: true,
  reload_data: true
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

    if (body.action === 'setRemoteCommand') {
      return jsonResponse(setRemoteCommand(body.pin, body.command));
    }

    if (body.action === 'ackRemoteCommand') {
      return jsonResponse(ackRemoteCommand(body.command, body.status, body.message));
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) });
  }
}

/* ═══════════════════════ ĐỌC CẤU HÌNH TỔNG ═══════════════════════ */

function readSheetConfig() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var configSheet = ss.getSheetByName('Config');
  var sourcesSheet = ss.getSheetByName('Sources');

  if (!configSheet || !sourcesSheet) {
    return { error: 'Thiếu tab Config hoặc Sources' };
  }

  var configMap = readConfigMap(configSheet);
  var apiKey = configValue(configMap, 'api_key') || configValue(configMap, 'apikey');
  var remoteCommand = configValue(configMap, 'remote_command');
  var remoteCommandAt = configValue(configMap, 'remote_command_at');
  var lastCommandAppliedAt = configValue(configMap, 'last_command_applied_at');

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

  var settingsResult = readSettingsSheet(ss);
  var events = readEventsSheet(ss);

  /*
   * "updatedAt" phải phản ánh thời điểm Settings THỰC SỰ được lưu
   * lần cuối (qua saveSettingsToSheet), KHÔNG phải giờ gọi API
   * hiện tại — nếu không, việc poll định kỳ mỗi 2 phút sẽ luôn
   * thấy "thay đổi" giả, gây reset không mong muốn ở client.
   */
  var stableUpdatedAt = settingsResult.settingsUpdatedAt || '1970-01-01T00:00:00.000Z';

  return {
    apiKey: apiKey,
    sources: sources,
    settings: settingsResult.settings,
    events: events,
    updatedAt: stableUpdatedAt,
    remoteCommand: {
      command: remoteCommand,
      at: remoteCommandAt,
      lastAppliedAt: lastCommandAppliedAt
    }
  };
}

function readSettingsSheet(ss) {
  var sheet = ss.getSheetByName('Settings');
  var out = {};
  for (var k in DEFAULT_SETTINGS) {
    if (DEFAULT_SETTINGS.hasOwnProperty(k)) out[k] = DEFAULT_SETTINGS[k];
  }

  var settingsUpdatedAt = '';

  if (!sheet) {
    return { settings: out, settingsUpdatedAt: settingsUpdatedAt };
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    if (!key || key.toLowerCase() === 'key') continue;
    var raw = data[i][1];
    var val = String(raw === null || raw === undefined ? '' : raw).trim();
    if (val === '') continue;

    if (key === 'settings_updated_at') {
      settingsUpdatedAt = val;
      continue;
    }

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

  return { settings: out, settingsUpdatedAt: settingsUpdatedAt };
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

/* ═══════════════════════ LƯU SETTINGS ═══════════════════════ */

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

  var nowIso = new Date().toISOString();
  if (map['settings_updated_at']) {
    sheet.getRange(map['settings_updated_at'], 2).setValue(nowIso);
  } else {
    sheet.appendRow(['settings_updated_at', nowIso]);
  }

  return { ok: true, updatedAt: nowIso };
}

/* ═══════════════════════ REMOTE COMMAND (Giai đoạn 1) ═══════════════════════ */

/**
 * Đặt lệnh từ xa – được gọi bởi remote.html khi người dùng bấm nút.
 * Yêu cầu đúng PIN (nếu đã cấu hình SETTINGS_PIN).
 */
function setRemoteCommand(pin, command) {
  command = String(command || '').trim();
  if (!ALLOWED_REMOTE_COMMANDS[command]) {
    return { ok: false, error: 'Lệnh không hợp lệ: ' + command };
  }

  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('SETTINGS_PIN') || '';
  if (expected) {
    if (String(pin || '') !== String(expected)) {
      return { ok: false, error: 'Sai mã PIN' };
    }
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getConfigSheet(ss);
  var nowIso = new Date().toISOString();

  upsertConfigValue(sheet, 'remote_command', command);
  upsertConfigValue(sheet, 'remote_command_at', nowIso);

  return { ok: true, command: command, at: nowIso };
}

/**
 * Box tự gọi khi đã xử lý xong lệnh (thành công hoặc thất bại).
 * KHÔNG yêu cầu PIN – đây là bước dọn dẹp nội bộ của box, không
 * phải hành động khởi tạo lệnh mới, không cần bảo vệ thêm.
 * Luôn dọn cờ lệnh (để không lặp lại) và gửi Telegram báo kết quả.
 */
function ackRemoteCommand(command, status, message) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getConfigSheet(ss);
  var nowIso = new Date().toISOString();

  upsertConfigValue(sheet, 'remote_command', '');
  upsertConfigValue(sheet, 'remote_command_at', '');
  upsertConfigValue(sheet, 'last_command_applied_at', nowIso);

  var label = command === 'reload_code' ? 'Code mới'
    : (command === 'reload_data' ? 'Ảnh / sự kiện'
    : String(command || 'Không rõ'));
  var isOk = (status !== 'error');
  var icon = isOk ? '✅' : '⚠️';
  var msg = icon + ' Cập nhật ' + label + (isOk ? ' thành công' : ' THẤT BẠI') +
    '\n' + nowIso;
  if (!isOk && message) {
    msg += '\nChi tiết: ' + String(message);
  }
  sendTelegram(msg);

  return { ok: true, updatedAt: nowIso };
}

/* ═══════════════════════ HELPER: Config sheet (key/value) ═══════════════════════ */

function getConfigSheet(ss) {
  var sheet = ss.getSheetByName('Config');
  if (!sheet) throw new Error('Thiếu tab Config');
  return sheet;
}

/** Đọc toàn bộ tab Config thành map: { keyLowercase: { row, value } } */
function readConfigMap(sheet) {
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 0; i < data.length; i++) {
    var rawKey = String(data[i][0] || '').trim();
    if (!rawKey) continue;
    var raw = data[i][1];
    var value = String(raw === null || raw === undefined ? '' : raw).trim();
    map[rawKey.toLowerCase()] = { row: i + 1, value: value };
  }
  return map;
}

function configValue(map, key) {
  var entry = map[String(key || '').toLowerCase()];
  return entry ? entry.value : '';
}

/** Thêm mới hoặc cập nhật 1 dòng key/value trong tab Config */
function upsertConfigValue(sheet, key, value) {
  var map = readConfigMap(sheet);
  var lower = String(key).toLowerCase();
  if (map[lower]) {
    sheet.getRange(map[lower].row, 2).setValue(value);
  } else {
    sheet.appendRow([key, value]);
  }
}

/* ═══════════════════════ TELEGRAM ═══════════════════════ */

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
