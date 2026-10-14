// 접수 태블릿 화면. 학생이 입력한 학번·이름은 이 화면의 입력 칸에만 있고 어디에도 저장·기록하지 않는다(처음 화면으로 돌아가면 지운다).
// 저장하는 것은 기기 설정(서버 주소·공개 키·기기 토큰)과 선생님 PIN의 해시뿐이다.
import { IDLE_MS, RESULT_MS, normalizeStudentNo, normalizeName, validateConfig, submitVisit, pingDevice, messageFor, validPin, hashPin, verifyPin, pinAttempt, pinLocked } from './logic.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 저장소를 못 쓰면 무시 */ } },
};
// 검사용: 같은 컴퓨터(localhost)에서만 대기 시간을 줄일 수 있다.
const q = new URLSearchParams(location.search), local = ['localhost', '127.0.0.1'].includes(location.hostname);
const idleMs = local && Number(q.get('idle')) > 0 ? Number(q.get('idle')) : IDLE_MS;
const resultMs = local && Number(q.get('result')) > 0 ? Number(q.get('result')) : RESULT_MS;

let config = store.get('kiosk.config'), pinRecord = store.get('kiosk.pin'), pinState = { fails: 0, lockedUntil: 0 };
let kind = null, requestId = null, busy = false, idleTimer = null, resultTimer = null, logoTaps = [], current = null;

const SCREENS = ['welcome', 'form', 'result', 'pin', 'setup'];
function show(name) {
  current = name;
  for (const s of SCREENS) $(`s-${s}`).hidden = s !== name;
  clearTimeout(resultTimer); resultTimer = null;
  armIdle();
}
function armIdle() {
  clearTimeout(idleTimer); idleTimer = null;
  if (current === 'form' || current === 'pin') idleTimer = setTimeout(goHome, idleMs);   // 설정 화면은 자동으로 닫지 않는다
}
function clearInputs() { for (const id of ['in-no', 'in-name', 'in-pin', 'su-url', 'su-key', 'su-token', 'su-pin', 'su-pin2']) $(id).value = ''; for (const id of ['f-msg', 'pin-msg', 'su-msg']) $(id).textContent = ''; }
function goHome() {
  kind = null; requestId = null; busy = false; clearInputs();
  $('s-result').classList.remove('ok');
  show(config && pinRecord ? 'welcome' : 'setup'); if (!config || !pinRecord) openSetup(true);
}

// ── 접수 ──
function startForm(k) {
  kind = k; requestId = crypto.randomUUID(); clearInputs();
  $('f-title').textContent = k === 'supplies' ? '물품만 받아 가요' : '보건실에 들어가요';
  show('form'); $('in-no').focus();
}
$('k-supplies').onclick = () => startForm('supplies');
$('k-enter').onclick = () => startForm('enter');
$('f-back').onclick = goHome;
$('r-back').onclick = goHome;
for (const id of ['in-no', 'in-name']) $(id).addEventListener('input', () => { armIdle(); $('f-msg').textContent = ''; });
$('in-no').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('in-name').focus(); } });
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const studentNo = normalizeStudentNo($('in-no').value), name = normalizeName($('in-name').value);
  if (!studentNo) { $('f-msg').textContent = '학번 5자리를 숫자로 입력해 주세요.'; $('in-no').focus(); return; }
  if (!name) { $('f-msg').textContent = '이름을 입력해 주세요.'; $('in-name').focus(); return; }
  busy = true; $('f-send').disabled = true; $('f-msg').textContent = '접수하고 있어요…';
  const r = await submitVisit(config, { studentNo, name, kind, requestId });
  busy = false; $('f-send').disabled = false;
  if (current !== 'form') return;                       // 그 사이 처음 화면으로 돌아갔다면 결과를 보여 주지 않는다
  if (r.result === 'rejected') { $('f-msg').textContent = messageFor(r)[1]; return; }          // 같은 화면에서 고쳐 다시 시도
  if (r.result === 'network') { $('f-msg').textContent = messageFor(r)[0] + ' — ' + messageFor(r)[1]; return; }   // 같은 접수 번호로 다시 시도(중복 방지)
  const [title, text] = messageFor(r);
  clearInputs(); requestId = null;
  $('r-title').textContent = title; $('r-text').textContent = text;
  $('s-result').classList.toggle('ok', r.result === 'ok');
  show('result'); resultTimer = setTimeout(goHome, resultMs);
});

