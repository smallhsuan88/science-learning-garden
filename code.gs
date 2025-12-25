/***********************
 * Science Learning Garden API (GAS Web App)
 * Sheets:
 * - Questions: question_id, grade, unit, stem, options, answer_key, explanation, difficulty
 * - UserData: user_id, nickname, water, sunlight, fertilizer, streak, last_active
 * - Plants: plant_id, user_id, seed_type, growth_points, stage, planted_at
 * - Logs: timestamp, user_id, q_id, is_correct, chosen_answer
 * - Mastery: user_id, q_id, correct_count, total_count, last_correct_date
 * - Mistakes: user_id, q_id, strike, last_date
 ************************/

const SPREADSHEET_ID = "1vYlmGr_tSj3MKAbnRtnOSDgBv_j8cAbDkATtW4ammaM";

// 簡易門禁：避免被路人刷爆配額（可關掉）
const REQUIRE_KEY = false;
const API_KEY = "CHANGE_ME_TO_A_RANDOM_STRING";

// 分頁名稱（照你提供的）
const SHEETS = {
  Questions: "Questions",
  UserData: "UserData",
  Plants: "Plants",
  Logs: "Logs",
  Mastery: "Mastery",
  Mistakes: "Mistakes"
};

// 每個分頁「至少必須存在的欄位」：用來定位 header 列（防止上面有空白列）
const REQUIRED_COLS = {
  Questions: ["question_id", "grade", "unit", "stem", "options", "answer_key", "explanation", "difficulty"],
  UserData: ["user_id", "nickname", "streak", "last_active"],
  Plants: ["plant_id", "user_id", "seed_type", "growth_points", "stage", "planted_at"],
  Logs: ["timestamp", "user_id", "q_id", "is_correct", "chosen_answer"],
  Mastery: ["user_id", "q_id", "correct_count", "total_count", "last_correct_date"],
  Mistakes: ["user_id", "q_id", "strike", "last_date"]
};

/**
 * 確保指定 sheet 存在且包含必要欄位。會在缺少時自動補上 header。
 */
function ensureSheetReady_(sheetName) {
  const ss = ss_();
  let sh = ss.getSheetByName(sheetName);
  const required = REQUIRED_COLS[sheetName] || [];
  let created = false;

  if (!sh) {
    sh = ss.insertSheet(sheetName);
    created = true;
    if (required.length) sh.getRange(1, 1, 1, required.length).setValues([required]);
  }

  let info;
  try {
    info = readSheetAsObjects2_(sheetName);
  } catch (err) {
    if (required.length) {
      sh.getRange(1, 1, 1, required.length).setValues([required]);
      info = readSheetAsObjects2_(sheetName);
    } else {
      throw err;
    }
  }

  let meta = info.meta || {};
  let headers = meta.headers || [];
  let headerRow = meta.headerRow || 1;

  // 若找不到 header，但有 required，就直接建立 header
  if ((meta.reason === "header_not_found" || headers.length === 0) && required.length) {
    sh.getRange(1, 1, 1, required.length).setValues([required]);
    info = readSheetAsObjects2_(sheetName);
    meta = info.meta || {};
    headers = meta.headers || required.slice();
    headerRow = meta.headerRow || 1;
  }

  const missing = required.filter(h => headers.indexOf(h) === -1);
  if (missing.length) {
    const updatedHeaders = headers.concat(missing);
    const headerRange = sh.getRange(headerRow, 1, 1, updatedHeaders.length);
    const rowValues = headerRange.getValues()[0];
    missing.forEach((h, i) => {
      rowValues[headers.length + i] = h;
    });
    headerRange.setValues([rowValues]);
    info = readSheetAsObjects2_(sheetName);
    meta = info.meta || meta;
  }

  return { sheet: sh, meta: info.meta || meta, missing, created };
}

/**
 * 只檢查，不修改：用於 diagnose 回傳各表狀態。
 */
function inspectSheet_(sheetName) {
  const ss = ss_();
  const sh = ss.getSheetByName(sheetName);
  const required = REQUIRED_COLS[sheetName] || [];
  if (!sh) {
    return { exists: false, headers: [], missing: required.slice(), headerRow: null, lastRow: 0 };
  }

  try {
    const { meta } = readSheetAsObjects2_(sheetName);
    const headers = meta?.headers || [];
    const missing = required.filter(h => headers.indexOf(h) === -1);
    return {
      exists: true,
      headers,
      missing,
      headerRow: meta?.headerRow || null,
      lastRow: meta?.lastRow || sh.getLastRow()
    };
  } catch (err) {
    return { exists: true, headers: [], missing: required.slice(), error: String(err) };
  }
}

