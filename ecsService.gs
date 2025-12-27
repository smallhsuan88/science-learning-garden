/**********************
 * ecsService.gs
 * Error Correction System (ECS)
 *
 * Sheets:
 *  - ECS
 *  - ECS_EVENTS
 *
 * Required ECS headers:
 * user_id, q_id, wrong_count_total, wrong_count_recent_7d, last_wrong_at,
 * last_wrong_choice, last_wrong_option_text, status,
 * graduation_correct_days_streak, graduation_last_correct_date,
 * variant_correct_count, updated_at, knowledge_tag, remedial_card_text,
 * remedial_asset_url, importance_weight, priority_score
 *
 * ECS_EVENTS headers:
 * user_id, q_id, event_type, payload_json, timestamp
 **********************/

const ECS_SHEET_NAME = 'ECS';
const ECS_EVENTS_SHEET_NAME = 'ECS_EVENTS';
const ECS_RECENT_WINDOW_DAYS = 7;
const ECS_EVENTS_SCAN_DAYS = 30;
const ECS_EVENTS_SCAN_CAP = 5000;

function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, idx) => {
    const key = String(h || '').trim();
    if (key) map[key] = idx + 1; // 1-based
  });
  return map;
}

function ensureHeaders_(sheet, requiredHeaders) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return getHeaderMap_(sheet);
  }
  const currentMap = getHeaderMap_(sheet);
  const missing = requiredHeaders.filter(h => !currentMap[h]);
  if (missing.length > 0) {
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
  }
  return getHeaderMap_(sheet);
}

/**
 * 找 ECS 既有列（依 user_id + q_id）
 * 回傳 { row: number, values: object } 或 { row: -1, values: null }
 */
function findEcsRow_(sheet, headerMap, userId, qId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { row: -1, values: null };

  // 只抓 user_id / q_id 兩欄來比對，省效能
  const uCol = headerMap['user_id'];
  const qCol = headerMap['q_id'];
  if (!uCol || !qCol) throw new Error('ECS 缺少必要欄位：user_id 或 q_id');

  const dataRange = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const values = dataRange.getValues();

  for (let i = 0; i < values.length; i++) {
    const rowVals = values[i];
    if (String(rowVals[uCol - 1]) === String(userId) && String(rowVals[qCol - 1]) === String(qId)) {
      const rowNumber = i + 2;
      return { row: rowNumber, values: rowVals };
    }
  }
  return { row: -1, values: null };
}

function getCell_(rowVals, headerMap, key) {
  const col = headerMap[key];
  if (!col) return '';
  return rowVals[col - 1];
}

function setRowByMap_(sheet, row, headerMap, obj) {
  // 把 obj 的 key 寫回對應欄位（只寫有提供的 key）
  const lastCol = sheet.getLastColumn();
  const rowRange = sheet.getRange(row, 1, 1, lastCol);
  const rowVals = rowRange.getValues()[0];

  Object.keys(obj).forEach(k => {
    const col = headerMap[k];
    if (!col) return;
    rowVals[col - 1] = obj[k];
  });

  rowRange.setValues([rowVals]);
}

