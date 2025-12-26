/** logservice.gs
 * 作答紀錄寫入 Logs Sheet
 */

function ensureLogsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(APP_CONFIG.SHEETS.LOGS);
  if (!sh) {
    sh = ss.insertSheet(APP_CONFIG.SHEETS.LOGS);
  }
  const headers = [
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

  const lastCol = sh.getLastColumn();
  const firstRow = sh.getRange(1, 1, 1, Math.max(lastCol, headers.length)).getValues()[0];
  const isEmpty = sh.getLastRow() === 0 || firstRow.every(v => v === '');
  if (isEmpty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function appendLog_(logObj) {
  const sh = ensureLogsSheet_();
  const row = [
    logObj.ts_taipei || nowTaipei_(),
    logObj.user_id || '',
    logObj.q_id || '',
    logObj.grade ?? '',
    logObj.unit || '',
    logObj.difficulty || '',
    logObj.chosen_answer ?? '',
    logObj.answer_key ?? '',
    logObj.is_correct ? 'TRUE' : 'FALSE',
    logObj.strength_before ?? '',
    logObj.strength_after ?? '',
    logObj.next_review_at || '',
    logObj.client_ip || '',
    logObj.user_agent || '',
  ];
  sh.appendRow(row);
  return true;
}

function getLatestLog_(userId) {
  const sh = ensureLogsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => String(h || '').trim());
  const idx = (name) => headers.indexOf(name);

  const iUser = idx('user_id');
  const iTs = idx('ts_taipei');
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
