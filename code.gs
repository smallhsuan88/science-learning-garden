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
      return jsonOk_({ ok: true, message: 'pong', ts: new Date().toISOString(), ts_taipei: nowTaipei_() });
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
      if (chosenRaw === undefined || chosenRaw === null || String(chosenRaw).trim() === '') {
        return buildCorsResponse_({ ok: false, error: 'chosen_index required' });
      }

      const chosen_index = Number(chosenRaw);
      if (!Number.isInteger(chosen_index) || chosen_index < 0 || chosen_index > 3) {
        return buildCorsResponse_({ ok: false, error: 'chosen_index required' });
      }
      if (!q_id) {
        return buildCorsResponse_({ ok: false, error: 'q_id required' });
      }

      try {
        const nowStr = nowTaipei_();

        // 找題目
        const q = getQuestionById_(q_id);
        if (!q) return buildCorsResponse_({ ok: false, error: 'question not found: ' + q_id });

        const answerKey = Number(q.answer_key);
        const isCorrect = (chosen_index === answerKey);

        // 更新 Mastery（計算下一次複習時間/等級）
        const mastery = masteryUpdateAfterAnswer_(user_id, q, chosen_index, isCorrect);

        // 寫入 Logs
        const logOk = appendLog_({
          ts_taipei: nowStr,
          user_id,
          q_id,
          grade: q.grade,
          unit: q.unit,
          difficulty: q.difficulty,
          chosen_answer: chosen_index,
          answer_key: answerKey,
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
          const options = String(q.options || '').split(',').map(s => s.trim());
          const chosenText = options[chosen_index] || '';
          ecsUpsertOnWrong(
            user_id,
            q_id,
            chosen_index,
            chosenText,
            q.explanation || '',
            {
              knowledge_tag: q.unit || '',
              remedial_card_text: q.explanation || '',
              remedial_asset_url: '',
              importance_weight: 1,
            },
            nowStr
          );
          ecsStatus = 'active';
        } else {
          const ecsUpdate = ecsUpdateOnCorrect(user_id, q_id, nowStr);
          if (ecsUpdate && ecsUpdate.status) {
            ecsStatus = ecsUpdate.status;
          }
          if (ecsUpdate && ecsUpdate.streak !== undefined) {
            ecsStreak = ecsUpdate.streak;
          }
        }

        return buildCorsResponse_({
          ok: true,
          q_id,
          recorded: !!logOk,
          is_correct: isCorrect,
          explanation: q.explanation || '',
          ecs_status: ecsStatus,
          ecs_streak: ecsStreak,
          need_remedial: !isCorrect && mastery.strength_before >= 4,
        });
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        return buildCorsResponse_({ ok: false, error: msg });
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
      const allQuestions = getQuestionsAll_();
      const mapById = new Map(allQuestions.map(q => [q.question_id, q]));
      const questions = [];
      qIds.forEach(id => {
        const q = mapById.get(id);
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

    return jsonError_('unknown action: ' + action);

  } catch (err) {
    return jsonError_(String(err && err.message ? err.message : err), 500);
  }
}

function jsonOk_(obj) {
  const out = obj || {};
  if (out.ok === undefined) out.ok = true;
  return buildCorsResponse_(out);
}

function jsonError_(message, code) {
  const out = { ok: false, message: String(message || 'error'), code: code || 400 };
  return buildCorsResponse_(out, code || 400);
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
