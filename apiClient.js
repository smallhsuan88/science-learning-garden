/* apiClient.js
 * - 統一處理 GET/POST
 * - timeout、fallback、簡易 debug
 */

const API_CLIENT_API_KEY = 'REPLACE_WITH_API_KEY';

class ApiClient {
  constructor(opts = {}) {
    this.primaryBase = opts.primaryBase || '';
    this.stableBase = opts.stableBase || ''; // 若你有 googleusercontent 的穩定入口，可放這
    this.timeoutMs = Number(opts.timeoutMs || 8000);
    this.debug = !!opts.debug;
    this.apiKey = opts.apiKey || API_CLIENT_API_KEY || '';

    // 用 localStorage 記住穩定入口（避免每次重貼）
    this.storageKey = 'slg_api_base_v1';
    this.activeBase = localStorage.getItem(this.storageKey) || this.stableBase || this.primaryBase;
    if (!this.activeBase) this.activeBase = this.primaryBase;
  }

  setActiveBase(url) {
    if (url && typeof url === 'string') {
      this.activeBase = url.trim();
      localStorage.setItem(this.storageKey, this.activeBase);
    }
  }

  getActiveBase() {
    return this.activeBase || this.primaryBase;
  }

  clearSavedBase() {
    localStorage.removeItem(this.storageKey);
    this.activeBase = this.stableBase || this.primaryBase;
  }

  _log(...args) { if (this.debug) console.log('[ApiClient]', ...args); }

  _withTimeout(promise) {
    const ms = this.timeoutMs;
    let timer;
    const t = new Promise((_, rej) => {
      timer = setTimeout(() => rej(this._makeErr('network', 'timeout', { error_code: 'NETWORK_TIMEOUT' })), ms);
    });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
  }

  _buildUrl(base, params = {}) {
    const u = new URL(base);
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || String(v).trim() === '') return;
      u.searchParams.set(k, String(v));
    });
    // bust cache
    u.searchParams.set('_', String(Date.now()));
    return u.toString();
  }

  async ping() {
    return this.get({ action: 'ping' });
  }

  async get(params) {
    return this._requestWithFallback('GET', params, null);
  }

  async post(action, bodyObj = {}, extraParams = {}) {
    const params = { action, ...extraParams };
    return this._requestWithFallback('POST', params, bodyObj);
  }

  async _requestOnce(method, base, params, bodyObj) {
    const url = this._buildUrl(base, params);

    const init = {
      method,
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
      },
    };

    if (method === 'POST') {
      // 避免 preflight：使用 x-www-form-urlencoded
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const search = new URLSearchParams();
      Object.entries(bodyObj || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        search.set(k, v);
      });
      init.body = search.toString();
    }

    this._log('request', method, url, bodyObj || '');

    let res;
    try {
      res = await this._withTimeout(fetch(url, init));
    } catch (e) {
      if (e && e.error_code === 'NETWORK_TIMEOUT') {
        throw e;
      }
      throw this._makeErr('network', `Network error / fetch failed: ${e.message || e}`, { url, error_code: 'NETWORK_FAILED' });
    }

    let text = '';
    try {
      text = await res.text();
    } catch (e) {
      throw this._makeErr('network', `Network read failed: ${e.message || e}`, { url });
    }

    if (!res.ok) {
      throw this._makeErr('http', `HTTP ${res.status} ${res.statusText || ''}`.trim(), {
        status: res.status,
        statusText: res.statusText,
        body: text.slice(0, 200),
        url,
        error_code: 'NETWORK_FAILED',
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw this._makeErr('json', 'JSON parse error', { url, body: text.slice(0, 200), error_code: 'BACKEND_OK_FALSE' });
    }

    if (!json || json.ok === false) {
      const msg = json && (json.message || json.error) ? (json.message || json.error) : 'api error';
      throw this._makeErr('backend', msg, {
        url,
        body: text.slice(0, 200),
        backend: json,
        error_code: (json && json.error_code) ? json.error_code : 'BACKEND_OK_FALSE'
      });
    }

    return { json, url, raw: text };
  }

  async _requestWithFallback(method, params, bodyObj) {
    const paramsWithAuth = Object.assign({}, params || {});
    if (this.apiKey) paramsWithAuth.api_key = this.apiKey;

    const bases = [];
    const active = this.getActiveBase();
    if (active) bases.push(active);

    // fallback：primaryBase（避免 active 是空/壞）
    if (this.primaryBase && !bases.includes(this.primaryBase)) bases.push(this.primaryBase);

    // fallback：stableBase（若有）
    if (this.stableBase && !bases.includes(this.stableBase)) bases.push(this.stableBase);

    let lastErr = null;
    for (const b of bases) {
      try {
        const result = await this._requestOnce(method, b, paramsWithAuth, bodyObj);
        // 成功就把它設為 active（穩定入口優先）
        this.setActiveBase(b);
        return result;
      } catch (e) {
        lastErr = e;
        this._log('fallback failed base=', b, 'err=', String(e.message || e));
      }
    }
    if (lastErr) throw lastErr;
    throw this._makeErr('network', 'no base available', { error_code: 'NETWORK_FAILED' });
  }

  _makeErr(type, message, extra = {}) {
    const err = new Error(message);
    err.type = type;
    Object.assign(err, extra);
    if (!err.error_code) {
      if (type === 'network') err.error_code = 'NETWORK_FAILED';
      else if (type === 'backend') err.error_code = 'BACKEND_OK_FALSE';
    }
    return err;
  }
}
