/** memoryconfig.gs
 * 全域設定（Spreadsheet、Sheet 名稱、時區、記憶規則）
 */
const APP_CONFIG = {
  // ✅ 你的題庫 Spreadsheet ID（建議用同一個 spreadsheet 管理 Questions/Mastery/Logs）
  // 若 Questions 在另一份 Spreadsheet，也可以改成 QUESTION_SPREADSHEET_ID 與 LOG_SPREADSHEET_ID 分離
  SPREADSHEET_ID: '',

  SHEETS: {
    QUESTIONS: 'Questions',
    MASTERY: 'Mastery',
    LOGS: 'Logs',
  },

  TIMEZONE: 'Asia/Taipei',
  TS_FORMAT: 'yyyy-MM-dd HH:mm:ss',
  DATE_FORMAT: 'yyyy-MM-dd',

  // 出題上限預設
  DEFAULT_LIMIT: 100,

  // ✅ 記憶強度等級 → 下次複習間隔（天）
  LEVEL_TO_DAYS: {
    1: 1,
    2: 3,
    3: 7,
    4: 15,
    5: 30,
  },

  // ✅ 懲罰降級：當 level >= 4 答錯 → 直接降回此等級
  PENALTY_DROP_TO_LEVEL: 1,

  // 其他答錯：level - 1（最低到 1）
  WRONG_DROP_BY: 1,

  // 答錯後至少隔幾天再出現（避免立刻又被抽到）
  WRONG_NEXT_DAYS_MIN: 1,

  // “已精通”判定：Level 5 答對後（仍會安排 30 天後複習，並標記 mastered=true）
  MARK_MASTERED_ON_LEVEL5_CORRECT: true,

  // getQuestions 出題策略：各類型最多取多少比例（可先不用改）
  PICK_RULES: {
    DUE_FIRST: true,
    LOW_LEVEL_MAX_LEVEL: 2,
  },
};

function nowTaipei_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, APP_CONFIG.TS_FORMAT);
}

function todayTaipei_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, APP_CONFIG.DATE_FORMAT);
}

function formatTaipeiTs_(dateObj) {
  return Utilities.formatDate(dateObj || new Date(), APP_CONFIG.TIMEZONE, APP_CONFIG.TS_FORMAT);
}

function parseTaipeiTimestamp_(ts) {
  const m = String(ts || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d, h, mi, se] = m;
  const asUtc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi), Number(se)));
  return asUtc;
}

function addDays_(dateObj, days) {
  const d = new Date(dateObj.getTime());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Script Properties 缺少 SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}
