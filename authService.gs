/** authService.gs
 * - 驗證前端傳入的 api_key（Script Properties: API_KEY）
 * - 提供 router 使用的 requireAuth_ / isProtectedAction_
 */

const AUTH_WHITELIST_ACTIONS = [
  'ping',
  'validateQuestions',
];
const AUTH_HEADER_KEY = 'x-api-key';

const AUTH_ERROR_PAYLOAD = { ok: false, error_code: 'UNAUTHORIZED', message: 'invalid api_key' };

function isProtectedAction_(action) {
  const name = String(action || '').trim();
  if (!name) return false;
  return AUTH_WHITELIST_ACTIONS.indexOf(name) < 0;
}

function requireAuth_(params, e) {
  const expected = getApiKeyFromProps_();
  if (!expected) {
    return { ok: false, payload: AUTH_ERROR_PAYLOAD };
  }

  const queryApiKey = getApiKeyFromQuery_(e);
  const payloadApiKey = getApiKeyFromPayload_(e);
  const headerApiKey = getApiKeyFromHeader_(e);

  const given = [queryApiKey, payloadApiKey, headerApiKey].find(k => (k || '').trim() !== '');
  const normalized = given ? String(given).trim() : '';

  if (!normalized || normalized !== expected) {
    return { ok: false, payload: AUTH_ERROR_PAYLOAD };
  }

  return { ok: true };
}

function getApiKeyFromProps_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('API_KEY') || '';
}

function getApiKeyFromQuery_(e) {
  if (!e || !e.parameter) return '';
  return String(e.parameter.api_key || '').trim();
}

function getApiKeyFromPayload_(e) {
  if (!e || !e.postData || !e.postData.type) return '';
  const ctype = String(e.postData.type || '').toLowerCase();
  if (!ctype.includes('application/json')) return '';
  try {
    const obj = JSON.parse(e.postData.contents || '{}');
    if (!obj || typeof obj !== 'object') return '';
    return String(obj.api_key || '').trim();
  } catch (_) {
    return '';
  }
}

function getApiKeyFromHeader_(e) {
  if (!e || !e.headers) return '';
  const key = AUTH_HEADER_KEY;
  const headers = e.headers;
  if (key in headers) return String(headers[key] || '').trim();
  const upperKey = key.toUpperCase();
  if (upperKey in headers) return String(headers[upperKey] || '').trim();
  return '';
}
