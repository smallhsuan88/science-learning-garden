/** questionservice.gs
 * 題庫讀取、篩選、格式化
 */

function ensureQuestionsSheet_() {
  const sh = getSheet_(APP_CONFIG.SHEETS.QUESTIONS, true);
  if (!sh) throw new Error(`找不到題庫工作表：${APP_CONFIG.SHEETS.QUESTIONS}`);
  const headers = [
    'question_id',
    'grade',
    'unit',
    'stem',
    'options',
    'answer_key',
    'explanation',
    'difficulty',
  ];
  const headerMap = ensureHeaders_(sh, headers);
  if (sh.getFrozenRows() < 1) {
    sh.setFrozenRows(1);
  }
  return { sheet: sh, headerMap };
}

function getQuestionsAll_() {
  // ✅ 使用 Cache 避免每次都全表讀取（可選）
  const cache = CacheService.getScriptCache();
  const key = 'questions_all_v2';
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const { sheet: sh, headerMap } = ensureQuestionsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const getByHeader = (row, key) => {
    const col = headerMap[key];
    if (!col) return '';
    return row[col - 1];
  };

  const rows = values.slice(1);
  const list = rows
    .map(r => {
      const qid = String(getByHeader(r, 'question_id') ?? '').trim();
      if (!qid) return null;

      const rawAnswer = String(getByHeader(r, 'answer_key') ?? '').trim();
      const answerNumber = rawAnswer === '' ? NaN : Number(rawAnswer);
      if (!Number.isFinite(answerNumber)) {
        throw new Error(`題目 ${qid} 的 answer_key 無法解析：${rawAnswer}`);
      }

      const optionsRaw = String(getByHeader(r, 'options') ?? '').trim();
      const normalizedOptions = normalizeOptionsString_(optionsRaw);

      return {
        question_id: qid,
        grade: getByHeader(r, 'grade') ?? '',
        unit: String(getByHeader(r, 'unit') ?? '').trim(),
        stem: String(getByHeader(r, 'stem') ?? '').trim(),
        options: normalizedOptions,
        answer_key: rawAnswer,
        answer_key_number: answerNumber,
        explanation: String(getByHeader(r, 'explanation') ?? '').trim(),
        difficulty: String(getByHeader(r, 'difficulty') ?? '').trim(),
      };
    })
    .filter(q => q && q.question_id);

  cache.put(key, JSON.stringify(list), 60); // 60 秒快取（可調）
  return list;
}

function parseGradeFilter_(gradeStr) {
  const s = String(gradeStr || '').trim();
  if (!s) return null;
  // 支援 "1/2/3" "1,2,3" "1 2 3"
  const parts = s.split(/[\/,\s]+/).map(x => x.trim()).filter(Boolean);
  const nums = parts.map(x => Number(x)).filter(n => !Number.isNaN(n));
  return nums.length ? new Set(nums) : null;
}

function matchText_(value, filter) {
  const v = String(value || '').trim();
  const f = String(filter || '').trim();
  if (!f) return true;
  // 支援部分包含
  return v.includes(f);
}

function filterQuestions_(all, { grade, unit, difficulty } = {}) {
  const gradeSet = parseGradeFilter_(grade);
  return all.filter(q => {
    const okGrade = gradeSet ? gradeSet.has(Number(q.grade)) : true;
    const okUnit = unit ? matchText_(q.unit, unit) : true;
    const okDiff = difficulty ? matchText_(q.difficulty, difficulty) : true;
    return okGrade && okUnit && okDiff;
  });
}

function getQuestionsByIds_(idSet) {
  if (!idSet || !idSet.size) return [];
  const all = getQuestionsAll_();
  return all.filter(q => idSet.has(q.question_id));
}

function getQuestionById_(qid) {
  if (!qid) return null;
  const all = getQuestionsAll_();
  return all.find(q => q.question_id === qid) || null;
}

function pickRandom_(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function normalizeOptionsString_(optionsStr) {
  // 將全形逗號轉半形、移除多餘空白，確保 chosenText 位置一致
  const cleaned = String(optionsStr || '').replace(/，/g, ',');
  return cleaned
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .join(',');
}
