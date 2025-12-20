/**
 * 自然科學習花園 - 後端核心 (2025 穩定強化版)
 * 修正點：日期序列化字串化、資源欄位路徑修復、權限報錯優化
 */

/** ★請務必確認 ID 正確，且目前帳號有存取權限 */
const SPREADSHEET_ID = '1vYlmGr_tSj3MKAbnRtnOSDgBv_j8cAbDkATtW4ammaM';

/** Web App 入口 */
function doGet() {
  try {
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('自然科學習花園')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  } catch (e) {
    return HtmlService.createHtmlOutput('系統載入失敗：' + e.toString());
  }
}

/** 取得試算表：強化權限檢查 */
function getSpreadsheet_() {
  const id = (SPREADSHEET_ID || '').trim();
  try {
    if (id && id !== '請貼上你的SpreadsheetID') {
      return SpreadsheetApp.openById(id);
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('找不到試算表：請確認 ID 是否正確或腳本是否已綁定。');
    return ss;
  } catch (e) {
    throw new Error('試算表存取失敗。請確認 SPREADSHEET_ID 是否正確，並在 GAS 編輯器中點擊「執行」以通過授權。原文：' + e.message);
  }
}

/** 核心：讀取資料 */
function getAppData() {
  try {
    const ss = getSpreadsheet_();
    const requiredSheets = ['UserData', 'Questions', 'Plants'];
    const sheets = {};
    requiredSheets.forEach(n => (sheets[n] = ss.getSheetByName(n)));

    // 檢查分頁是否存在
    const missing = requiredSheets.filter(n => !sheets[n]);
    if (missing.length) {
      return { status: 'error', message: '試算表缺少分頁：' + missing.join(', ') };
    }

    const rawUser = objectify_(sheets.UserData.getDataRange().getValues());
    const rawQuestions = objectify_(sheets.Questions.getDataRange().getValues());
    const rawPlants = objectify_(sheets.Plants.getDataRange().getValues());

    if (rawQuestions.length === 0) {
      return { status: 'error', message: '題庫 (Questions) 是空的，請至少加入一題。' };
    }

    // 資料定位邏輯
    const userObj = rawUser.find(u => String(u.user_id) === 'user_001') || rawUser[0] || {};
    const plantObj = rawPlants.find(p => String(p.user_id) === userObj.user_id) || rawPlants[0] || {};

    return {
      status: 'success',
      user: {
        ...userObj,
        water: Number(userObj.water || 0),
        sunlight: Number(userObj.sunlight || 0),
        fertilizer: Number(userObj.fertilizer || 0),
        streak: Number(userObj.streak || 0)
      },
      questions: rawQuestions,
      plants: [{
        ...plantObj,
        growth_points: Number(plantObj.growth_points || 0),
        stage: String(plantObj.stage || 'sprout')
      }],
      message: '連線成功'
    };
  } catch (e) {
    return {
      status: 'error',
      message: '讀取資料失敗：' + e.message,
      debug: e.stack ? e.stack.split('\n')[0] : ''
    };
  }
}

/** 紀錄答題 */
function logAnswer(log) {
  try {
    const ss = getSpreadsheet_();
    let sheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['timestamp', 'user_id', 'q_id', 'is_correct', 'chosen_answer']);
    }
    sheet.appendRow([new Date(), log.user_id, log.q_id, log.is_correct, log.chosen_answer]);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

/** 儲存進度 */
function saveProgress(payload) {
  try {
    const ss = getSpreadsheet_();
    const u = payload.user || {};
    const p = payload.plant || {};

    // 更新 UserData
    const userSheet = ss.getSheetByName('UserData');
    const userRow = findRowById_(userSheet, u.user_id || 'user_001', 1);
    if (userRow > 0) {
      // 支援前端 resources 物件或平鋪結構
      const water = Number(u.resources?.water ?? u.water ?? 0);
      const sunlight = Number(u.resources?.sunlight ?? u.sunlight ?? 0);
      const fertilizer = Number(u.resources?.fertilizer ?? u.fertilizer ?? 0);
      const streak = Number(u.streak ?? 0);
      const lastActive = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
      
      userSheet.getRange(userRow, 3, 1, 5).setValues([[water, sunlight, fertilizer, streak, lastActive]]);
    }

    // 更新 Plants
    const plantSheet = ss.getSheetByName('Plants');
    const plantRow = findRowById_(plantSheet, p.plant_id || 'p1', 1);
    if (plantRow > 0) {
      plantSheet.getRange(plantRow, 4, 1, 2).setValues([[Number(p.growth_points || 0), String(p.stage || 'sprout')]]);
    }

    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

/** 輔助：尋找 ID 所在列 */
function findRowById_(sheet, id, colIdx) {
  const vals = sheet.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][colIdx - 1]) === String(id)) return i + 1;
  }
  return -1;
}

/** 輔助：陣列轉物件（含日期轉字串與數值防呆） */
function objectify_(data) {
  if (!data || data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  const numFields = new Set(['water', 'sunlight', 'fertilizer', 'streak', 'growth_points', 'answer_key', 'grade']);

  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      
      // 處理日期物件：轉為字串避免序列化失敗
      if (val instanceof Date) {
        val = Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
      }

      if (h === 'options') {
        obj[h] = val ? String(val).split(',').map(s => s.trim()).filter(Boolean) : [];
      } else if (numFields.has(h)) {
        obj[h] = (val === '' || isNaN(val)) ? 0 : Number(val);
      } else {
        obj[h] = (val === null || val === undefined) ? '' : val;
      }
    });
    return obj;
  });
}