function appendRowByHeaders_(sheet, headerMap, obj) {
  const lastCol = sheet.getLastColumn();
  const row = new Array(lastCol).fill('');
  Object.keys(obj).forEach(k => {
    const col = headerMap[k];
    if (!col) return;
    row[col - 1] = obj[k];
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function safeNumber_(v, fallback) {
  const n = Number(v);
  return isNaN(n) ? (fallback ?? 0) : n;
}

/**
 * priority_score：先按 recent_7d 再按 total
 * 你目前先不用 importance_weight 也可以；但我保留作為微調入口。
 */
function computePriorityScore_(wrongRecent7d, wrongTotal, importanceWeight) {
  return ecsComputePriorityScore_({
    wrong_count_recent_7d: wrongRecent7d,
    wrong_count_total: wrongTotal,
    importance_weight: importanceWeight
  });
}

function ecsComputePriorityScore_(rowOrObj) {
  const r = safeNumber_(rowOrObj && rowOrObj.wrong_count_recent_7d, 0);
  const t = safeNumber_(rowOrObj && rowOrObj.wrong_count_total, 0);
  const w = safeNumber_(rowOrObj && rowOrObj.importance_weight, 1);
  // recent 權重最高，再依總錯誤數微調
  return (r * 1000 + t * 10) * w;
}

function ecsEnsureEcsSheet_() {
  const requiredHeaders = [
    'user_id','q_id','wrong_count_total','wrong_count_recent_7d','last_wrong_at',
    'last_wrong_choice','last_wrong_option_text','status',
    'graduation_correct_days_streak','graduation_last_correct_date',
    'variant_correct_count','updated_at','knowledge_tag','remedial_card_text',
    'remedial_asset_url','importance_weight','priority_score'
  ];
  const sheet = getSheet_(ECS_SHEET_NAME, true);
  const headerMap = ensureHeaders_(sheet, requiredHeaders);
  return { sheet, headerMap };
}

function ecsEnsureEventsSheet_() {
  const sheet = getSheet_(ECS_EVENTS_SHEET_NAME, true);
  const headerMap = ensureHeaders_(sheet, ['user_id', 'q_id', 'event_type', 'payload_json', 'timestamp']);
  return { sheet, headerMap };
}

function ecsAppendEvent_(eventObj) {
  const { sheet, headerMap } = ecsEnsureEventsSheet_();
  appendRowByHeaders_(sheet, headerMap, {
    user_id: eventObj.user_id,
    q_id: eventObj.q_id,
    event_type: eventObj.event_type,
    payload_json: JSON.stringify(eventObj.payload_json || {}),
    timestamp: eventObj.timestamp || nowTaipeiStr_()
  });
}

function ecsGetRecentEvents_(userId, daysLimit, maxRows) {
  const { sheet } = ecsEnsureEventsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const limitDays = safeNumber_(daysLimit, ECS_EVENTS_SCAN_DAYS);
  const cap = safeNumber_(maxRows, ECS_EVENTS_SCAN_CAP);
  const startRow = Math.max(2, lastRow - cap + 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - limitDays);

  return values
    .map(row => ({
      user_id: String(row[0]),
      q_id: String(row[1]),
      event_type: String(row[2]),
      payload_json: row[3],
      timestamp: row[4]
    }))
    .filter(ev => String(ev.user_id) === String(userId))
    .filter(ev => {
      const ts = parseTaipeiTimestamp_(ev.timestamp) || new Date(ev.timestamp);
      return ts && ts >= cutoff;
    });
}

function ecsCalcRecent7dMap_(userId, nowDateObj) {
  const now = nowDateObj || new Date();
  const cutoff = new Date(now.getTime());
  cutoff.setDate(cutoff.getDate() - ECS_RECENT_WINDOW_DAYS);

  const events = ecsGetRecentEvents_(userId, ECS_EVENTS_SCAN_DAYS, ECS_EVENTS_SCAN_CAP);
  const map = new Map();
  events.forEach(ev => {
    if (ev.event_type !== 'capture_wrong') return;
    const ts = parseTaipeiTimestamp_(ev.timestamp) || new Date(ev.timestamp);
    if (!ts || ts < cutoff) return;
    const qid = String(ev.q_id);
    const prev = map.get(qid) || 0;
    map.set(qid, prev + 1);
  });
  return map;
}

function ecsCalcRecent7dCount_(userId, qId, nowDateObj) {
  const map = ecsCalcRecent7dMap_(userId, nowDateObj);
  return map.get(String(qId)) || 0;
}

function logEcsEvent_(userId, qId, eventType, payloadObj, timestampTaipei) {
  ecsAppendEvent_({
    user_id: userId,
    q_id: qId,
    event_type: eventType,
    payload_json: payloadObj || {},
    timestamp: timestampTaipei || nowTaipeiStr_()
  });
}

/**
 * 答錯：建立 / 更新 ECS
 * @param {string} userId
 * @param {string} qId
 * @param {number} chosenIndex
 * @param {string} chosenText
 * @param {string} explanation (可用於 remedial_card_text)
 * @param {string} nowTaipeiStr
 * @param {object} extra 可帶 knowledge_tag, remedial_asset_url, importance_weight
 */
function ecsUpsertOnWrong(userId, qId, chosenIndex, chosenText, explanation, nowTaipeiStr, extra) {
  const { sheet: sh, headerMap } = ecsEnsureEcsSheet_();

  const nowStr = nowTaipeiStr || nowTaipeiStr_();
  const nowDate = parseTaipeiTimestamp_(nowStr) || new Date();
  const found = findEcsRow_(sh, headerMap, userId, qId);

  const payload = {
    chosenIndex: chosenIndex,
    chosenText: chosenText,
    explanation: explanation || '',
    extra: extra || {}
  };

  logEcsEvent_(userId, qId, 'capture_wrong', { ...payload, ecs_row: found.row }, nowStr);

  const wrongRecent = ecsCalcRecent7dCount_(userId, qId, nowDate);

  if (found.row === -1) {
    const importanceWeight = (extra && extra.importance_weight != null) ? extra.importance_weight : 1;
    const wrongTotal = 1;
    const priority = ecsComputePriorityScore_({
      wrong_count_recent_7d: wrongRecent,
      wrong_count_total: wrongTotal,
      importance_weight: importanceWeight
    });

    const newRowObj = {
      user_id: userId,
      q_id: qId,
      wrong_count_total: wrongTotal,
      wrong_count_recent_7d: wrongRecent,
      last_wrong_at: nowStr,
      last_wrong_choice: chosenIndex,
      last_wrong_option_text: chosenText,
      status: 'active',
      graduation_correct_days_streak: 0,
      graduation_last_correct_date: '',
      variant_correct_count: 0,
      updated_at: nowStr,
      knowledge_tag: (extra && extra.knowledge_tag) ? extra.knowledge_tag : '',
      remedial_card_text: (extra && extra.remedial_card_text) ? extra.remedial_card_text : (explanation || ''),
      remedial_asset_url: (extra && extra.remedial_asset_url) ? extra.remedial_asset_url : '',
      importance_weight: importanceWeight,
      priority_score: priority
    };

    const newRow = appendRowByHeaders_(sh, headerMap, newRowObj);
    return {
      ok: true,
      action: 'insert',
      row: newRow,
      ecs: newRowObj
    };
  }

  // update
  const rowVals = found.values;
  const wrongTotalOld = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_total'), 0);
  const statusOld = String(getCell_(rowVals, headerMap, 'status') || '').trim() || 'active';
  const importanceOld = getCell_(rowVals, headerMap, 'importance_weight');
  const importanceWeight = (extra && extra.importance_weight != null) ? extra.importance_weight : safeNumber_(importanceOld, 1);

  const wrongTotalNew = wrongTotalOld + 1;
  const priority = ecsComputePriorityScore_({
    wrong_count_recent_7d: wrongRecent,
    wrong_count_total: wrongTotalNew,
    importance_weight: importanceWeight
  });

  const remedialOld = String(getCell_(rowVals, headerMap, 'remedial_card_text') || '').trim();
  const remedialText = remedialOld ? remedialOld : (explanation || '');

  const updateObj = {
    wrong_count_total: wrongTotalNew,
    wrong_count_recent_7d: wrongRecent,
    last_wrong_at: nowStr,
    last_wrong_choice: chosenIndex,
    last_wrong_option_text: chosenText,
    status: statusOld || 'active',
    updated_at: nowStr,
    knowledge_tag: (extra && extra.knowledge_tag) ? extra.knowledge_tag : getCell_(rowVals, headerMap, 'knowledge_tag'),
    remedial_card_text: (extra && extra.remedial_card_text) ? extra.remedial_card_text : remedialText,
    remedial_asset_url: (extra && extra.remedial_asset_url) ? extra.remedial_asset_url : getCell_(rowVals, headerMap, 'remedial_asset_url'),
    importance_weight: importanceWeight,
    priority_score: priority
  };

  setRowByMap_(sh, found.row, headerMap, updateObj);

  return {
    ok: true,
    action: 'update',
    row: found.row,
    ecs: updateObj
  };
}

/**
 * 答對：若該題存在 ECS 且 status=active，則更新 streak；不同天才 +1；達 3 -> graduated
 * @param {string} userId
 * @param {string} qId
 * @param {string} nowTaipeiStr
 */
function ecsUpdateOnCorrect(userId, qId, nowTaipeiStr, todayStr) {
  const sh = getSheet_(ECS_SHEET_NAME, true);

  const requiredHeaders = [
    'user_id','q_id','wrong_count_total','wrong_count_recent_7d','last_wrong_at',
    'last_wrong_choice','last_wrong_option_text','status',
    'graduation_correct_days_streak','graduation_last_correct_date',
    'variant_correct_count','updated_at','knowledge_tag','remedial_card_text',
    'remedial_asset_url','importance_weight','priority_score'
  ];
  const headerMap = ensureHeaders_(sh, requiredHeaders);

  const nowStr = nowTaipeiStr || nowTaipeiStr_();
  const today = todayStr || todayTaipeiStr_();

  const found = findEcsRow_(sh, headerMap, userId, qId);
  if (found.row === -1) {
    // 不在錯題本，不做事，但仍可留事件
    logEcsEvent_(userId, qId, 'ecs_correct_non_ecs', { note: 'not_in_ecs' }, nowStr);
    return { ok: true, action: 'noop', reason: 'not_in_ecs' };
  }

  const rowVals = found.values;
  const status = String(getCell_(rowVals, headerMap, 'status') || '').trim() || 'active';
  if (status !== 'active') {
    logEcsEvent_(userId, qId, 'ecs_correct_ignored', { status }, nowStr);
    return { ok: true, action: 'noop', reason: 'not_active', status };
  }

  const lastCorrectDate = String(getCell_(rowVals, headerMap, 'graduation_last_correct_date') || '').trim();
  let streak = safeNumber_(getCell_(rowVals, headerMap, 'graduation_correct_days_streak'), 0);

  let newStatus = status;
  let graduated = false;

  if (lastCorrectDate !== today) {
    streak += 1;
  }

  if (streak >= 3) {
    newStatus = 'graduated';
    graduated = true;
  }

  const importanceWeight = safeNumber_(getCell_(rowVals, headerMap, 'importance_weight'), 1);
  const wrongRecent = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_recent_7d'), 0);
  const wrongTotal = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_total'), 0);
  const priority = computePriorityScore_(wrongRecent, wrongTotal, importanceWeight);

  const updateObj = {
    graduation_correct_days_streak: streak,
    graduation_last_correct_date: today,
    status: newStatus,
    updated_at: nowStr,
    priority_score: priority
  };

  setRowByMap_(sh, found.row, headerMap, updateObj);
  logEcsEvent_(userId, qId, 'ecs_correct', { streak, today, row: found.row }, nowStr);
  if (graduated) {
    logEcsEvent_(userId, qId, 'ecs_graduate', { streak, today, row: found.row }, nowStr);
  }

  return {
    ok: true,
    action: 'update',
    row: found.row,
    status: newStatus,
    streak: streak
  };
}

/**
 * 取錯題 queue（只取 status=active）
 * 排序：priority_score DESC → wrong_count_total DESC → last_wrong_at DESC
 * @param {string} userId
 * @param {number} limit
 * @returns {object} { ok, q_ids, meta }
 */
function ecsGetQueue(userId, limit) {
  const { sheet: sh, headerMap } = ecsEnsureEcsSheet_();

  const nowStr = nowTaipeiStr_();
  const nowDate = parseTaipeiTimestamp_(nowStr) || new Date();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ok: true, q_ids: [], meta: { total_active: 0, now_taipei: nowStr } };
  }

  const recentMap = ecsCalcRecent7dMap_(userId, nowDate);

  const values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  const uCol = headerMap['user_id'];
  const qCol = headerMap['q_id'];
  const stCol = headerMap['status'];

  const items = [];
  const updates = [];
  for (let i = 0; i < values.length; i++) {
    const rowVals = values[i];
    if (String(rowVals[uCol - 1]) !== String(userId)) continue;
    const status = String(rowVals[stCol - 1] || '').trim() || 'active';
    if (status !== 'active') continue;

    const qId = String(rowVals[qCol - 1]);
    const wrongTotal = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_total'), 0);
    const importanceWeight = safeNumber_(getCell_(rowVals, headerMap, 'importance_weight'), 1);
    const lastWrongAt = String(getCell_(rowVals, headerMap, 'last_wrong_at') || '');
    const recentCount = recentMap.get(qId) || 0;

    const priority = ecsComputePriorityScore_({
      wrong_count_recent_7d: recentCount,
      wrong_count_total: wrongTotal,
      importance_weight: importanceWeight,
      last_wrong_at: lastWrongAt
    });

    const storedRecent = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_recent_7d'), 0);
    const storedPriority = safeNumber_(getCell_(rowVals, headerMap, 'priority_score'), 0);
    if (storedRecent !== recentCount || storedPriority !== priority) {
      updates.push({ row: i + 2, wrong_count_recent_7d: recentCount, priority_score: priority });
    }

    items.push({
      q_id: qId,
      priority_score: priority,
      wrong_count_total: wrongTotal,
      last_wrong_at: lastWrongAt
    });
  }

  updates.forEach(upd => {
    setRowByMap_(sh, upd.row, headerMap, {
      wrong_count_recent_7d: upd.wrong_count_recent_7d,
      priority_score: upd.priority_score
    });
  });

  items.sort((a, b) => {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
    if (b.wrong_count_total !== a.wrong_count_total) return b.wrong_count_total - a.wrong_count_total;
    return String(b.last_wrong_at).localeCompare(String(a.last_wrong_at));
  });

  const lim = Math.max(1, Math.min(safeNumber_(limit, 30), 200));
  const picked = items.slice(0, lim).map(x => x.q_id);

  return {
    ok: true,
    q_ids: picked,
    meta: {
      total_active: items.length,
      limit: lim,
      now_taipei: nowStr,
      recent_window_days: ECS_RECENT_WINDOW_DAYS,
      events_scan_days: ECS_EVENTS_SCAN_DAYS,
      events_scan_cap: ECS_EVENTS_SCAN_CAP
    }
  };
}

/**
 * （可選）提供給後端 debug 用：查單題 ECS 狀態
 */
function ecsGetOne(userId, qId) {
  const sh = getSheet_(ECS_SHEET_NAME, true);
  const headerMap = ensureHeaders_(sh, [
    'user_id','q_id','wrong_count_total','wrong_count_recent_7d','last_wrong_at',
    'last_wrong_choice','last_wrong_option_text','status',
    'graduation_correct_days_streak','graduation_last_correct_date',
    'variant_correct_count','updated_at','knowledge_tag','remedial_card_text',
    'remedial_asset_url','importance_weight','priority_score'
  ]);

  const found = findEcsRow_(sh, headerMap, userId, qId);
  if (found.row === -1) return { ok: true, exists: false };

  // 回傳部分欄位方便檢視
  const rowVals = found.values;
  return {
    ok: true,
    exists: true,
    row: found.row,
    data: {
      user_id: userId,
      q_id: qId,
      status: getCell_(rowVals, headerMap, 'status'),
      wrong_count_total: getCell_(rowVals, headerMap, 'wrong_count_total'),
      wrong_count_recent_7d: getCell_(rowVals, headerMap, 'wrong_count_recent_7d'),
      last_wrong_at: getCell_(rowVals, headerMap, 'last_wrong_at'),
      last_wrong_choice: getCell_(rowVals, headerMap, 'last_wrong_choice'),
      last_wrong_option_text: getCell_(rowVals, headerMap, 'last_wrong_option_text'),
      streak: getCell_(rowVals, headerMap, 'graduation_correct_days_streak'),
      last_correct_date: getCell_(rowVals, headerMap, 'graduation_last_correct_date'),
      priority_score: getCell_(rowVals, headerMap, 'priority_score'),
      updated_at: getCell_(rowVals, headerMap, 'updated_at')
    }
  };
}
