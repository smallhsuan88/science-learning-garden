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
        const todayStr = todayTaipeiStr_();
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

        let masteryPlan = null;
        try {
          masteryPlan = masteryComputeUpdate_(user_id, q, chosen_index_norm, isCorrect);
        } catch (masteryPlanErr) { }

        try {
          const logOk = appendLog_({
            timestamp: nowStr,
            ts_taipei: nowStr,
            user_id,
            q_id,
            grade: q.grade,
            unit: q.unit,
            difficulty: q.difficulty,
            chosen_answer: ci,
            answer_key: ak,
            is_correct: isCorrect,
            strength_before: masteryPlan && masteryPlan.summary ? masteryPlan.summary.strength_before : '',
            strength_after: masteryPlan && masteryPlan.summary ? masteryPlan.summary.strength_after : '',
            next_review_at: masteryPlan && masteryPlan.summary ? masteryPlan.summary.next_review_at : '',
            client_ip: (e && e.headers && e.headers['X-Forwarded-For']) ? e.headers['X-Forwarded-For'] : '',
            user_agent: (e && e.headers && e.headers['User-Agent']) ? e.headers['User-Agent'] : '',
          });
          if (logOk && logOk.ok) {
            responsePayload.recorded = true;
          }
        } catch (logErr) { }

        try {
          if (!isCorrect) {
            try {
              mistakesUpsertOnWrong(user_id, q_id, todayStr);
            } catch (mistakeErr) { }

            const options = normalizeOptionsList_(q.options);
            const chosenText = (typeof params.chosen_text !== 'undefined' && params.chosen_text !== null)
              ? String(params.chosen_text)
              : (options[ci] || '');
            ecsUpsertOnWrong(
              user_id,
              q_id,
              ci,
              chosenText,
              explanation,
              nowStr,
              {
                knowledge_tag: q.unit || '',
                remedial_card_text: explanation,
                remedial_asset_url: '',
                importance_weight: 1,
              }
            );
          } else {
            ecsUpdateOnCorrect(user_id, q_id, nowStr, todayStr);
          }
        } catch (ecsErr) { }

        try {
          if (masteryPlan) {
            masteryApplyUpdate_(masteryPlan.sheet, masteryPlan.headerMap, masteryPlan.rowObj, masteryPlan.rowIndex);
          }
        } catch (masteryErr) { }

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
