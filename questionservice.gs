/** questionservice.gs
 * 題庫讀取、篩選、格式化
 */

function ensureQuestionsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(APP_CONFIG.SHEETS.QUESTIONS);
  if (!sh) throw new Error(`找不到題庫工作表：${APP_CONFIG.SHEETS.QUESTIONS}`);
  return sh;
}

function getQuestionsAll_() {
  // ✅ 使用 Cache 避免每次都全表讀取（可選）
  const cache = CacheService.getScriptCache();
  const key = 'questions_all_v1';
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const sh = ensureQuestionsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h || '').trim());
  const idx = (name) => headers.indexOf(name);

  const i_qid = idx('question_id');
  const i_grade = idx('grade');
  const i_unit = idx('unit');
  const i_stem = idx('stem');
  const i_options = idx('options');
  const i_answer = idx('answer_key');
  const i_exp = idx('explanation');
  const i_diff = idx('difficulty');

  if (i_qid < 0) throw new Error('題庫缺少 question_id 欄位');

  const rows = values.slice(1);
  const list = rows
    .map(r => ({
      question_id: String(r[i_qid] ?? '').trim(),
      grade: r[i_grade] ?? '',
      unit: String(r[i_unit] ?? '').trim(),
      stem: String(r[i_stem] ?? '').trim(),
      options: String(r[i_options] ?? '').trim(), // 前端會 split
      answer_key: (r[i_answer] === '' || r[i_answer] === null || r[i_answer] === undefined) ? '' : Number(r[i_answer]),
      explanation: String(r[i_exp] ?? '').trim(),
      difficulty: String(r[i_diff] ?? '').trim(),
    }))
    .filter(q => q.question_id);

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
