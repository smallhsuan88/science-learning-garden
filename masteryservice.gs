/** masteryservice.gs
 * 記憶強度/複習時間表：讀取 Mastery、挑題、更新狀態
 */

function ensureMasterySheet_() {
  const sh = getSheet_(APP_CONFIG.SHEETS.MASTERY, true);

  const headers = [
    'user_id',
    'q_id',
    'strength_level',     // 1~5
    'next_review_at',     // 台灣時間字串
    'correct_streak',
    'total_attempts',
    'last_result',        // correct/wrong
    'last_answered_at',   // 台灣時間字串
    'last_correct_date',  // yyyy-MM-dd（台北）
    'mastered',           // TRUE/FALSE
    'updated_at',         // 台灣時間字串
  ];

  const lastCol = sh.getLastColumn();
  const firstRow = sh.getRange(1, 1, 1, Math.max(lastCol, headers.length)).getValues()[0];
  const isEmpty = sh.getLastRow() === 0 || firstRow.every(v => v === '');
  if (isEmpty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    // 自動補齊缺少的欄位（不破壞原有資料）
    const existing = firstRow.map(h => String(h || '').trim());
    const missing = headers.filter(h => !existing.includes(h));
    if (missing.length) {
      const newHeaders = existing.slice();
      missing.forEach(h => newHeaders.push(h));
      sh.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
    }
  }

  return sh;
}

function masteryLoadMap_(userId) {
  const sh = ensureMasterySheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { map: new Map(), rowIndexByQid: new Map() };

  const headers = values[0].map(h => String(h || '').trim());
  const idx = (name) => headers.indexOf(name);

  const i_user = idx('user_id');
  const i_q = idx('q_id');
  const i_lvl = idx('strength_level');
  const i_next = idx('next_review_at');
  const i_streak = idx('correct_streak');
  const i_total = idx('total_attempts');
  const i_last = idx('last_result');
  const i_lastAt = idx('last_answered_at');
  const i_lastCorrect = idx('last_correct_date');
  const i_mastered = idx('mastered');

  const map = new Map();
  const rowIndexByQid = new Map();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(row[i_user] || '').trim() !== userId) continue;
    const qid = String(row[i_q] || '').trim();
    if (!qid) continue;

    map.set(qid, {
      user_id: userId,
      q_id: qid,
      strength_level: Number(row[i_lvl] || 1),
      next_review_at: String(row[i_next] || '').trim(),
      correct_streak: Number(row[i_streak] || 0),
      total_attempts: Number(row[i_total] || 0),
      last_result: String(row[i_last] || '').trim(),
      last_answered_at: String(row[i_lastAt] || '').trim(),
      last_correct_date: String(row[i_lastCorrect] || '').trim(),
      mastered: String(row[i_mastered] || '').toUpperCase() === 'TRUE',
    });
    rowIndexByQid.set(qid, r + 1); // sheet row number (1-based)
  }

  return { map, rowIndexByQid };
}

function isDue_(nextReviewAt, nowDate) {
  if (!nextReviewAt) return false;
  const d = parseTaipeiTimestamp_(nextReviewAt);
  if (!d) return false;
  return d.getTime() <= nowDate.getTime();
}

function masteryPickQuestions_(userId, filters, limit) {
  const all = filterQuestions_(getQuestionsAll_(), filters);
  return masteryPickQuestionsFromList_(userId, all, limit, new Date());
}

function masteryUpdateAfterAnswer_(userId, qObj, chosenAnswer, isCorrect) {
  const computed = masteryComputeUpdate_(userId, qObj, chosenAnswer, isCorrect);
  masteryApplyUpdate_(computed.sheet, computed.rowValues, computed.rowIndex);
  return computed.summary;
}

