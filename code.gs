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
        return buildCorsResponse_({ ok: false, message: 'chosen_index required', error_code: 'BAD_PARAMS' }, 400);
      }

      const chosen_index_norm = parseInt(String(chosenRaw).trim(), 10);
      if (Number.isNaN(chosen_index_norm)) {
        return buildCorsResponse_({ ok: false, message: 'invalid chosen_index', error_code: 'BAD_ANSWER_KEY_OR_CHOSEN_INDEX' }, 400);
      }

      try {
        const nowStr = nowTaipeiStr_();
        const todayStr = todayTaipei_();

        // 找題目
        const q = getQuestionById_(q_id);
        if (!q) return buildCorsResponse_({ ok: false, message: 'question not found: ' + q_id, error_code: 'QUESTION_NOT_FOUND' }, 404);

        const answer_key_norm = Number(String(q.answer_key).trim());
        if (!Number.isFinite(answer_key_norm)) {
          return buildCorsResponse_({ ok: false, message: 'bad answer_key', error_code: 'BAD_ANSWER_KEY_OR_CHOSEN_INDEX' }, 400);
        }

        const ci = Number(chosen_index_norm);
        const ak = Number(answer_key_norm);
        const isCorrect = (ci === ak);

        // 預先計算 Mastery（實際寫入放在 ECS 之後）
        const masteryPlan = masteryComputeUpdate_(user_id, q, chosen_index_norm, isCorrect);
        const mastery = masteryPlan.summary;

        // 寫入 Logs（使用正規化後的 chosen_index）
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
          strength_before: mastery.strength_before,
          strength_after: mastery.strength_after,
          next_review_at: mastery.next_review_at,
          client_ip: (e && e.headers && e.headers['X-Forwarded-For']) ? e.headers['X-Forwarded-For'] : '',
          user_agent: (e && e.headers && e.headers['User-Agent']) ? e.headers['User-Agent'] : '',
        });

        let ecsStatus = 'none';
        let ecsStreak = null;

        if (!isCorrect) {
          const options = normalizeOptionsList_(q.options);
          const chosenText = options[chosen_index_norm] || '';
          ecsUpsertOnWrong(
            user_id,
            q_id,
            ci,
            chosenText,
            q.explanation || '',
            nowStr,
            {
              knowledge_tag: q.unit || '',
              remedial_card_text: q.explanation || '',
              remedial_asset_url: '',
              importance_weight: 1,
            }
          );
          ecsStatus = 'active';
        } else {
          const ecsUpdate = ecsUpdateOnCorrect(user_id, q_id, nowStr, todayStr);
          if (ecsUpdate && ecsUpdate.status) {
            ecsStatus = ecsUpdate.status;
          }
          if (ecsUpdate && ecsUpdate.streak !== undefined) {
            ecsStreak = ecsUpdate.streak;
          }
        }

        // 更新 Mastery（ECS 處理完成後才寫入）
        masteryApplyUpdate_(masteryPlan.sheet, masteryPlan.rowValues, masteryPlan.rowIndex);

        return buildCorsResponse_({
          ok: true,
          q_id,
          recorded: !!(logOk && logOk.ok !== false),
          recorded_message: logOk && logOk.message ? logOk.message : undefined,
          is_correct: isCorrect,
          now_taipei: nowStr,
          explanation: q.explanation || '',
          ecs_status: ecsStatus,
          ecs_streak: ecsStreak,
          need_remedial: !isCorrect && mastery.strength_before >= 4,
          chosen_index_norm,
          answer_key_norm,
        });
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, message: msg, error_code: 'SERVER_ERROR' }, 500);
      }
    }

    if (action === 'getLatestLog') {
      const user_id = String(params.user_id || 'u001').trim();
      const latest = getLatestLog_(user_id);
      return jsonOk_({ ok: true, latest, ts_taipei: nowTaipei_() });
    }

    if (action === 'getEcsQueue') {
      const user_id = String(params.user_id || 'u001').trim();
      const limit = Number(params.limit || 30);
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
      if (!meta.now_taipei) meta.now_taipei = nowTaipei_();
      meta.limit = meta.limit || limit;
      return jsonOk_({
        ok: true,
        data: questions,
        meta,
      });
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
    output.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
