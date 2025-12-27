/** mistakeservice.gs
 * 錯題紀錄（Mistakes Sheet）
 */

function ensureMistakesSheet_() {
  const sh = getSheet_(APP_CONFIG.SHEETS.MISTAKES, true);
  const headers = ['user_id', 'q_id', 'strike', 'last_date'];
  const headerMap = ensureHeaders_(sh, headers);
  if (sh.getFrozenRows() < 1) {
    sh.setFrozenRows(1);
  }
  return { sheet: sh, headerMap };
}

function mistakesLoadMap_(userId) {
  const { sheet, headerMap } = ensureMistakesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return new Map();

  const getVal = (row, key) => {
    const col = headerMap[key];
    if (!col) return '';
    return row[col - 1];
  };

  const map = new Map();
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(getVal(row, 'user_id') || '').trim() !== userId) continue;
    const qid = String(getVal(row, 'q_id') || '').trim();
    if (!qid) continue;
    const strike = safeNumber_(getVal(row, 'strike'), 0);
    map.set(qid, strike);
  }

  return map;
}

function mistakesUpsertOnWrong(userId, qId, todayStr) {
  const { sheet, headerMap } = ensureMistakesSheet_();
  const found = findEcsRow_(sheet, headerMap, userId, qId);
  const lastDate = todayStr || todayTaipeiStr_();

  if (found.row === -1) {
    const rowObj = {
      user_id: userId,
      q_id: qId,
      strike: 1,
      last_date: lastDate,
    };
    appendRowByHeaders_(sheet, headerMap, rowObj);
    return { ok: true, action: 'insert', strike: 1 };
  }

  const currentStrike = safeNumber_(getCell_(found.values, headerMap, 'strike'), 0);
  const updateObj = {
    strike: currentStrike + 1,
    last_date: lastDate,
  };
  setRowByMap_(sheet, found.row, headerMap, updateObj);
  return { ok: true, action: 'update', strike: updateObj.strike };
}
