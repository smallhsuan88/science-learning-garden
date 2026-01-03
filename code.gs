/** code.gs
 * Web App 入口：doGet / doPost
 * Actions: ping, getQuestions, submitAnswer, getLatestLog
 */

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  // 盡量避免 preflight，仍保留 POST 但僅接受 form-urlencoded
  return handleRequest_(e, 'POST');
}

function doOptions(e) {
  return buildCorsResponse_({});
}

function handleRequest_(e, method) {
  try {
    const params = normalizeParams_(e, method);
    const action = String(params.action || '').trim();

    if (!action) {
      return jsonOk_({ ok: true, message: 'ok', hint: 'use ?action=ping' });
    }

    if (action === 'ping') {
      const nowStr = nowTaipeiStr_();
      return jsonOk_({ ok: true, message: 'pong', ts: nowStr, ts_taipei: nowStr });
    }

    if (action === 'authTest') {
      const nowStr = nowTaipeiStr_();
      return jsonOk_({ ok: true, message: 'auth ok', now_taipei: nowStr });
    }

    if (isProtectedAction_(action)) {
      const auth = requireAuth_(params, e);
      if (!auth.ok) {
        return buildCorsResponse_(auth.payload, 401);
      }
    }

    if (action === 'getQuestions') {
      const user_id = String(params.user_id || 'u001').trim();
      const limit = Number(params.limit || APP_CONFIG.DEFAULT_LIMIT);

      const filters = {
        grade: params.grade || '',
        unit: params.unit || '',
        difficulty: params.difficulty || '',
      };

      const result = masteryPickQuestions_(user_id, filters, limit);
      return jsonOk_(result);
    }

    if (action === 'submitAnswer') {
      const user_id = String(params.user_id || 'u001').trim();
      const q_id = String(params.q_id || '').trim();
      const chosenRaw = params.chosen_index;
      if (!q_id) {
        return buildCorsResponse_({ ok: false, message: 'q_id required', error_code: 'BAD_PARAMS' }, 400);
      }
      if (chosenRaw === undefined || chosenRaw === null || String(chosenRaw).trim() === '') {
        return buildCorsResponse_({ ok: false, message: 'missing chosen_index', error_code: 'BAD_PARAMS' }, 400);
      }

      const chosen_index_norm = Number(chosenRaw);
      if (!Number.isFinite(chosen_index_norm)) {
        return buildCorsResponse_({ ok: false, message: 'invalid chosen_index', error_code: 'BAD_ANSWER_KEY_OR_CHOSEN_INDEX' }, 400);
      }

      try {
        const nowStr = nowTaipeiStr_();
        const requestId = params.request_id || Utilities.getUuid();

        const q = getQuestionById_(q_id);
        if (!q) return buildCorsResponse_({ ok: false, message: 'question not found: ' + q_id, error_code: 'QUESTION_NOT_FOUND', now_taipei: nowStr }, 404);

        const ansRaw = q.answer_key;
        const answer_key_norm = Number(String(ansRaw).trim());
        if (!Number.isFinite(answer_key_norm)) {
          return buildCorsResponse_({ ok: false, message: 'bad answer_key', error_code: 'BAD_ANSWER_KEY_OR_CHOSEN_INDEX', now_taipei: nowStr }, 400);
        }

        const ci = Number(chosen_index_norm);
        const ak = Number(answer_key_norm);
        const isCorrect = (ci === ak);
        const explanation = q.explanation || '';

        const dupCheck = markDuplicateKey_(user_id, q_id, ci, 2, nowStr);
        if (dupCheck.duplicated) {
          return buildCorsResponse_({
            ok: true,
            is_correct: isCorrect,
            explanation,
            duplicated: true,
            recorded: false,
            write_deferred: false,
            request_id: requestId,
            now_taipei: nowStr,
            q_id,
            chosen_index_norm,
            answer_key_norm,
            debug: { duplicate_ts: dupCheck.previous_ts, q_id },
          });
        }

        const responsePayload = {
          ok: true,
          is_correct: isCorrect,
          explanation,
          duplicated: false,
          recorded: false,
          write_deferred: true,
          request_id: requestId,
          now_taipei: nowStr,
          q_id,
          chosen_index_norm,
          answer_key_norm,
        };

        const clientTs = params.client_ts || '';
        const chosenText = (typeof params.chosen_text !== 'undefined' && params.chosen_text !== null)
          ? String(params.chosen_text)
          : (normalizeOptionsList_(q.options)[ci] || '');
        const queueId = Utilities.getUuid();
        const idempotencyKey = clientTs
          ? ['ans', user_id, q_id, ci, String(clientTs)].join(':')
          : ['ans', user_id, q_id, ci, Math.floor(Date.now() / 2000)].join(':');
        const queuePayload = {
          queue_id: queueId,
          status: 'queued',
          attempt: 0,
          created_at: nowStr,
          updated_at: nowStr,
          next_retry_at: '',
          request_id: requestId,
          idempotency_key: idempotencyKey,
          user_id,
          q_id,
          grade: q.grade,
          unit: q.unit,
          difficulty: q.difficulty,
          chosen_index: ci,
          chosen_text: chosenText,
          answer_key: ak,
          is_correct: isCorrect,
          explanation,
          client_ts: clientTs,
          server_ts: nowStr,
          mode: params.mode || '',
        };
        queuePayload.payload_json = JSON.stringify(queuePayload);

        let queueResult = { enqueued: false, duplicated: false, queue_id: queueId };
        try {
          queueResult = enqueueWriteQueue_(queuePayload) || queueResult;
        } catch (queueErr) {
        }

        responsePayload.queue_id = queueResult.queue_id || queueId;
        responsePayload.write_deferred = true;
        responsePayload.queued = !!queueResult.enqueued;
        responsePayload.queue_duplicated = !!queueResult.duplicated;
        if (queueResult.lock_failed) responsePayload.lock_failed = true;
        responsePayload.recorded = false;

        return buildCorsResponse_(responsePayload);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, message: msg, error_code: 'SERVER_ERROR', now_taipei: nowTaipeiStr_() }, 500);
      }
    }

    if (action === 'getLatestLog') {
      const user_id = String(params.user_id || 'u001').trim();
      const latest = getLatestLog_(user_id);
      return jsonOk_({ ok: true, latest, ts_taipei: nowTaipeiStr_() });
    }

    if (action === 'getLearningReport') {
      const user_id = String(params.user_id || '').trim();
      if (!user_id) {
        return buildCorsResponse_({ ok: false, message: 'user_id required', error_code: 'BAD_PARAMS' }, 400);
      }
      try {
        const report = getLearningReport_(user_id, params.days);
        return buildCorsResponse_(report);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, message: msg, error_code: 'SERVER_ERROR' }, 500);
      }
    }

    if (action === 'resetUser') {
      const user_id = String(params.user_id || '').trim();
      if (!user_id) {
        return buildCorsResponse_({ ok: false, message: 'user_id required', error_code: 'BAD_PARAMS' }, 400);
      }
      const purgeEvents = String(params.purge_events || '').trim() === '1';
      try {
        const result = resetUserData_(user_id, { purgeEvents });
        return jsonOk_(result);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, message: msg, error_code: 'SERVER_ERROR' }, 500);
      }
    }

    if (action === 'getEcsQueue') {
      const user_id = String(params.user_id || 'u001').trim();
      const limit = Number(params.limit || 30);
      if (typeof ecsGetQueue !== 'function') {
        return jsonOk_({ ok: false, message: 'not implemented' });
      }
      try {
        const queue = ecsGetQueue(user_id, limit);
        const qIds = Array.isArray(queue.q_ids) ? queue.q_ids : [];
        const questionsById = new Map(getQuestionsAll_().map(q => [q.question_id, q]));
        const questions = [];
        qIds.forEach(id => {
          const q = questionsById.get(id);
          if (q) questions.push(q);
        });
        const meta = queue.meta || {};
        if (meta.total_active === undefined) meta.total_active = questions.length;
        if (!meta.now_taipei) meta.now_taipei = nowTaipeiStr_();
        meta.limit = meta.limit || limit;
        return jsonOk_({
          ok: true,
          data: questions,
          meta,
        });
      } catch (ecsQueueErr) {
        return jsonOk_({ ok: false, message: 'not implemented' });
      }
    }

    if (action === 'getMasterySummary') {
      if (typeof getMasterySummary_ !== 'function') {
        return jsonOk_({ ok: false, message: 'not implemented', now_taipei: nowTaipeiStr_() });
      }
      try {
        const user_id = String(params.user_id || '').trim();
        const summary = getMasterySummary_(user_id);
        return jsonOk_(summary);
      } catch (masterySummaryErr) {
        return jsonOk_({ ok: false, message: 'not implemented', now_taipei: nowTaipeiStr_() });
      }
    }

    if (action === 'debugAnswerKey') {
      const q_id = String(params.q_id || '').trim();
      if (!q_id) {
        return buildCorsResponse_({ ok: false, message: 'q_id required', error_code: 'BAD_PARAMS' }, 400);
      }
      try {
        const debug = debugAnswerKey_(q_id);
        return jsonOk_(debug);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, message: msg, error_code: 'SERVER_ERROR' }, 500);
      }
    }

    if (action === 'validateQuestions') {
      const limit = Number(params.limit || 200);
      const refresh = params.refresh;
      const result = validateQuestions_(limit, refresh);
      return jsonOk_(result);
    }

    if (action === 'refreshQuestionsCache') {
      try {
        const cacheVer = bumpQuestionsCacheVersion_();
        return jsonOk_({
          ok: true,
          cache_ver: cacheVer,
          ts_taipei: nowTaipeiStr_(),
        });
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, message: msg, error_code: 'SERVER_ERROR' }, 500);
      }
    }

    return jsonError_('unknown action: ' + action, 'UNKNOWN_ACTION');

  } catch (err) {
    return jsonError_(String(err && err.message ? err.message : err), 'SERVER_ERROR', 500);
  }
}

