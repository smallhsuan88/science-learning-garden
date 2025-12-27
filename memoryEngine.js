/* memoryEngine.js
 * - 管理前端 session 進度
 * - 載入題目/作答/自動下一題
 * - 完成/重新開始（含 resetUser 的後端 API 入口預留）
 */

class MemoryEngine {
  constructor({ api, ui, storageKey }) {
    this.api = api;
    this.ui = ui;
    this.storageKey = storageKey || 'slg_v1';

    this.state = {
      user_id: 'u001',
      filters: {},
      questions: [],
      index: 0,
      done: 0,
      correct: 0,
      mode: 'standard', // standard | ecs
      ecsMeta: null,
      finished: false,
      lastSessionSummary: null,
      lastDebug: {},
    };
  }

  init() {
    this.ui.bindDom();

    // init label
    this.ui.setApiLabel(this.api.getActiveBase());
    this.ui.setApiStatus('尚未連線');

    // restore local
    this._restoreLocalSession();

    this.ui.on('onPing', () => this.ping());
    this.ui.on('onLoad', (ignoreFilter) => this.loadQuestions(ignoreFilter));
    this.ui.on('onLoadEcsQueue', () => this.loadEcsQueue());
    this.ui.on('onGetStable', () => this.getStableEntry());
    this.ui.on('onClearCache', () => this.clearLocal());
    this.ui.on('onFinish', () => this.finishSession());
    this.ui.on('onRestart', () => this.restartAll());

    this.ui.on('onSubmit', () => this.submitCurrent());
    this.ui.on('onNext', () => this.nextQuestion());
    this.ui.on('onSubmitHotkey', () => this.submitCurrent());
    this.ui.on('onNextHotkey', () => this.nextQuestion());

    this._renderAll();
  }

