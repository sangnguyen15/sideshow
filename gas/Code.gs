/**
 * Family Slideshow – Sheet config + Telegram notify
 *
 * Script Properties:
 *   TELEGRAM_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * ?action=notify&event=on
 * ?action=notify&event=still_on
 * (no action) → apiKey + sources
 */

// ===== SỬA DÒNG NÀY =====
var SHEET_ID = 'DÁN_SHEET_ID_VÀO_ĐÂY';
// ========================

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

function readSheetConfig() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var configSheet = ss.getSheetByName('Config');
  var sourcesSheet = ss.getSheetByName('Sources');

  if (!configSheet || !sourcesSheet) {
    return { error: 'Thiếu tab Config hoặc Sources' };
  }

  var configData = configSheet.getDataRange().getValues();
  var apiKey = '';
  for (var i = 0; i < configData.length; i++) {
    var key = String(configData[i][0] || '').trim().toLowerCase();
    var val = String(configData[i][1] || '').trim();
    if (key === 'api_key' || key === 'apikey') {
      apiKey = val;
    }
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

  return {
    apiKey: apiKey,
    sources: sources,
    updatedAt: new Date().toISOString()
  };
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