function doGet(e) {
  return handle_(e, "GET");
}

function doPost(e) {
  return handle_(e, "POST");
}

function handle_(e, method) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};

    if (REQUIRE_KEY) {
      const key = String(p.key || "");
      if (key !== API_KEY) return json_({ ok: false, error: "Unauthorized" });
    }

    const action = String(p.action || "ping");

    if (action === "ping") {
      return json_({ ok: true, message: "pong", ts: new Date().toISOString() });
    }

    if (action === "getQuestions") {
      // filters: grade, unit, difficulty
      const grade = p.grade ? String(p.grade).trim() : "";
      const unit = p.unit ? String(p.unit).trim() : "";
      const difficulty = p.difficulty ? String(p.difficulty).trim() : "";
      const limit = p.limit ? Math.max(1, Math.min(200, Number(p.limit))) : 200;

      // ✅ 改成「能自動定位 header 列」的讀法（避免上方空白列導致讀不到題目）
      const { rows, meta } = readSheetAsObjects2_(SHEETS.Questions);

      const filtered = rows.filter(r => {
        // 這邊也做 trim，避免 sheet 裡有 "Normal " 之類尾巴空白造成全掛
        const rg = String(r.grade ?? "").trim();
        const ru = String(r.unit ?? "").trim();
        const rd = String(r.difficulty ?? "").trim();

        if (grade && rg !== grade) return false;
        if (unit && ru !== unit) return false;
        if (difficulty && rd !== difficulty) return false;
        return true;
      });

      // 只有在 debug=1 才回 meta，不影響前端正常解析
      const debug = String(p.debug || "") === "1";

      return json_(Object.assign(
        {
          ok: true,
          count: filtered.length,
          data: filtered.slice(0, limit)
        },
        debug ? { meta } : {}
      ));
    }

    if (action === "getQuestionById") {
      const qid = String(p.qid || "").trim();
      if (!qid) return json_({ ok: false, error: "Missing qid" });

      const q = getQuestionById_(qid);
      if (!q) return json_({ ok: false, error: "Question not found" });

      return json_({ ok: true, data: q });
    }

    if (action === "submitAnswer") {
      // Accept both GET params and POST JSON body.
      // Required: user_id, q_id, chosen_answer, is_correct (optional: server can compute if provided answer_key)
      const body = parseJsonBody_(e);
      const user_id = String((body.user_id ?? p.user_id ?? "")).trim();
      const q_id = String((body.q_id ?? p.q_id ?? "")).trim();
      const chosen_answer = String((body.chosen_answer ?? p.chosen_answer ?? "")).trim();

      if (!user_id || !q_id) return json_({ ok: false, error: "Missing user_id or q_id" });

      // 確保三張表存在且 header 完整
      const logsReady = ensureSheetReady_(SHEETS.Logs);
      const masteryReady = ensureSheetReady_(SHEETS.Mastery);
      const mistakesReady = ensureSheetReady_(SHEETS.Mistakes);

      // Determine correct or not:
      let is_correct;
      if (body.is_correct !== undefined || p.is_correct !== undefined) {
        // Trust caller (OK for your private use; if public use, compute on server)
        is_correct = String(body.is_correct ?? p.is_correct) === "true";
      } else {
        // Compute from Questions.answer_key
        const q = getQuestionById_(q_id);
        if (!q) return json_({ ok: false, error: "Question not found" });

        const answerKey = String(q.answer_key).trim();
        is_correct = String(chosen_answer).trim() === answerKey;
      }

      const logTimestamp = new Date().toISOString();

      if (logsReady.missing.length) {
        return json_({ ok: false, error: `Logs 缺少欄位：${logsReady.missing.join(",")}`, missing: logsReady.missing, sheet: SHEETS.Logs, spreadsheet_id: SPREADSHEET_ID });
      }
      if (masteryReady.missing.length) {
        return json_({ ok: false, error: `Mastery 缺少欄位：${masteryReady.missing.join(",")}`, missing: masteryReady.missing, sheet: SHEETS.Mastery, spreadsheet_id: SPREADSHEET_ID });
      }
      if (mistakesReady.missing.length) {
        return json_({ ok: false, error: `Mistakes 缺少欄位：${mistakesReady.missing.join(",")}`, missing: mistakesReady.missing, sheet: SHEETS.Mistakes, spreadsheet_id: SPREADSHEET_ID });
      }

      // 1) append Logs
      const logRange = appendRow_(SHEETS.Logs, {
        timestamp: logTimestamp,
        user_id,
        q_id,
        is_correct,
        chosen_answer
      });
      const logRow = logRange && typeof logRange.getRow === "function"
        ? logRange.getRow()
        : ss_().getSheetByName(SHEETS.Logs).getLastRow();

      // 2) update Mastery (correct_count, total_count, last_correct_date)
      const masteryUpdated = updateMastery_(user_id, q_id, is_correct);

      // 3) update Mistakes (strike, last_date) only when wrong
      const mistakesUpdated = updateMistakes_(user_id, q_id, is_correct);

      // 4) update UserData last_active & streak (simple)
      touchUser_(user_id);

      const logsInfo = readSheetAsObjects2_(SHEETS.Logs);
      const logsTotal = logsInfo.rows.length;

      return json_({
        ok: true,
        is_correct,
        log_row: logRow,
        log_timestamp: logTimestamp,
        logs_total: logsTotal,
        sheet_last_row: logsInfo.meta?.lastRow || logRow,
        spreadsheet_id: SPREADSHEET_ID,
        written_to_spreadsheet_id: SPREADSHEET_ID,
        mastery_updated: Boolean(masteryUpdated),
        mistakes_updated: Boolean(mistakesUpdated),
        log_written: true,
        server_ts: logTimestamp,
        explanation: (getQuestionById_(q_id) || {}).explanation || "",
        updated_sheets: {
          logs: { missing: logsReady.missing, created: logsReady.created },
          mastery: { missing: masteryReady.missing, created: masteryReady.created },
          mistakes: { missing: mistakesReady.missing, created: mistakesReady.created }
        }
      });
    }

    if (action === "diagnose") {
      const targets = [SHEETS.Logs, SHEETS.Mastery, SHEETS.Mistakes];
      const status = {};
      targets.forEach(name => {
        status[name] = inspectSheet_(name);
      });

      return json_({
        ok: true,
        spreadsheet_id: SPREADSHEET_ID,
        sheets: status,
        missing: Object.entries(status).reduce((acc, [k, v]) => {
          if (v.missing && v.missing.length) acc[k] = v.missing;
          return acc;
        }, {})
      });
    }

    if (action === "getUserSummary") {
      const user_id = String(p.user_id || "").trim();
      if (!user_id) return json_({ ok: false, error: "Missing user_id" });

      const user = getOrCreateUser_(user_id, p.nickname ? String(p.nickname) : "");
      ensureSheetReady_(SHEETS.Mastery);
      ensureSheetReady_(SHEETS.Mistakes);
      const mastery = readSheetAsObjects2_(SHEETS.Mastery).rows.filter(r => String(r.user_id) === user_id);
      const mistakes = readSheetAsObjects2_(SHEETS.Mistakes).rows.filter(r => String(r.user_id) === user_id);

      return json_({ ok: true, user, mastery_count: mastery.length, mistakes_count: mistakes.length });
    }

    if (action === "getUserProgress") {
      const user_id = String(p.user_id || "").trim();
      if (!user_id) return json_({ ok: false, error: "Missing user_id" });

      ensureSheetReady_(SHEETS.Logs);
      ensureSheetReady_(SHEETS.Mastery);
      ensureSheetReady_(SHEETS.Mistakes);

      const logsData = readSheetAsObjects2_(SHEETS.Logs);
      const masteryData = readSheetAsObjects2_(SHEETS.Mastery);
      const mistakesData = readSheetAsObjects2_(SHEETS.Mistakes);

      const logs = logsData.rows.filter(r => String(r.user_id) === user_id);
      const mastery = masteryData.rows.filter(r => String(r.user_id) === user_id);
      const mistakes = mistakesData.rows.filter(r => String(r.user_id) === user_id);

      const recentLogs = logs
        .slice()
        .sort((a, b) => {
          const tb = new Date(b.timestamp || "").getTime() || 0;
          const ta = new Date(a.timestamp || "").getTime() || 0;
          return tb - ta;
        })
        .slice(0, 5);

      return json_({
        ok: true,
        user_id,
        logs_count: logs.length,
        mastery_count: mastery.length,
        mistakes_count: mistakes.length,
        recent_logs: recentLogs,
        sheet_last_row: logsData.meta?.lastRow || "",
        spreadsheet_id: SPREADSHEET_ID
      });
    }

    return json_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
}

