/** validateService.gs
 * 題庫健檢：不應中斷既有 API，僅回傳 issues
 */

function validateQuestions_(limit, refresh) {
  const cache = CacheService.getScriptCache();
  const limitNum = Number(limit || 200);
  const limitKey = Number.isFinite(limitNum) && limitNum > 0 ? String(limitNum) : 'all';
  const cacheKey = `validateQuestions_${limitKey}`;
  const refreshFlag = String(refresh || '').toLowerCase() === '1' || String(refresh || '').toLowerCase() === 'true';

  if (!refreshFlag) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) {}
    }
  }

  const result = {
    ok: true,
    ts_taipei: nowTaipeiStr_(),
    count: 0,
    invalid_rows: [],
    duplicates: [],
  };

  try {
    const { sheet, headerMap } = ensureQuestionsSheet_();
    const values = sheet.getDataRange().getValues();
    result.count = Math.max(0, values.length - 1);

    const rows = values.slice(1);
    const maxRows = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, rows.length) : rows.length;
    const qidRowsMap = new Map();

    for (let i = 0; i < maxRows; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +1 for header, +1 for 1-based index
      const raw = extractQuestionRowRaw_(row, headerMap);
      const issues = [];

      const qid = String(raw.question_id || '').trim();
      if (!qid) {
        issues.push('question_id is empty');
      } else {
        const existing = qidRowsMap.get(qid) || [];
        existing.push(rowNumber);
        qidRowsMap.set(qid, existing);
      }

      const answerRaw = String(raw.answer_key || '').trim();
      const answerNumber = answerRaw === '' ? NaN : Number(answerRaw);
      if (answerRaw === '') {
        issues.push('answer_key is empty');
      } else if (!Number.isInteger(answerNumber)) {
        issues.push(`answer_key must be integer: ${answerRaw}`);
      }

      const optionsCheck = normalizeOptionsForValidation_(raw.options);
      if (optionsCheck.normalized.length < 2) {
        issues.push('options must contain at least 2 items after normalize');
      }
      if (optionsCheck.hasEmpty) {
        issues.push('options contain empty value');
      }

      if (Number.isInteger(answerNumber)) {
        if (optionsCheck.normalized.length === 0) {
          issues.push('answer_key range cannot be checked because options are empty');
        } else if (answerNumber < 0 || answerNumber >= optionsCheck.normalized.length) {
          issues.push(`answer_key out of range (0..${optionsCheck.normalized.length - 1})`);
        }
      }

      if (issues.length) {
        result.invalid_rows.push({
          row: rowNumber,
          question_id: qid,
          issues,
          raw,
        });
      }
    }

    qidRowsMap.forEach((rowsList, qid) => {
      if (rowsList.length > 1) {
        result.duplicates.push({ question_id: qid, rows: rowsList });
      }
    });
  } catch (err) {
    result.error_message = String(err && err.message ? err.message : err);
  }

  try { cache.put(cacheKey, JSON.stringify(result), 60); } catch (_) {}
  return result;
}

function extractQuestionRowRaw_(row, headerMap) {
  const getVal = (key) => {
    const col = headerMap[key];
    if (!col) return '';
    return row[col - 1];
  };

  return {
    question_id: String(getVal('question_id') ?? '').trim(),
    grade: getVal('grade') ?? '',
    unit: String(getVal('unit') ?? '').trim(),
    stem: String(getVal('stem') ?? '').trim(),
    options: getVal('options') ?? '',
    answer_key: getVal('answer_key') ?? '',
    explanation: getVal('explanation') ?? '',
    difficulty: String(getVal('difficulty') ?? '').trim(),
  };
}

function normalizeOptionsForValidation_(optionsRaw) {
  const cleaned = String(optionsRaw || '').replace(/，/g, ',');
  const parts = cleaned.split(',');
  const trimmed = parts.map(p => p.trim());
  const normalized = trimmed.filter(Boolean);
  const hasEmpty = trimmed.some(p => p === '');
  return {
    normalized,
    hasEmpty,
  };
}
