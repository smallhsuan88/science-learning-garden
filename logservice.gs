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
    logObj.ts_taipei || formatTaipeiTs_(new Date()),
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