// ── 선생님 설정 ──
$('logo').addEventListener('click', () => {
  const now = Date.now(); logoTaps = [...logoTaps.filter((t) => now - t < 4000), now];
  if (logoTaps.length >= 5) { logoTaps = []; askPin(); }
});
function askPin() {
  if (!pinRecord) { openSetup(true); return; }
  clearInputs(); show('pin'); $('in-pin').focus();
}
$('pin-cancel').onclick = goHome;
$('in-pin').addEventListener('input', armIdle);
$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const now = Date.now();
  if (pinLocked(pinState, now)) { $('pin-msg').textContent = '잠시 뒤에 다시 입력해 주세요.'; return; }
  const ok = await verifyPin($('in-pin').value, pinRecord);
  pinState = pinAttempt(pinState, ok, Date.now());
  if (!ok) { $('pin-msg').textContent = pinLocked(pinState, Date.now()) ? '여러 번 틀렸어요. 30초 뒤에 다시 해 주세요.' : '번호가 맞지 않아요.'; $('in-pin').value = ''; return; }
  openSetup(false);
});
function openSetup(first) {
  clearInputs(); show('setup');
  $('su-title').textContent = first ? '기기 설정(처음 한 번)' : '기기 설정';
  $('su-close').hidden = first; $('su-clear').hidden = first;
  if (config) { $('su-url').value = config.url; $('su-key').value = config.key; }
  $('su-token-hint').textContent = config ? '(바꿀 때만 입력)' : '';
  $('su-pin-hint').textContent = pinRecord ? '(바꿀 때만 입력)' : '';
  $('su-url').focus();
}
$('su-close').onclick = goHome;
$('su-clear').onclick = () => { if (!confirm('이 기기의 설정을 모두 지울까요?')) return; store.del('kiosk.config'); store.del('kiosk.pin'); config = null; pinRecord = null; goHome(); refreshNet(); };
$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = (t) => { $('su-msg').textContent = t; };
  const next = validateConfig({ url: $('su-url').value, key: $('su-key').value, token: $('su-token').value || config?.token });
  if (!next.ok) return msg(next.error);
  const pin = $('su-pin').value;
  if (pin || !pinRecord) {
    if (!validPin(pin)) return msg('선생님 번호는 숫자 6~12자리로 정해 주세요.');
    if (pin !== $('su-pin2').value) return msg('선생님 번호가 서로 달라요.');
  }
  msg('연결을 확인하고 있어요…');
  const ping = await pingDevice(next.value);
  if (ping.result !== 'ok') return msg(ping.result === 'network' ? '서버에 연결할 수 없어요. 주소와 인터넷을 확인해 주세요.' : '이 토큰은 사용할 수 없어요. 보건 담당 화면에서 새 기기 토큰을 만들어 주세요.');
  if (pin) { pinRecord = await hashPin(pin); if (!store.set('kiosk.pin', pinRecord)) return msg('이 기기에 설정을 저장할 수 없어요.'); }
  if (!store.set('kiosk.config', next.value)) return msg('이 기기에 설정을 저장할 수 없어요.');
  config = next.value; goHome(); refreshNet();
});

// ── 연결 표시, 화면 켜 두기, 잠금 보조 ──
async function refreshNet() {
  const el = $('net');
  if (!config) { el.className = 'net'; el.textContent = '설정 필요'; return; }
  const r = await pingDevice(config);
  el.className = 'net ' + (r.result === 'ok' ? 'on' : 'off'); el.textContent = r.result === 'ok' ? '연결됨' : '연결 안 됨';
}
setInterval(refreshNet, 60000);
let wake = null;
async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* 지원하지 않으면 안드로이드 설정에서 화면 꺼짐을 끈다 */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); refreshNet(); } });
document.addEventListener('contextmenu', (e) => e.preventDefault());
// 주소 표시줄 숨기기: 홈 화면에 설치한 앱(https)은 매니페스트의 fullscreen으로 열리고, 그렇지 않은 일반 크롬 탭(시험용 http 등)에서는 화면을 한 번 누르면 전체 화면으로 바꾼다.
// 전체 화면은 사용자가 누른 직후에만 허용되므로 첫 터치(와 전체 화면이 풀린 뒤의 다음 터치)에 요청한다.
const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
function goFullscreen() {
  if (installed || document.fullscreenElement || !document.fullscreenEnabled) return;
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}
document.addEventListener('pointerup', goFullscreen, { passive: true });
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, armIdle, { passive: true });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) navigator.serviceWorker.register('sw.js').catch(() => {});

keepAwake(); goHome(); refreshNet();
