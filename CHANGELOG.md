# Changelog

## v0.1.0 - 2025-12-20
### Added
- Apps Script Web App（doGet）提供前端入口
- getAppData：讀取 UserData / Questions / Plants 並回傳給前端
- logAnswer：寫入 Logs 作答紀錄（若不存在自動建立分頁與標題列）
- saveProgress：同步回寫 UserData（資源/連勝/最後登入）與 Plants（成長值/階段）
- 前端答題流程：隨機 5 題、顯示解析、回到花園
- 花園資源操作：澆水/日照/施肥推進植物成長與階段
- 進度頁：顯示 streak 與 growth_points

### Fixed
- Spreadsheet 指定 ID 存取（避免獨立專案抓不到 ActiveSpreadsheet）
- Date 物件序列化：將日期轉為字串避免 JSON 回傳崩潰
- resources 欄位路徑相容：支援前端 resources 或平鋪欄位（water/sunlight/fertilizer）
- 權限/授權錯誤提示更清晰（getSpreadsheet_）

### Known Issues
- 單一使用者假設 user_001
- 單一植物使用 plants[0]
- options 欄位格式需逗號分隔，否則前端無法正確顯示