/* ===== Helpers: Sheet I/O ===== */

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function normalizeHeader_(h) {
  return String(h ?? "")
    .trim()
    .replace(/\s+/g, " "); // 把連續空白縮成單一空白（避免 header 有奇怪空白）
}

/**
 * ✅ 新版：可自動定位真正的 header 列（防止上方空白列、說明列）
 * 回傳 { rows, meta }
 */
function readSheetAsObjects2_(sheetName) {
  const sh = ss_().getSheetByName(sheetName);
  if (!sh) throw new Error(`Sheet not found: ${sheetName}`);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { rows: [], meta: { sheetName, reason: "empty_sheet" } };

  // 先抓整段，找出哪一列才是 header
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const required = REQUIRED_COLS[sheetName] || [];
  let headerRowIndex0 = -1; // 0-based

  for (let r = 0; r < Math.min(all.length, 50); r++) { // 只掃前 50 列即可
    const headers = all[r].map(normalizeHeader_).filter(Boolean);
    if (headers.length === 0) continue;

    const hasAll = required.length
      ? required.every(k => headers.indexOf(k) !== -1)
      : headers.length >= 2;

    if (hasAll) {
      headerRowIndex0 = r;
      break;
    }
  }

  if (headerRowIndex0 === -1) {
    return {
      rows: [],
      meta: {
        sheetName,
        reason: "header_not_found",
        required,
        sampleTopRows: all.slice(0, 5).map(r => r.map(normalizeHeader_))
      }
    };
  }

  const headers = all[headerRowIndex0].map(normalizeHeader_);
  const rows = [];

  for (let r = headerRowIndex0 + 1; r < all.length; r++) {
    const row = all[r];
    const isEmpty = row.every(v => String(v ?? "").trim() === "");
    if (isEmpty) continue;

    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = row[idx];
    });
    rows.push(obj);
  }

  return {
    rows,
    meta: {
      sheetName,
      headerRow: headerRowIndex0 + 1,
      lastRow,
      lastCol,
      headers
    }
  };
}

