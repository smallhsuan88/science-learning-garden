/** masteryservice.gs
 * 記憶強度/複習時間表：讀取 Mastery、挑題、更新狀態
 */

function ensureMasterySheet_() {
  const sh = getSheet_(APP_CONFIG.SHEETS.MASTERY, true);

  const headers = [
    'user_id',
    'q_id',
    'correct_count',
    'total_count',
    'last_correct_date',  // yyyy-MM-dd（台北）
    'strength_level',     // 1~5
    'next_review_at',     // 台灣時間字串
    'correct_streak',
    'total_attempts',
    'last_result',        // correct/wrong
    'last_answered_at',   // 台灣時間字串
    'mastered',           // TRUE/FALSE
    'updated_at',         // 台灣時間字串
  ];

  const headerMap = ensureHeaders_(sh, headers);
  if (sh.getFrozenRows() < 1) {
    sh.setFrozenRows(1);
  }

  return { sheet: sh, headerMap };
}

function masteryLoadMap_(userId) {
  const { sheet: sh, headerMap } = ensureMasterySheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { map: new Map(), rowIndexByQid: new Map(), headerMap, sheet: sh };

  const getVal = (row, key) => {
    const col = headerMap[key];
    if (!col) return '';
    return row[col - 1];
  };

  const map = new Map();
  const rowIndexByQid = new Map();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(getVal(row, 'user_id') || '').trim() !== userId) continue;
    const qid = String(getVal(row, 'q_id') || '').trim();
    if (!qid) continue;

    map.set(qid, {
      user_id: userId,
      q_id: qid,
      correct_count: Number(getVal(row, 'correct_count') || 0),
      total_count: Number(getVal(row, 'total_count') || 0),
      strength_level: Number(getVal(row, 'strength_level') || 1),
      next_review_at: String(getVal(row, 'next_review_at') || '').trim(),
      correct_streak: Number(getVal(row, 'correct_streak') || 0),
      total_attempts: Number(getVal(row, 'total_attempts') || 0),
      last_result: String(getVal(row, 'last_result') || '').trim(),
      last_answered_at: String(getVal(row, 'last_answered_at') || '').trim(),
      last_correct_date: String(getVal(row, 'last_correct_date') || '').trim(),
      mastered: String(getVal(row, 'mastered') || '').toUpperCase() === 'TRUE',
    });
    rowIndexByQid.set(qid, r + 1); // sheet row number (1-based)
  }

  return { map, rowIndexByQid, headerMap, sheet: sh };
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
  masteryApplyUpdate_(computed.sheet, computed.headerMap, computed.rowObj, computed.rowIndex);
  return computed.summary;
}

