/** reportService.gs
 * 學習報表：聚合 Logs / ECS / Mastery
 */

function getLearningReport_(userId, days) {
  const uid = String(userId || '').trim();
  if (!uid) {
    throw new Error('user_id required');
  }

  const windowDays = normalizeReportDays_(days);
  const cache = CacheService.getScriptCache();
  const cacheKey = buildLearningReportCacheKey_(uid, windowDays);

  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) { }
    }
  }

  const nowStr = nowTaipeiStr_();
  const report = buildLearningReportData_(uid, windowDays);
  const payload = { ok: true, report, ts_taipei: nowStr };

  try {
    if (cacheKey) cache.put(cacheKey, JSON.stringify(payload), 60);
  } catch (_) { }

  return payload;
}

function buildLearningReportData_(userId, windowDays) {
  const logs = summarizeLogsForReport_(userId, windowDays);
  const weakest = buildWeakestFromEcs_(userId);
  const dueTrend = buildDueTrendFromMastery_(userId, 14);

  return {
    summary: logs.summary,
    by_unit: logs.byUnit,
    by_difficulty: logs.byDifficulty,
    weakest,
    due_trend: dueTrend,
  };
}

function summarizeLogsForReport_(userId, windowDays) {
  const { sheet, headerMap } = ensureLogsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return {
      summary: { attempts: 0, correct: 0, accuracy: 0 },
      byUnit: {},
      byDifficulty: {},
    };
  }

  const getVal = (row, key) => {
    const col = headerMap[key];
    if (!col) return '';
    return row[col - 1];
  };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));

  const summary = { attempts: 0, correct: 0, accuracy: 0 };
  const byUnit = {};
  const byDifficulty = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(getVal(row, 'user_id') || '').trim() !== userId) continue;

    const ts = parseTaipeiTimestamp_(getVal(row, 'ts_taipei') || getVal(row, 'timestamp')) || new Date(getVal(row, 'ts_taipei'));
    if (!(ts instanceof Date) || isNaN(ts.getTime()) || ts < cutoff) continue;

    const isCorrect = String(getVal(row, 'is_correct') || '').toUpperCase() === 'TRUE';
    summary.attempts += 1;
    if (isCorrect) summary.correct += 1;

    const unitKey = String(getVal(row, 'unit') || '').trim() || '未分類';
    const diffKey = String(getVal(row, 'difficulty') || '').trim() || '未標註';

    accumulateReportBucket_(byUnit, unitKey, isCorrect);
    accumulateReportBucket_(byDifficulty, diffKey, isCorrect);
  }

  summary.accuracy = summary.attempts > 0 ? summary.correct / summary.attempts : 0;
  finalizeBucketsAccuracy_(byUnit);
  finalizeBucketsAccuracy_(byDifficulty);

  return { summary, byUnit, byDifficulty };
}

function accumulateReportBucket_(bucketObj, key, isCorrect) {
  if (!bucketObj[key]) {
    bucketObj[key] = { attempts: 0, correct: 0, accuracy: 0 };
  }
  bucketObj[key].attempts += 1;
  if (isCorrect) bucketObj[key].correct += 1;
}

function finalizeBucketsAccuracy_(bucketObj) {
  Object.keys(bucketObj).forEach(k => {
    const bucket = bucketObj[k];
    bucket.accuracy = bucket.attempts > 0 ? bucket.correct / bucket.attempts : 0;
  });
}

function buildWeakestFromEcs_(userId) {
  const { sheet, headerMap } = ecsEnsureEcsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const weakest = [];

  values.forEach(row => {
    if (String(getCell_(row, headerMap, 'user_id') || '').trim() !== userId) return;
    const qid = String(getCell_(row, headerMap, 'q_id') || '').trim();
    if (!qid) return;
    weakest.push({
      q_id: qid,
      wrong_recent_7d: safeNumber_(getCell_(row, headerMap, 'wrong_count_recent_7d'), 0),
      priority_score: safeNumber_(getCell_(row, headerMap, 'priority_score'), 0),
      wrong_total: safeNumber_(getCell_(row, headerMap, 'wrong_count_total'), 0),
      last_wrong_at: String(getCell_(row, headerMap, 'last_wrong_at') || '')
    });
  });

  weakest.sort((a, b) => {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
    if (b.wrong_recent_7d !== a.wrong_recent_7d) return b.wrong_recent_7d - a.wrong_recent_7d;
    if (b.wrong_total !== a.wrong_total) return b.wrong_total - a.wrong_total;
    return String(b.last_wrong_at || '').localeCompare(String(a.last_wrong_at || ''));
  });

  return weakest.map(item => ({
    q_id: item.q_id,
    wrong_recent_7d: item.wrong_recent_7d,
    priority_score: item.priority_score
  }));
}

function buildDueTrendFromMastery_(userId, days) {
  const { sheet, headerMap } = ensureMasterySheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const now = new Date();
  const lookAheadDays = Math.max(1, Number(days || 14));
  const allowedDates = [];
  const allowedSet = new Set();

  for (let i = 0; i < lookAheadDays; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const dateStr = Utilities.formatDate(d, APP_CONFIG.TIMEZONE, APP_CONFIG.DATE_FORMAT);
    allowedDates.push(dateStr);
    allowedSet.add(dateStr);
  }

  const counts = {};
  allowedDates.forEach(ds => { counts[ds] = 0; });

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(getCell_(row, headerMap, 'user_id') || '').trim() !== userId) continue;
    const nextReviewAt = String(getCell_(row, headerMap, 'next_review_at') || '').trim();
    if (!nextReviewAt) continue;
    const ts = parseTaipeiTimestamp_(nextReviewAt);
    if (!ts || isNaN(ts.getTime())) continue;
    const dateStr = Utilities.formatDate(ts, APP_CONFIG.TIMEZONE, APP_CONFIG.DATE_FORMAT);
    if (!allowedSet.has(dateStr)) continue;
    counts[dateStr] = (counts[dateStr] || 0) + 1;
  }

  return allowedDates.map(ds => ({ date: ds, due_count: counts[ds] || 0 }));
}

function normalizeReportDays_(days) {
  const n = Number(days);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(Math.floor(n), 365);
  }
  return 30;
}

function getLearningReportCacheVersion_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('LEARNING_REPORT_CACHE_VER');
  if (!raw) {
    props.setProperty('LEARNING_REPORT_CACHE_VER', '1');
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Invalid LEARNING_REPORT_CACHE_VER');
  }
  return parsed;
}

function buildLearningReportCacheKey_(userId, windowDays) {
  const fallbackKey = `learning_report_fixed_${userId}_${windowDays}`;
  try {
    const ver = getLearningReportCacheVersion_();
    return `learning_report_v${ver}_${userId}_${windowDays}`;
  } catch (_) {
    return fallbackKey;
  }
}