function jsonOk_(obj) {
  const out = obj || {};
  if (out.ok === undefined) out.ok = true;
  return buildCorsResponse_(out);
}

function jsonError_(message, errorCode, httpCode) {
  const out = { ok: false, message: String(message || 'error'), error_code: errorCode || 'SERVER_ERROR' };
  return buildCorsResponse_(out, httpCode || 400);
}

function normalizeParams_(e, method) {
  const params = (e && e.parameter) ? Object.assign({}, e.parameter) : {};

  if (method === 'POST' && e && e.postData) {
    const ctype = (e.postData.type || '').toLowerCase();
    if (ctype.includes('application/json')) {
      try {
        const bodyObj = JSON.parse(e.postData.contents || '{}');
        Object.assign(params, bodyObj);
      } catch (_) { }
    } else {
      // application/x-www-form-urlencoded already merged into e.parameter
    }
  }
  return params;
}

function buildCorsResponse_(payload, status) {
  const text = JSON.stringify(payload || {});
  const output = ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);

  if (output.setHeader) {
    output.setHeader('Access-Control-Allow-Origin', '*');
    output.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    output.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  }
  if (status && output.setResponseCode) {
    output.setResponseCode(status);
  }
  return output;
}

function normalizeOptionsList_(optionsStr) {
  const s = String(optionsStr || '').replace(/，/g, ',');
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

function markDuplicateKey_(userId, qId, chosenIndex, secondsWindow, nowStr) {
  const cache = CacheService.getScriptCache();
  const key = ['dup', userId || '', qId || '', String(chosenIndex)].join(':');
  const cached = cache.get(key);
  if (cached) {
    return { duplicated: true, previous_ts: cached };
  }
  const ts = nowStr || nowTaipeiStr_();
  try {
    cache.put(key, ts, Math.max(1, Number(secondsWindow || 2)));
  } catch (err) { }
  return { duplicated: false, previous_ts: null };
}

function debugAnswerKey_(qId) {
  const spreadsheetId = getSpreadsheetIdFromProps_();
  if (!spreadsheetId) {
    return { ok: false, message: 'Script Properties 缺少 SPREADSHEET_ID' };
  }

  const { sheet, headerMap } = ensureQuestionsSheet_();
  const values = sheet.getDataRange().getValues();
  const result = {
    ok: true,
    q_id: qId,
    headerMap: headerMap,
    sheetName: sheet.getName(),
    spreadsheet_id: spreadsheetId,
  };

  if (values.length < 2) {
    result.message = 'Questions sheet empty';
    return result;
  }

  const getVal = (row, key) => {
    const col = headerMap[key];
    if (!col) return '';
    return row[col - 1];
  };

  let foundRow = null;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rowQid = String(getVal(row, 'question_id') || '').trim();
    if (rowQid === qId) {
      foundRow = row;
      break;
    }
  }

  if (!foundRow) {
    result.exists = false;
    return result;
  }

  const ansRaw = getVal(foundRow, 'answer_key');
  const optionsRaw = getVal(foundRow, 'options');

  result.exists = true;
  result.answer_key_raw = ansRaw;
  result.answer_key_number = Number(ansRaw);
  result.options_raw = optionsRaw;
  result.explanation_raw = getVal(foundRow, 'explanation');

  return result;
}

