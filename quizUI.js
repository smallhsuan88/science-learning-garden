/* quizUI.js
 * - 純 UI：渲染、讀取使用者輸入、綁定事件
 * - 不碰 API / 記憶邏輯（交給 memoryEngine.js）
 */

class QuizUI {
  constructor() {
    this.el = {};
    this.handlers = {};
  }

  bindDom() {
    const $ = (id) => document.getElementById(id);
    this.el.userId = $('userId');
    this.el.grade = $('grade');
    this.el.unit = $('unit');
    this.el.difficulty = $('difficulty');

    this.el.btnPing = $('btnPing');
    this.el.btnLoad = $('btnLoad');
    this.el.btnLoadAll = $('btnLoadAll');

    this.el.btnStable = $('btnStable');
    this.el.btnClearCache = $('btnClearCache');
    this.el.btnFinish = $('btnFinish');
    this.el.btnRestart = $('btnRestart');

    this.el.apiLabel = $('apiLabel');
    this.el.apiStatus = $('apiStatus');
    this.el.statusLine = $('statusLine');
    this.el.sessionLabel = $('sessionLabel');

    this.el.totalCount = $('totalCount');
    this.el.doneCount = $('doneCount');
    this.el.correctCount = $('correctCount');
    this.el.accRate = $('accRate');
    this.el.progBar = $('progBar');

    this.el.quizArea = $('quizArea');
    this.el.listArea = $('listArea');
    this.el.listCount = $('listCount');

    this.el.debugText = $('debugText');
    this.el.debugBox = $('debugBox');

    // buttons
    this.el.btnPing.addEventListener('click', () => this.handlers.onPing?.());
    this.el.btnLoad.addEventListener('click', () => this.handlers.onLoad?.(false));
    this.el.btnLoadAll.addEventListener('click', () => this.handlers.onLoad?.(true));
    this.el.btnStable.addEventListener('click', () => this.handlers.onGetStable?.());
    this.el.btnClearCache.addEventListener('click', () => this.handlers.onClearCache?.());
    this.el.btnFinish.addEventListener('click', () => this.handlers.onFinish?.());
    this.el.btnRestart.addEventListener('click', () => this.handlers.onRestart?.());

    // hotkeys
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.handlers.onSubmitHotkey?.();
      if (ev.key.toLowerCase() === 'n') this.handlers.onNextHotkey?.();
    });
  }

  on(evt, fn) { this.handlers[evt] = fn; }

  getFilters() {
    return {
      user_id: (this.el.userId.value || 'u001').trim(),
      grade: (this.el.grade.value || '').trim(),
      unit: (this.el.unit.value || '').trim(),
      difficulty: (this.el.difficulty.value || '').trim(),
    };
  }

  setApiLabel(text) { this.el.apiLabel.textContent = text || ''; }
  setApiStatus(text, kind = '') {
    this.el.apiStatus.textContent = text || '';
    this.el.apiStatus.className = kind ? kind : '';
  }

  setSessionLabel(text) { this.el.sessionLabel.textContent = text || ''; }

  setProgress({ total = 0, done = 0, correct = 0 } = {}) {
    this.el.totalCount.textContent = String(total);
    this.el.doneCount.textContent = String(done);
    this.el.correctCount.textContent = String(correct);
    const acc = total ? Math.round((correct / Math.max(1, done)) * 100) : 0;
    this.el.accRate.textContent = `${isFinite(acc) ? acc : 0}%`;

    const pct = total ? Math.round((done / Math.max(1, total)) * 100) : 0;
    this.el.progBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  renderDebug(objOrText) {
    const text = typeof objOrText === 'string' ? objOrText : JSON.stringify(objOrText, null, 2);
    this.el.debugText.textContent = text;
  }

  renderEmptyQuizHint(msg) {
    this.el.quizArea.innerHTML = `<p class="meta">${msg || '尚未開始。'}</p>`;
  }

  renderQuestion(q, state = {}) {
    if (!q) {
      this.renderEmptyQuizHint('沒有題目可顯示。');
      return;
    }

    const options = String(q.options || '').split(',').map(s => s.trim()).filter(Boolean);
    const qid = q.question_id;

    const html = `
      <div>
        <div class="meta">年級 ${q.grade} ｜ ${escapeHtml_(q.unit)} ｜ ${escapeHtml_(q.difficulty || '')}</div>
        <h2 class="qTitle">${escapeHtml_(q.stem || '')}</h2>

        <form id="answerForm">
          ${options.map((opt, idx) => `
            <label class="opt">
              <input type="radio" name="opt" value="${idx}" ${idx === 0 ? '' : ''} />
              <div>${escapeHtml_(opt)}</div>
            </label>
          `).join('')}

          <div class="actions">
            <button type="button" class="btn primary" id="btnSubmit">送出</button>
            <button type="button" class="btn" id="btnNext">換一題</button>
          </div>

          <div id="resultArea" style="margin-top:10px;"></div>

          <details id="expBox" style="display:none;">
            <summary>解析</summary>
            <div class="explain" id="expText"></div>
          </details>
        </form>
      </div>
    `;

    this.el.quizArea.innerHTML = html;

    const btnSubmit = document.getElementById('btnSubmit');
    const btnNext = document.getElementById('btnNext');

    btnSubmit.addEventListener('click', () => this.handlers.onSubmit?.(qid));
    btnNext.addEventListener('click', () => this.handlers.onNext?.());

    // expose read selected answer
    this.el._readChosen = () => {
      const checked = this.el.quizArea.querySelector('input[name="opt"]:checked');
      if (!checked) return null;
      return Number(checked.value);
    };
  }

  showResult({ ok, is_correct, explanation, recorded, need_remedial, msg } = {}) {
    const area = document.getElementById('resultArea');
    const expBox = document.getElementById('expBox');
    const expText = document.getElementById('expText');

    if (!area) return;

    if (!ok) {
      area.innerHTML = `<div class="meta"><span class="bad">送出失敗：</span> ${escapeHtml_(msg || 'Failed')}</div>`;
      if (expBox) expBox.style.display = 'none';
      return;
    }

    const icon = is_correct ? '✅' : '❌';
    const txt = is_correct ? '答對了！' : '答錯了！';
    const cls = is_correct ? 'ok' : 'bad';
    const rec = recorded ? '已記錄' : '未記錄';

    const remedial = need_remedial
      ? `<div class="meta"><span class="warn">此題觸發降級／懲罰復習：</span>建議立刻讀解析並做一次主動回憶。</div>`
      : '';

    area.innerHTML = `
      <div class="meta"><span class="${cls}">${icon} ${txt}</span></div>
      <div class="meta">${escapeHtml_(rec)}</div>
      ${remedial}
    `;

    if (expBox && expText) {
      expBox.style.display = '';
      expText.textContent = explanation || '';
      // 答錯就自動展開解析；答對維持收合
      expBox.open = !is_correct;
    }
  }

  renderList(questions, onPick) {
    const list = Array.isArray(questions) ? questions : [];
    this.el.listCount.textContent = String(list.length);

    if (!list.length) {
      this.el.listArea.innerHTML = `<div class="meta">目前沒有符合條件的題目</div>`;
      return;
    }

    this.el.listArea.innerHTML = list.map((q, idx) => `
      <div class="item">
        <div class="itemTop">
          <div>
            <div style="font-size:18px; font-weight:700;">${escapeHtml_(q.stem || '')}</div>
            <div class="meta">年級 ${q.grade} ｜ ${escapeHtml_(q.unit)} ｜ ${escapeHtml_(q.difficulty || '')}</div>
          </div>
          <div class="right">
            <span class="tag">#${idx + 1}</span>
            <button class="btn small" data-qid="${escapeHtml_(q.question_id)}">作答</button>
          </div>
        </div>
      </div>
    `).join('');

    this.el.listArea.querySelectorAll('button[data-qid]').forEach(btn => {
      btn.addEventListener('click', () => onPick?.(btn.getAttribute('data-qid')));
    });
  }

  readChosenAnswer() {
    if (!this.el._readChosen) return null;
    return this.el._readChosen();
  }
}

function escapeHtml_(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