function masteryComputeUpdate_(userId, qObj, chosenAnswer, isCorrect) {
  const { map, rowIndexByQid, headerMap, sheet: sh } = masteryLoadMap_(userId);

  const qid = qObj.question_id;
  const nowTs = nowTaipeiStr_();
  const todayStr = todayTaipeiStr_();

  const prev = map.get(qid) || {
    user_id: userId,
    q_id: qid,
    correct_count: 0,
    total_count: 0,
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
  const totalCount = Number(prev.total_count || 0) + 1;
  const totalAttempts = Number(prev.total_attempts || 0) + 1;
  const isNew = !map.has(qid);

  let strengthAfter = strengthBefore;
  let mastered = !!prev.mastered;
  let correctStreak = Number(prev.correct_streak || 0);
  let lastCorrectDate = String(prev.last_correct_date || '').trim();
  let correctCount = Number(prev.correct_count || 0);

  if (isCorrect) {
    correctCount += 1;
    correctStreak += 1;
    // 新題目第一次答對仍維持 Level 1（符合驗收）；之後再答對才升級
    strengthAfter = isNew ? 1 : Math.min(5, strengthBefore + 1);

    lastCorrectDate = todayStr;

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

  const existingRow = rowIndexByQid.get(qid);
  const rowObj = {
    user_id: userId,
    q_id: qid,
    correct_count: correctCount,
    total_count: totalCount,
    last_correct_date: lastCorrectDate,
    strength_level: strengthAfter,
    next_review_at: nextReviewAt,
    correct_streak: correctStreak,
    total_attempts: totalAttempts,
    last_result: isCorrect ? 'correct' : 'wrong',
    last_answered_at: nowTs,
    mastered: mastered ? 'TRUE' : 'FALSE',
    updated_at: nowTs,
  };

  return {
    sheet: sh,
    headerMap,
    rowObj,
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
      correct_count: correctCount,
      total_count: totalCount,
    }
  };
}

function masteryApplyUpdate_(sheet, headerMap, rowObj, rowIndex) {
  if (rowIndex) {
    setRowByMap_(sheet, rowIndex, headerMap, rowObj);
  } else {
    appendRowByHeaders_(sheet, headerMap, rowObj);
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
  const { map: masteryMap } = masteryLoadMap_(userId);
  const strikeMap = mistakesLoadMap_(userId);
  const want = Math.min(Number(limit || APP_CONFIG.DEFAULT_LIMIT), total);

  // 1) 到期題
  const due = all.filter(q => {
    const m = masteryMap.get(q.question_id);
    return m && isDue_(m.next_review_at, now) && !m.mastered;
  });

  // 2) 低等級（<=2）題（但不一定到期）
  const low = all.filter(q => {
    const m = masteryMap.get(q.question_id);
    return m && !m.mastered && Number(m.strength_level || 1) <= APP_CONFIG.PICK_RULES.LOW_LEVEL_MAX_LEVEL;
  });

  // 3) 新題（從未作答）
  const unseen = all.filter(q => !masteryMap.has(q.question_id));

  // 高 strike 題（僅一般練習）
  const highStrikeCap = Math.floor(want * 0.3);
  const highStrike = (highStrikeCap > 0)
    ? all.filter(q => {
      const strike = strikeMap.get(q.question_id) || 0;
      if (strike < 3) return false;
      const m = masteryMap.get(q.question_id);
      return !m || !m.mastered;
    })
    : [];

  // 4) 其他題（補隨機）
  const others = all.filter(q => true);
  const dueSet = new Set(due.map(q => q.question_id));
  const lowSet = new Set(low.map(q => q.question_id));
  const unseenSet = new Set(unseen.map(q => q.question_id));
  const highStrikeSet = new Set(highStrike.map(q => q.question_id));

  const picked = [];
  let highStrikeUsed = 0;

  function addUnique(list, { enforceHighStrikeCap = true } = {}) {
    for (const q of list) {
      if (picked.length >= want) break;
      const isHighStrike = highStrikeSet.has(q.question_id);
      if (enforceHighStrikeCap && isHighStrike && highStrikeUsed >= highStrikeCap) continue;
      if (!picked.some(x => x.question_id === q.question_id)) {
        picked.push(q);
        if (enforceHighStrikeCap && isHighStrike) highStrikeUsed += 1;
      }
    }
  }

  addUnique(due, { enforceHighStrikeCap: false });
  if (picked.length < want && highStrikeCap > 0) addUnique(highStrike);
  if (picked.length < want) addUnique(low);
  if (picked.length < want) addUnique(unseen);

  if (picked.length < want) {
    const remain = others
      .filter(q => !picked.some(x => x.question_id === q.question_id))
      .filter(q => highStrikeUsed < highStrikeCap || !highStrikeSet.has(q.question_id));
    addUnique(pickRandom_(remain, want - picked.length));
  }

  const fillCount = picked.filter(q => !dueSet.has(q.question_id) && !lowSet.has(q.question_id) && !unseenSet.has(q.question_id) && !highStrikeSet.has(q.question_id)).length;

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
      now_taipei: nowTaipeiStr_(),
    }
  };
}