function test_submitAnswer_shape_() {
  const sample = {
    ok: true,
    is_correct: false,
    explanation: '這是詳解範例',
    duplicated: false,
    recorded: false,
    write_deferred: true,
    request_id: Utilities.getUuid(),
    now_taipei: nowTaipeiStr_(),
  };
  Logger.log(sample);
  return sample;
}

function ensureWriteQueueSheet_() {
  const spreadsheetId = getSpreadsheetIdFromProps_();
  if (!spreadsheetId) {
    throw new Error('Script Properties 缺少 SPREADSHEET_ID');
  }
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName('WriteQueue');
  if (!sheet) {
    sheet = ss.insertSheet('WriteQueue');
    const header = [
      'queue_id',
      'status',
      'attempt',
      'created_at',
      'updated_at',
      'next_retry_at',
      'request_id',
      'idempotency_key',
      'payload_json',
    ];
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
  const headerMap = getWriteQueueHeaderMap_(sheet);
  return { sheet, headerMap };
}

function getWriteQueueHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, idx) => {
    const key = String(h || '').trim();
    if (key) map[key] = idx + 1;
  });
  return map;
}

function getTaipeiMs_() {
  return Date.now();
}

function enqueueWriteQueue_(payload) {
  const { sheet, headerMap } = ensureWriteQueueSheet_();
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  const idempotencyKey = String(payload.idempotency_key || '').trim();
  const cacheKey = idempotencyKey ? 'wq:' + idempotencyKey : '';
  const cacheTtl = 60 * 60 * 6;

  if (cacheKey) {
    const cachedQueueId = cache.get(cacheKey);
    if (cachedQueueId) {
      return { enqueued: false, duplicated: true, queue_id: cachedQueueId || payload.queue_id };
    }
  }

  let lockAcquired = false;
  try {
    try {
      lock.waitLock(2000);
      lockAcquired = true;
    } catch (lockErr) {
      return { enqueued: false, duplicated: false, queue_id: payload.queue_id, lock_failed: true };
    }

    const lastRow = sheet.getLastRow();
    const colIdempotency = headerMap['idempotency_key'];
    const colQueueId = headerMap['queue_id'];
    if (colIdempotency) {
      const maxRows = 500;
      const startRow = Math.max(2, lastRow - maxRows + 1);
      const rowCount = lastRow >= startRow ? (lastRow - startRow + 1) : 0;
      if (rowCount > 0) {
        const idempotencyValues = sheet.getRange(startRow, colIdempotency, rowCount, 1).getValues();
        const queueIdValues = colQueueId ? sheet.getRange(startRow, colQueueId, rowCount, 1).getValues() : null;
        for (let i = 0; i < rowCount; i++) {
          const rowIdemp = String(idempotencyValues[i][0] || '').trim();
          if (rowIdemp && rowIdemp === idempotencyKey) {
            const existingQueueId = queueIdValues ? (queueIdValues[i][0] || '') : '';
            if (cacheKey) {
              if (existingQueueId) {
                try { cache.put(cacheKey, existingQueueId, cacheTtl); } catch (err) { }
              }
            }
            return { enqueued: false, duplicated: true, queue_id: existingQueueId || payload.queue_id };
          }
        }
      }
    }

    const payloadJson = payload.payload_json || JSON.stringify(payload);
    const data = new Array(sheet.getLastColumn() || Object.keys(headerMap).length || 1).fill('');
    Object.keys(headerMap).forEach(key => {
      const colIdx = headerMap[key] - 1;
      if (key === 'payload_json') {
        data[colIdx] = payloadJson;
      } else if (payload.hasOwnProperty(key)) {
        data[colIdx] = payload[key];
      }
    });
    sheet.appendRow(data);

    if (cacheKey) {
      try { cache.put(cacheKey, payload.queue_id, cacheTtl); } catch (err) { }
    }
    return { enqueued: true, duplicated: false, queue_id: payload.queue_id };
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (releaseErr) { }
    }
  }
}