// 兼容舊函式名稱：你其他流程還在用 readSheetAsObjects_ / appendRow_
function readSheetAsObjects_(sheetName) {
  return readSheetAsObjects2_(sheetName).rows;
}

function appendRow_(sheetName, obj) {
  const { sheet: sh, meta } = ensureSheetReady_(sheetName);
  if (!sh) throw new Error(`Sheet not found: ${sheetName}`);
  if (!meta || !meta.headers || !meta.headerRow) {
    throw new Error(`Cannot appendRow: header not found in ${sheetName}`);
  }

  const headers = meta.headers;
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  const range = sh.appendRow(row);
  return range;
}

function findRowIndexByKeys_(sheetName, keyMap) {
  const sh = ss_().getSheetByName(sheetName);
  const { rows, meta } = readSheetAsObjects2_(sheetName);
  if (!meta || !meta.headers || !meta.headerRow) return -1;

  const headers = meta.headers;
  const keyEntries = Object.entries(keyMap);

  // 用 rows（已經跳過 header 前空白列）來比對，最後再換算回實際 row number
  // 實際資料起始列 = meta.headerRow + 1
  const dataStartRow = meta.headerRow + 1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let ok = true;
    for (const [k, v] of keyEntries) {
      if (headers.indexOf(k) === -1) throw new Error(`Column not found: ${k} in ${sheetName}`);
      if (String(r[k]) !== String(v)) { ok = false; break; }
    }
    if (ok) return dataStartRow + i; // 真實 sheet row number (1-based)
  }
  return -1;
}

