// 접수 태블릿의 순수 로직(화면 없음). 브라우저와 검사가 같이 쓴다. 학생 입력값은 저장·기록하지 않는다.
export const IDLE_MS = 45000, RESULT_MS = 7000, REQUEST_TIMEOUT_MS = 10000;

const fullToHalf = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 학번: 공백을 지우고 5자리 숫자여야 한다. 아니면 null. */
export function normalizeStudentNo(value) {
  const s = fullToHalf(value).replace(/\s+/g, '');
  return /^\d{5}$/.test(s) ? s : null;
}
/** 이름: 앞뒤 공백을 지우고 NFC로. 1~40자. 아니면 null. 자동으로 고치지 않는다. */
export function normalizeName(value) {
  const s = String(value ?? '').normalize('NFC').trim();
  return s.length >= 1 && s.length <= 40 ? s : null;
}

const LOCAL = /^(localhost|127\.0\.0\.1)$/;
/** 연결 정보 검사. 주소는 https(개발용 localhost만 http), 공개 키는 비밀이 아니지만 형식 확인, 토큰은 기기 토큰. */
export function validateConfig({ url, key, token }) {
  let u;
  try { u = new URL(String(url ?? '').trim()); } catch { return { ok: false, error: '서버 주소를 확인해 주세요.' }; }
  const local = LOCAL.test(u.hostname);
  if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    return { ok: false, error: '서버 주소는 https://로 시작하는 주소만 쓸 수 있습니다.' };
  }
  const k = String(key ?? '').trim();
  if (!(/^sb_publishable_[A-Za-z0-9_-]+$/.test(k) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k)) || k.length > 4096) return { ok: false, error: '공개 키 형식을 확인해 주세요.' };
  const t = String(token ?? '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(t)) return { ok: false, error: '기기 토큰 형식을 확인해 주세요.' };
  return { ok: true, value: { url: u.origin, key: k, token: t } };
}

/** PostgREST 호출. 새 공개 키(sb_publishable_…)는 JWT가 아니므로 apikey 머리글에만 넣는다. */
export function buildRequest(config, fn, params) {
  const headers = { 'Content-Type': 'application/json', apikey: config.key, 'Content-Profile': 'kiosk', 'Accept-Profile': 'kiosk' };
  if (config.key.startsWith('eyJ')) headers.Authorization = `Bearer ${config.key}`;
  return { url: `${config.url}/rest/v1/rpc/${fn}`, init: { method: 'POST', headers, body: JSON.stringify(params), redirect: 'error', cache: 'no-store', credentials: 'omit' } };
}

async function call(config, fn, params, fetchImpl, timeoutMs) {
  const { url, init } = buildRequest(config, fn, params);
  let response;
  try { response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); } catch { return { kind: 'network' }; }
  if (response.status === 401 || response.status === 403 || response.status === 404) return { kind: 'config' };
  if (!response.ok) return { kind: 'network' };
  try { const body = await response.json(); return body && typeof body === 'object' && !Array.isArray(body) ? { kind: 'body', body } : { kind: 'config' }; } catch { return { kind: 'config' }; }
}

/** 접수. 결과: ok(kind,status) / rejected(학번·이름 확인) / retry(잠시 후) / already(이미 접수) / network / config(기기 설정 문제). */
export async function submitVisit(config, { studentNo, name, kind, requestId }, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  const r = await call(config, 'submit_visit', { p_token: config.token, p_student_no: studentNo, p_name: name, p_kind: kind, p_request_id: requestId }, fetchImpl, timeoutMs);
  if (r.kind !== 'body') return { result: r.kind };
  const b = r.body;
  if (b.ok === true && (b.kind === 'supplies' || b.kind === 'enter')) return { result: 'ok', kind: b.kind, status: b.status };
  if (b.ok === false) return { result: { REJECTED: 'rejected', RETRY: 'retry', ALREADY: 'already' }[b.code] ?? 'rejected' };
  return { result: 'config' };
}

/** 기기 확인. ok면 기기 이름. */
export async function pingDevice(config, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  const r = await call(config, 'ping', { p_token: config.token }, fetchImpl, timeoutMs);
  if (r.kind !== 'body') return { result: r.kind };
  return r.body.ok === true ? { result: 'ok', name: String(r.body.name ?? '') } : { result: 'config' };
}

export const MESSAGES = Object.freeze({
  ok_supplies: ['접수했어요', '물품 접수가 끝났어요. 보건 선생님께 받아 가세요.'],
  ok_enter: ['접수했어요', '보건실로 들어와 주세요. 보건 선생님이 곧 확인해요.'],
  rejected: ['확인해 주세요', '학번과 이름이 맞는지 다시 확인해 주세요.'],
  retry: ['잠시 후에 해 주세요', '입력이 여러 번 틀렸어요. 잠시 뒤에 다시 해 주세요.'],
  already: ['이미 접수되어 있어요', '보건 선생님께 말씀해 주세요.'],
  network: ['연결이 안 돼요', '보건 선생님께 알려 주세요. 잠시 뒤에 다시 해 볼 수 있어요.'],
  config: ['기기 설정이 필요해요', '보건 선생님께 알려 주세요.'],
});
export const messageFor = (r) => MESSAGES[r.result === 'ok' ? `ok_${r.kind}` : r.result] ?? MESSAGES.config;

// ───── 선생님 PIN(학생이 설정을 바꾸지 못하게 하는 장치. 비밀 보관이 아니라 접근 제한) ─────
export const validPin = (p) => /^\d{6,12}$/.test(String(p ?? ''));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPin(pin, iterations = 200000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derive(pin, salt, iterations)), iterations };
}
export async function verifyPin(pin, record) {
  if (!record || !validPin(pin)) return false;
  const got = await derive(pin, unb64(record.salt), record.iterations), want = unb64(record.hash);
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ (want[i] ?? 0);
  return diff === 0;
}
/** 틀린 PIN이 5번 이어지면 30초 잠근다(학생이 PIN을 찍어 보는 것을 늦춘다). */
export function pinAttempt(state, ok, now) {
  if (ok) return { fails: 0, lockedUntil: 0 };
  const fails = (state?.fails ?? 0) + 1;
  return fails >= 5 ? { fails: 0, lockedUntil: now + 30000 } : { fails, lockedUntil: state?.lockedUntil ?? 0 };
}
export const pinLocked = (state, now) => (state?.lockedUntil ?? 0) > now;