function masteryComputeUpdate_(userId, qObj, chosenAnswer, isCorrect) {
  const sh = ensureMasterySheet_();
  const { map, rowIndexByQid } = masteryLoadMap_(userId);

  const qid = qObj.question_id;
  const nowTs = nowTaipeiStr_();

  const prev = map.get(qid) || {
    user_id: userId,
    q_id: qid,
    strength_level: 1,
    next_review_at: '',
    correct_streak: 0,
    total_attempts: 0,
    last_result: '',
    last_answered_at: '',
    last_correct_date: '',
    mastered: false,
  };

  const strengthBefore = Number(prev.strength_level || 1);
  const totalAttempts = Number(prev.total_attempts || 0) + 1;
  const isNew = !map.has(qid);

  let strengthAfter = strengthBefore;
  let mastered = !!prev.mastered;
  let correctStreak = Number(prev.correct_streak || 0);
  let lastCorrectDate = String(prev.last_correct_date || '').trim();

  if (isCorrect) {
    correctStreak += 1;
    // 新題目第一次答對仍維持 Level 1（符合驗收）；之後再答對才升級
    strengthAfter = isNew ? 1 : Math.min(5, strengthBefore + 1);

    lastCorrectDate = todayTaipei_();

    if (strengthAfter === 5 && APP_CONFIG.MARK_MASTERED_ON_LEVEL5_CORRECT) {
      mastered = true;
    }
  } else {
    correctStreak = 0;
    if (strengthBefore >= 4) {
      strengthAfter = APP_CONFIG.PENALTY_DROP_TO_LEVEL;
    } else {
      strengthAfter = Math.max(1, strengthBefore - APP_CONFIG.WRONG_DROP_BY);
    }
    mastered = false; // 答錯就先取消 mastered（保守）
  }

  const days = APP_CONFIG.LEVEL_TO_DAYS[String(strengthAfter)] || 1;
  const nextDate = addDays_(new Date(), isCorrect ? days : Math.max(days, APP_CONFIG.WRONG_NEXT_DAYS_MIN));
  const nextReviewAt = formatTaipeiTs_(nextDate);

  const rowValues = [
    userId,
    qid,
    strengthAfter,
    nextReviewAt,
    correctStreak,
    totalAttempts,
    isCorrect ? 'correct' : 'wrong',
    nowTs,
    lastCorrectDate,
    mastered ? 'TRUE' : 'FALSE',
    nowTs,
  ];

  const existingRow = rowIndexByQid.get(qid);

  return {
    sheet: sh,
    rowValues,
    rowIndex: existingRow,
    summary: {
      strength_before: strengthBefore,
      strength_after: strengthAfter,
      next_review_at: nextReviewAt,
      mastered: mastered,
      last_answered_at: nowTs,
      last_correct_date: lastCorrectDate,
      last_result: isCorrect ? 'correct' : 'wrong',
      total_attempts: totalAttempts,
      correct_streak: correctStreak,
    }
  };
}

function masteryApplyUpdate_(sheet, rowValues, rowIndex) {
  if (rowIndex) {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

function getUserMasteryMap(userId) {
  return masteryLoadMap_(userId).map;
}

function updateAfterAnswer(userId, qObj, chosenAnswer, isCorrect) {
  return masteryUpdateAfterAnswer_(userId, qObj, chosenAnswer, isCorrect);
}

function pickQuestionsByMemory(userId, questions, now, limit) {
  const list = Array.isArray(questions) ? questions : getQuestionsAll_();
  return masteryPickQuestionsFromList_(userId, list, limit, now || new Date());
}

function masteryPickQuestionsFromList_(userId, questionList, limit, nowDate) {
  const all = Array.isArray(questionList) ? questionList : [];
  const total = all.length;
  const now = nowDate || new Date();
  const { map } = masteryLoadMap_(userId);

  // 1) 到期題
  const due = all.filter(q => {
    const m = map.get(q.question_id);
    return m && isDue_(m.next_review_at, now) && !m.mastered;
  });

  // 2) 低等級（<=2）題（但不一定到期）
  const low = all.filter(q => {
    const m = map.get(q.question_id);
    return m && !m.mastered && Number(m.strength_level || 1) <= APP_CONFIG.PICK_RULES.LOW_LEVEL_MAX_LEVEL;
  });

  // 3) 新題（從未作答）
  const unseen = all.filter(q => !map.has(q.question_id));

  // 4) 其他題（補隨機）
  const others = all.filter(q => true);
  const dueSet = new Set(due.map(q => q.question_id));
  const lowSet = new Set(low.map(q => q.question_id));
  const unseenSet = new Set(unseen.map(q => q.question_id));

  const picked = [];
  const want = Math.min(Number(limit || APP_CONFIG.DEFAULT_LIMIT), total);

  function addUnique(list) {
    for (const q of list) {
      if (picked.length >= want) break;
      if (!picked.some(x => x.question_id === q.question_id)) picked.push(q);
    }
  }

  addUnique(due);
  if (picked.length < want) addUnique(low);
  if (picked.length < want) addUnique(unseen);

  if (picked.length < want) {
    const remain = others.filter(q => !picked.some(x => x.question_id === q.question_id));
    addUnique(pickRandom_(remain, want - picked.length));
  }

  const fillCount = picked.filter(q => !dueSet.has(q.question_id) && !lowSet.has(q.question_id) && !unseenSet.has(q.question_id)).length;

  return {
    ok: true,
    count: total,
    data: picked,
    meta: {
      picked: picked.length,
      due: due.length,
      weak: low.length,
      new: unseen.length,
      fill: fillCount,
      totalFiltered: total,
      now_taipei: nowTaipei_(),
    }
  };
}
