/** resetService.gs
 * - resetUser：清除 Mastery / ECS / Mistakes，保留 Logs（可選擇清 ECS_EVENTS）
 */

function resetUserData_(userId, options) {
  const user_id = String(userId || '').trim();
  if (!user_id) throw new Error('user_id required');

  const opts = options || {};
  const purgeEvents = !!opts.purgeEvents;

  const result = {
    ok: true,
    user_id,
    deleted: {
      mastery: 0,
      ecs: 0,
      mistakes: 0,
      ecs_events: 0,
    },
    purge_events: purgeEvents,
  };

  // Mastery
  const { sheet: masterySheet, headerMap: masteryHeader } = ensureMasterySheet_();
  result.deleted.mastery = deleteRowsByUser_(masterySheet, masteryHeader, 'user_id', user_id);

  // ECS
  const ecsSheet = getSheet_(ECS_SHEET_NAME, true);
  const ecsHeader = ensureHeaders_(ecsSheet, [
    'user_id','q_id','wrong_count_total','wrong_count_recent_7d','last_wrong_at',
    'last_wrong_choice','last_wrong_option_text','status',
    'graduation_correct_days_streak','graduation_last_correct_date',
    'variant_correct_count','updated_at','knowledge_tag','remedial_card_text',
    'remedial_asset_url','importance_weight','priority_score'
  ]);
  result.deleted.ecs = deleteRowsByUser_(ecsSheet, ecsHeader, 'user_id', user_id);

  // Mistakes
  const { sheet: mistakesSheet, headerMap: mistakesHeader } = ensureMistakesSheet_();
  result.deleted.mistakes = deleteRowsByUser_(mistakesSheet, mistakesHeader, 'user_id', user_id);

  // ECS_EVENTS（可選）
  if (purgeEvents) {
    const ecsEventsSheet = getSheet_(ECS_EVENTS_SHEET_NAME, true);
    const ecsEventsHeader = ensureHeaders_(ecsEventsSheet, ['user_id', 'q_id', 'event_type', 'payload_json', 'timestamp']);
    result.deleted.ecs_events = deleteRowsByUser_(ecsEventsSheet, ecsEventsHeader, 'user_id', user_id);
  }

  return result;
}

function deleteRowsByUser_(sheet, headerMap, userKey, userId) {
  if (!sheet || !headerMap) return 0;
  const userCol = headerMap[userKey];
  if (!userCol) return 0;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  let deleted = 0;

  for (let i = values.length - 1; i >= 0; i--) {
    const rowVals = values[i];
    if (String(rowVals[userCol - 1] || '').trim() === userId) {
      sheet.deleteRow(i + 2); // +2 because values starts from row 2
      deleted += 1;
    }
  }

  return deleted;
}
