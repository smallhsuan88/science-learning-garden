/** code.gs
 * Web App 入口：doGet / doPost
 * Actions: ping, getQuestions, submitAnswer
 */

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

function handleRequest_(e, method) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = String(params.action || '').trim();

    if (!action) {
      return jsonOk_({ ok: true, message: 'ok', hint: 'use ?action=ping' });
    }

    if (action === 'ping') {
      return jsonOk_({ ok: true, message: 'pong', ts: new Date().toISOString(), ts_taipei: formatTaipeiTs_(new Date()) });
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
      const body = parseJsonBody_(e);
      const user_id = String(body.user_id || params.user_id || 'u001').trim();
      const q_id = String(body.q_id || '').trim();
      const chosen_answer = Number(body.chosen_answer);

      if (!q_id || Number.isNaN(chosen_answer)) {
        return jsonError_('missing q_id or chosen_answer');
      }

      // 找題目
      const all = getQuestionsAll_();
      const q = all.find(x => x.question_id === q_id);
      if (!q) return jsonError_('question not found: ' + q_id);

      const answerKey = Number(q.answer_key);
      const isCorrect = (chosen_answer === answerKey);

      // 更新 Mastery（計算下一次複習時間/等級）
      const mastery = masteryUpdateAfterAnswer_(user_id, q, chosen_answer, isCorrect);

      // 寫入 Logs
      const logOk = appendLog_({
        ts_taipei: formatTaipeiTs_(new Date()),
        user_id,
        q_id,
        grade: q.grade,
        unit: q.unit,
        difficulty: q.difficulty,
        chosen_answer,
        answer_key: answerKey,
        is_correct: isCorrect,
        strength_before: mastery.strength_before,
        strength_after: mastery.strength_after,
        next_review_at: mastery.next_review_at,
        client_ip: (e && e.headers && e.headers['X-Forwarded-For']) ? e.headers['X-Forwarded-For'] : '',
        user_agent: (e && e.headers && e.headers['User-Agent']) ? e.headers['User-Agent'] : '',
      });

      // need_remedial：Level>=4 答錯觸發（也可以改成任何錯都觸發）
      const needRemedial = (!isCorrect && mastery.strength_before >= 4);

      return jsonOk_({
        ok: true,
        q_id,
        is_correct: isCorrect,
        correct_answer: answerKey,
        explanation: q.explanation || '',
        recorded: !!logOk,
        need_remedial: needRemedial,
        mastery,
        ts_taipei: formatTaipeiTs_(new Date()),
      });
    }

    return jsonError_('unknown action: ' + action);

  } catch (err) {
    return jsonError_(String(err && err.message ? err.message : err), 500);
  }
}

function parseJsonBody_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return {};
    return JSON.parse(e.postData.contents);
  } catch (e2) {
    return {};
  }
}

function jsonOk_(obj) {
  const out = obj || {};
  if (out.ok === undefined) out.ok = true;
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(message, code) {
  const out = { ok: false, message: String(message || 'error'), code: code || 400 };
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
