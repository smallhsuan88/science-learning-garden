/** authService.gs
 * - 驗證前端傳入的 api_key（Script Properties: API_KEY）
 * - 提供 router 使用的 requireAuth_ / isProtectedAction_
 */

const AUTH_PROTECTED_ACTIONS = [
  'submitAnswer',
  'resetUser',
  'getQuestions',
  'getEcsQueue',
  'getLearningReport',
];

const AUTH_ERROR_PAYLOAD = { ok: false, error_code: 'UNAUTHORIZED', message: 'invalid api_key' };

function isProtectedAction_(action) {
  return AUTH_PROTECTED_ACTIONS.indexOf(String(action || '').trim()) >= 0;
}

function requireAuth_(params) {
  const expected = getApiKeyFromProps_();
  if (!expected) {
    return { ok: false, payload: AUTH_ERROR_PAYLOAD };
  }

  const given = (params && params.api_key) ? String(params.api_key).trim() : '';
  if (!given || given !== expected) {
    return { ok: false, payload: AUTH_ERROR_PAYLOAD };
  }

  return { ok: true };
}

function getApiKeyFromProps_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('API_KEY') || '';
}