  _restoreLocalSession() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);

      // 只回復「上一個完成摘要」，避免把題目 queue 固死（因為真正出題要以後端記憶邏輯為主）
      this.state.lastSessionSummary = saved.lastSessionSummary || null;
      this.state.finished = !!saved.finished;
    } catch {}
  }

  _saveLocalSession() {
    const payload = {
      finished: this.state.finished,
      lastSessionSummary: this.state.lastSessionSummary,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(payload));
  }

  _renderAll() {
    const total = this.state.questions.length;
    this.ui.setProgress({ total, done: this.state.done, correct: this.state.correct });
    this.ui.setMode({
      mode: this.state.mode,
      ecsMeta: this.state.ecsMeta,
    });

    const sess = this.state.finished
      ? `已完成（上次：${this.state.lastSessionSummary?.done || 0} 題）`
      : (total ? '進行中' : '未開始');
    this.ui.setSessionLabel(sess);

    if (!total) {
      const hint = this.state.finished
        ? '你已完成上一輪。可再次載入題目，系統會以到期/未做為主。'
        : '尚未開始。請先 Ping 或載入題目。';
      this.ui.renderEmptyQuizHint(hint);
      this.ui.renderList([], null);
      return;
    }

    // render list + current question
    this.ui.renderList(this.state.questions, (qid) => {
      const idx = this.state.questions.findIndex(q => q.question_id === qid);
      if (idx >= 0) {
        this.state.index = idx;
        this._renderCurrent();
      }
    });

    this._renderCurrent();
  }

  _renderCurrent() {
    const q = this.state.questions[this.state.index];
    this.ui.renderQuestion(q, this.state);
    this._debug({ current: q, index: this.state.index, total: this.state.questions.length });
  }

  _debug(obj) {
    this.state.lastDebug = obj || {};
    this.ui.renderDebug(this.state.lastDebug);
  }

  async ping() {
    try {
      this.ui.setApiStatus('連線中...', 'warn');
      const { json, url } = await this.api.ping();
      this.ui.setApiLabel(this.api.getActiveBase());
      this.ui.setApiStatus(`API OK：pong（${json.ts_taipei || json.ts || ''}）`, 'ok');
      this._debug({ action: 'ping', url, response: json });
    } catch (e) {
      const msg = this._fmtError(e);
      this.ui.setApiStatus(`無法連線（${msg}）`, 'bad');
      this._debug({ action: 'ping', error: String(msg) });
    }
  }

  async getStableEntry() {
    // 這個功能：如果你未來有 googleusercontent 的 stable 入口（echo?user_content_key=...）
    // 你可以在這裡用 ping 成功後回傳的資訊去更新（需你後端額外提供 stableBase）
    // 目前先做成：清掉 local base，回到 primary，再 ping 一次
    this.api.clearSavedBase();
    this.ui.setApiLabel(this.api.getActiveBase());
    await this.ping();
  }

  async loadQuestions(ignoreFilter) {
    const filters = this.ui.getFilters();
    this.state.user_id = filters.user_id;
    this.state.filters = filters;

    const params = {
      action: 'getQuestions',
      user_id: filters.user_id,
      limit: 100,
    };

    if (!ignoreFilter) {
      params.grade = filters.grade;
      params.unit = filters.unit;
      params.difficulty = filters.difficulty;
    } else {
      // 忽略篩選 → 不帶任何條件
    }

    try {
      this.ui.setApiStatus('載入題目中...', 'warn');
      const { json, url } = await this.api.get(params);

      const list = Array.isArray(json.data) ? json.data : [];
      this.state.questions = list;
      this.state.index = 0;
      this.state.done = 0;
      this.state.correct = 0;
      this.state.mode = 'standard';
      this.state.ecsMeta = null;
      this.state.finished = false;

      this.ui.setApiLabel(this.api.getActiveBase());
      this.ui.setApiStatus(`載入成功：後端回傳 ${json.count ?? list.length} 題，前端顯示 ${list.length} 題`, 'ok');
      this._debug({ action: 'getQuestions', url, responseMeta: json.meta || null, parsedCount: list.length });

      this._renderAll();
      this._saveLocalSession();

    } catch (e) {
      const msg = this._fmtError(e);
      this.ui.setApiStatus(`載入失敗（${msg}）`, 'bad');
      this._debug({ action: 'getQuestions', error: String(msg), params, detail: e });
    }
  }

  async loadEcsQueue() {
    const filters = this.ui.getFilters();
    this.state.user_id = filters.user_id;
    this.state.filters = filters;

    const params = {
      action: 'getEcsQueue',
      user_id: filters.user_id,
      limit: 30,
    };

    try {
      this.ui.setApiStatus('載入錯題複習中...', 'warn');
      const { json, url } = await this.api.get(params);

      const list = Array.isArray(json.data) ? json.data : [];
      this.state.questions = list;
      this.state.index = 0;
      this.state.done = 0;
      this.state.correct = 0;
      this.state.mode = 'ecs';
      this.state.ecsMeta = json.meta || null;
      this.state.finished = false;

      const remain = json.meta && json.meta.total_active !== undefined ? json.meta.total_active : list.length;
      this.ui.setApiLabel(this.api.getActiveBase());
      this.ui.setApiStatus(`載入錯題成功：剩餘錯題 ${remain} 題，顯示 ${list.length} 題`, 'ok');
      this._debug({ action: 'getEcsQueue', url, responseMeta: json.meta || null, parsedCount: list.length });

      this._renderAll();
      this._saveLocalSession();

    } catch (e) {
      const msg = this._fmtError(e);
      this.ui.setApiStatus(`載入錯題失敗（${msg}）`, 'bad');
      this._debug({ action: 'getEcsQueue', error: String(msg), params, detail: e });
    }
  }

  async submitCurrent() {
    const q = this.state.questions[this.state.index];
    if (!q) return;

    const chosen = this.ui.readChosenAnswer();
    if (chosen === null || Number.isNaN(chosen)) {
      this.ui.showResult({ ok:false, msg:'請先選擇一個答案' });
      return;
    }

    try {
      // 呼叫後端 submitAnswer
      const params = {
        action: 'submitAnswer',
        user_id: this.state.user_id,
        q_id: q.question_id,
        chosen_index: chosen,
      };

      const { json, url } = await this.api.get(params);

      const isCorrect = !!json.is_correct;
      this.state.done += 1;
      if (isCorrect) this.state.correct += 1;

      this.ui.showResult({
        ok: true,
        is_correct: isCorrect,
        explanation: json.explanation || q.explanation || '',
        recorded: !!json.recorded,
        need_remedial: !!json.need_remedial,
        ecs_status: json.ecs_status || 'none',
        ecs_streak: json.ecs_streak,
      });

      this._debug({ action: 'submitAnswer', url, request: params, response: json });

      // 更新進度條
      this.ui.setProgress({
        total: this.state.questions.length,
        done: this.state.done,
        correct: this.state.correct
      });

      // ✅ 作答後自動下一題（僅答對時）；答錯需使用者自行點「換一題」
      if (isCorrect) {
        setTimeout(() => {
          this.nextQuestion();
        }, 350);
      }

    } catch (e) {
      const msg = this._fmtError(e);
      this.ui.showResult({ ok:false, msg });
      this._debug({ action: 'submitAnswer', error: String(msg), detail: e });
      this.ui.setApiStatus(`送出失敗（${msg}）`, 'bad');
    }
  }

  nextQuestion() {
    const total = this.state.questions.length;
    if (!total) return;

    // 若已到最後一題 → 自動完成
    if (this.state.index >= total - 1) {
      this.finishSession(true);
      return;
    }

    this.state.index += 1;
    this._renderCurrent();
    this._saveLocalSession();
  }

  finishSession(auto = false) {
    const total = this.state.questions.length;

    // 沒題也能完成（只記錄狀態）
    const summary = {
      user_id: this.state.user_id,
      total,
      done: this.state.done,
      correct: this.state.correct,
      acc: this.state.done ? Math.round((this.state.correct / Math.max(1, this.state.done)) * 100) : 0,
      finishedAt: new Date().toISOString(),
      autoFinished: !!auto,
    };

    this.state.finished = true;
    this.state.lastSessionSummary = summary;
    this._saveLocalSession();

    // 清空 queue（避免使用者誤以為下一次仍沿用同一批題）
    this.state.questions = [];
    this.state.index = 0;

    this.ui.setApiStatus(`本次完成：${summary.done} 題 / 正確 ${summary.correct} 題（${summary.acc}%）`, 'ok');
    this._debug({ action: 'finish', summary });

    this._renderAll();
  }

  async restartAll() {
    // 你的需求是「重新開始：不以上次紀錄為主，直接重新作所有題庫」
    // ✅ 正確做法：後端需要提供 resetUser（清 Mastery / Logs 或至少清 Mastery）
    // 這裡先「嘗試」呼叫；若後端沒有做，就降級成清本機紀錄並提示

    const user_id = (this.ui.getFilters().user_id || this.state.user_id || 'u001').trim();
    try {
      this.ui.setApiStatus('重新開始：嘗試清除後端記憶中...', 'warn');

      // ⚠️ 你後端若尚未加 action=resetUser，這裡會失敗 → 會 fallback 提示
      const { json, url } = await this.api.post('resetUser', { user_id });

      this._debug({ action: 'resetUser', url, response: json });
      this.ui.setApiStatus('已清除後端記憶：可重新載入題庫', 'ok');

    } catch (e) {
      // 降級：只清前端 local
      this.ui.setApiStatus(`後端尚未提供 resetUser（已改為只清本機快取）`, 'warn');
      this._debug({ action: 'resetUser', error: String(e.message || e) });
    }

    this.clearLocal();
    // 清空目前狀態
    this.state.questions = [];
    this.state.index = 0;
    this.state.done = 0;
    this.state.correct = 0;
    this.state.finished = false;
    this.state.lastSessionSummary = null;
    this._renderAll();
  }

  clearLocal() {
    localStorage.removeItem(this.storageKey);
    this.ui.setApiStatus('已清除本機快取', 'ok');
    this._debug({ action: 'clearLocal' });
  }

  _fmtError(e) {
    if (!e || typeof e !== 'object') return String(e);
    const base = e.message || e.toString();
    if (!e.type) return base;
    if (e.type === 'network') return `network: ${base}`;
    if (e.type === 'http') return `http ${e.status || ''}: ${base} ${e.body ? `body=${e.body}` : ''}`;
    if (e.type === 'json') return `json parse: ${e.body || base}`;
    return `${e.type}: ${base}`;
  }
}