function updateRowByKeys_(sheetName, keyMap, patch) {
  const sh = ss_().getSheetByName(sheetName);
  const { meta } = readSheetAsObjects2_(sheetName);
  if (!meta || !meta.headers || !meta.headerRow) return false;

  const headers = meta.headers;
  const rowIdx = findRowIndexByKeys_(sheetName, keyMap);
  if (rowIdx === -1) return false;

  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => {
    if (patch[h] !== undefined) row[i] = patch[h];
  });
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
  return true;
}

/* ===== Domain Logic ===== */

function getQuestionById_(q_id) {
  const rows = readSheetAsObjects2_(SHEETS.Questions).rows;
  return rows.find(x => String(x.question_id) === String(q_id)) || null;
}

function updateMastery_(user_id, q_id, is_correct) {
  const sheet = SHEETS.Mastery;

  const sh = ss_().getSheetByName(sheet);
  const { meta } = readSheetAsObjects2_(sheet);
  const headers = meta.headers;

  const rowIdx = findRowIndexByKeys_(sheet, { user_id, q_id });

  if (rowIdx === -1) {
    appendRow_(sheet, {
      user_id,
      q_id,
      correct_count: is_correct ? 1 : 0,
      total_count: 1,
      last_correct_date: is_correct ? new Date().toISOString().slice(0, 10) : ""
    });
    return true;
  }

  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  const ccIdx = headers.indexOf("correct_count");
  const tcIdx = headers.indexOf("total_count");
  const lcdIdx = headers.indexOf("last_correct_date");

  const correct_count = Number(row[ccIdx] || 0) + (is_correct ? 1 : 0);
  const total_count = Number(row[tcIdx] || 0) + 1;

  row[ccIdx] = correct_count;
  row[tcIdx] = total_count;
  if (is_correct) row[lcdIdx] = new Date().toISOString().slice(0, 10);

  sh.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
  return true;
}

function updateMistakes_(user_id, q_id, is_correct) {
  const sheet = SHEETS.Mistakes;
  const today = new Date().toISOString().slice(0, 10);

  if (is_correct) return false;

  const sh = ss_().getSheetByName(sheet);
  const { meta } = readSheetAsObjects2_(sheet);
  const headers = meta.headers;

  const rowIdx = findRowIndexByKeys_(sheet, { user_id, q_id });

  if (rowIdx === -1) {
    appendRow_(sheet, { user_id, q_id, strike: 1, last_date: today });
    return true;
  }

  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  const strikeIdx = headers.indexOf("strike");
  const lastIdx = headers.indexOf("last_date");

  row[strikeIdx] = Number(row[strikeIdx] || 0) + 1;
  row[lastIdx] = today;
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
  return true;
}

function getOrCreateUser_(user_id, nickname) {
  const sheet = SHEETS.UserData;
  const exists = updateRowByKeys_(sheet, { user_id }, {}); // just check

  if (!exists) {
    appendRow_(sheet, {
      user_id,
      nickname: nickname || "",
      water: 0,
      sunlight: 0,
      fertilizer: 0,
      streak: 0,
      last_active: new Date().toISOString().slice(0, 10)
    });
  } else if (nickname) {
    updateRowByKeys_(sheet, { user_id }, { nickname });
  }

  const rows = readSheetAsObjects2_(sheet).rows.filter(r => String(r.user_id) === user_id);
  return rows[0] || { user_id, nickname: nickname || "" };
}

function touchUser_(user_id) {
  const sheet = SHEETS.UserData;

  const sh = ss_().getSheetByName(sheet);
  const { meta } = readSheetAsObjects2_(sheet);
  const headers = meta.headers;

  const rowIdx = findRowIndexByKeys_(sheet, { user_id });
  const today = new Date().toISOString().slice(0, 10);

  if (rowIdx === -1) {
    appendRow_(sheet, { user_id, nickname:"", water:0, sunlight:0, fertilizer:0, streak:1, last_active: today });
    return;
  }

  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  const lastIdx = headers.indexOf("last_active");
  const streakIdx = headers.indexOf("streak");

  const last = String(row[lastIdx] || "");
  if (last !== today) row[streakIdx] = Number(row[streakIdx] || 0) + 1;
  row[lastIdx] = today;

  sh.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
}

function parseJsonBody_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return {};
    return JSON.parse(e.postData.contents);
  } catch (_) {
    return {};
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
