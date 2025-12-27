/** ecsRecalcService.gs
 * 提供回填 / 回推工具（可做為回滾方案）
 * - ecsRecalcRecent7dForUser：依事件重新計算 recent_7d 與 priority_score
 */

function ecsRecalcRecent7dForUser(userId, options) {
  const user_id = String(userId || '').trim();
  if (!user_id) throw new Error('user_id required');

  const nowStr = (options && options.nowTaipeiStr) || nowTaipeiStr_();
  const nowDate = parseTaipeiTimestamp_(nowStr) || new Date();
  const { sheet: sh, headerMap } = ecsEnsureEcsSheet_();

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return {
      ok: true,
      user_id,
      updated_rows: 0,
      now_taipei: nowStr,
      meta: {
        recent_window_days: ECS_RECENT_WINDOW_DAYS,
        events_scan_days: ECS_EVENTS_SCAN_DAYS,
        events_scan_cap: ECS_EVENTS_SCAN_CAP
      }
    };
  }

  const recentMap = ecsCalcRecent7dMap_(user_id, nowDate);
  const values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  const uCol = headerMap['user_id'];

  let updated = 0;
  values.forEach((rowVals, idx) => {
    if (String(rowVals[uCol - 1]) !== user_id) return;
    const rowNum = idx + 2;
    const qId = String(getCell_(rowVals, headerMap, 'q_id'));
    const recentCount = recentMap.get(qId) || 0;
    const total = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_total'), 0);
    const importance = safeNumber_(getCell_(rowVals, headerMap, 'importance_weight'), 1);
    const priority = ecsComputePriorityScore_({
      wrong_count_recent_7d: recentCount,
      wrong_count_total: total,
      importance_weight: importance
    });
    const storedRecent = safeNumber_(getCell_(rowVals, headerMap, 'wrong_count_recent_7d'), 0);
    const storedPriority = safeNumber_(getCell_(rowVals, headerMap, 'priority_score'), 0);
    if (storedRecent === recentCount && storedPriority === priority) return;
    setRowByMap_(sh, rowNum, headerMap, {
      wrong_count_recent_7d: recentCount,
      priority_score: priority
    });
    updated += 1;
  });

  return {
    ok: true,
    user_id,
    updated_rows: updated,
    now_taipei: nowStr,
    meta: {
      recent_window_days: ECS_RECENT_WINDOW_DAYS,
      events_scan_days: ECS_EVENTS_SCAN_DAYS,
      events_scan_cap: ECS_EVENTS_SCAN_CAP
    }
  };
}
