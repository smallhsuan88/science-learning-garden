/** logservice.gs
 * 作答紀錄寫入 Logs Sheet
 */

function ensureLogsSheet_() {
  const sh = getSheet_(APP_CONFIG.SHEETS.LOGS, true);
  const headers = [
    'timestamp',
    'ts_taipei',
    'user_id',
    'q_id',
    'grade',
    'unit',
    'difficulty',
    'chosen_answer',
    'answer_key',
    'is_correct',
    'strength_before',
    'strength_after',
    'next_review_at',
    'client_ip',
    'user_agent',
  ];
  const headerMap = ensureHeaders_(sh, headers);
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  return { sheet: sh, headerMap };
}

function appendLog_(logObj) {
  try {
    const { sheet, headerMap } = ensureLogsSheet_();
    const ts = logObj.timestamp || logObj.ts_taipei || nowTaipeiStr_();
    const rowObj = {
      timestamp: ts,
      ts_taipei: ts,
      user_id: logObj.user_id || '',
      q_id: logObj.q_id || '',
      grade: logObj.grade ?? '',
      unit: logObj.unit || '',
      difficulty: logObj.difficulty || '',
      chosen_answer: logObj.chosen_answer ?? '',
      answer_key: logObj.answer_key ?? '',
      is_correct: logObj.is_correct ? 'TRUE' : 'FALSE',
      strength_before: logObj.strength_before ?? '',
      strength_after: logObj.strength_after ?? '',
      next_review_at: logObj.next_review_at || '',
      client_ip: logObj.client_ip || '',
      user_agent: logObj.user_agent || '',
    };
    appendRowByHeaders_(sheet, headerMap, rowObj);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message ? err.message : err) };
  }
}

function getLatestLog_(userId) {
  const { sheet: sh } = ensureLogsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => String(h || '').trim());
  const idx = (name) => headers.indexOf(name);

  const iUser = idx('user_id');
  const iTs = idx('timestamp') >= 0 ? idx('timestamp') : idx('ts_taipei');
  const iQid = idx('q_id');
  const iCorrect = idx('is_correct');

  for (let r = values.length - 1; r >= 1; r--) {
    const row = values[r];
    if (String(row[iUser] || '').trim() !== String(userId || '').trim()) continue;
    return {
      ts_taipei: row[iTs] || '',
      user_id: row[iUser] || '',
      q_id: row[iQid] || '',
      is_correct: String(row[iCorrect] || '').toUpperCase() === 'TRUE',
      row_index: r + 1,
    };
  }
  return null;
}
