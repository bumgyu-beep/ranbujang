/**
 * 란부장 ↔ 구글 시트 '자체비품' 동기화
 *
 * 처음 한 번:
 *  1) 아래 PROJECT_ID, TEAM_PASSWORD 를 채운다
 *  2) 위 메뉴에서 함수 'setup' 을 선택하고 ▶ 실행 → 권한 허용
 * 비밀번호를 바꿀 때: TEAM_PASSWORD 를 고치고 'changePassword' 실행
 */
const PROJECT_ID = 'ranbujang-28e96';
const TEAM_PASSWORD = '';         // 팀 비밀번호
const SHEET_NAME = '자체비품';
const FIRST_ROW = 8;              // 표의 첫 데이터 줄 (B열 '위치'부터 I열 '비고'까지)

const FS = () => 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
const DOCNAME = p => 'projects/' + PROJECT_ID + '/databases/(default)/documents/' + p;

/* ---------- 처음 설정 ---------- */
function setup() {
  if (!PROJECT_ID || !TEAM_PASSWORD) throw new Error('PROJECT_ID 와 TEAM_PASSWORD 를 먼저 채우세요');
  commit_([{ update: { name: DOCNAME('config/secret'), fields: toFields_({ pw: TEAM_PASSWORD }) } }]);

  const existing = listDocs_('items');
  if (existing.length === 0) {
    const sh = sheet_();
    const rows = readRows_(sh);
    const writes = [];
    const base = {};
    keyed_(rows, r => [r.v[0], r.v[1], r.v[3]]).forEach((r, k) => {
      const it = rowToItem_(r);
      writes.push({ update: { name: DOCNAME('items/' + newId_()), fields: toFields_(it) } });
      base[k] = valsOfRow_(r);
    });
    for (let i = 0; i < writes.length; i += 400) commit_(writes.slice(i, i + 400));
    setState_(base, '처음 연결: 시트에서 ' + rows.length + '개 비품을 가져왔어요');
  }

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('syncNow').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  Logger.log('설정 완료');
}

function changePassword() {
  commit_([{ update: { name: DOCNAME('config/secret'), fields: toFields_({ pw: TEAM_PASSWORD }) } }]);
  Logger.log('비밀번호를 바꿨어요. 이미 들어와 있는 기기는 그대로 쓸 수 있어요.');
}

/* 웹 앱 주소로 호출되면 바로 맞춤 (란부장이 저장 직후 부름) */
function doGet() {
  syncNow();
  return ContentService.createTextOutput('ok');
}

/* ---------- 동기화 ---------- */
function syncNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { sync_(); } finally { lock.releaseLock(); }
}

function sync_() {
  const sh = sheet_();
  const rows = readRows_(sh);
  const items = listDocs_('items').map(d => Object.assign({ id: d.id }, d.data))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)));
  const stateDoc = getDoc_('sync/state');
  const base = (stateDoc && stateDoc.base) || {};

  const sheetMap = keyed_(rows, r => [r.v[0], r.v[1], r.v[3]]);
  const appMap = keyed_(items, i => [i.place, i.zone || '기타', i.name]);
  const keys = new Set([...sheetMap.keys(), ...appMap.keys()]);

  const appWrites = [], sheetSet = [], sheetAdd = [], sheetDel = [], newBase = {};
  let toApp = 0, conflicts = 0;

  keys.forEach(k => {
    const s = sheetMap.get(k), a = appMap.get(k), b = base[k];
    if (s && a) {
      const sv = valsOfRow_(s), av = valsOfItem_(a), fin = {}, patch = {};
      let write = String(s.v[5] || '').trim() !== '';
      ['q', 'm', 'n'].forEach(f => {
        const bf = b ? b[f] : sv[f];
        const sc = sv[f] !== bf, ac = av[f] !== bf;
        fin[f] = ac ? av[f] : sv[f];
        if (sc && ac && sv[f] !== av[f]) conflicts++;
        if (fin[f] !== av[f]) {
          if (f === 'q') { if (/^\d+$/.test(fin.q)) { patch.qty = +fin.q; patch.qtyText = ''; } else { patch.qty = null; patch.qtyText = fin.q; } }
          if (f === 'm') patch.min = fin.m === '' ? null : +fin.m;
          if (f === 'n') patch.note = fin.n;
        }
        if (fin[f] !== sv[f]) write = true;
      });
      if (Object.keys(patch).length) {
        appWrites.push({ update: { name: DOCNAME('items/' + a.id), fields: toFields_(patch) }, updateMask: { fieldPaths: Object.keys(patch) } });
        toApp++;
      }
      if (write) sheetSet.push({ r: s.r, vals: [qtyCell_(a, fin.q), '', fin.m === '' ? '' : Number(fin.m), fin.n] });
      newBase[k] = fin;
    } else if (s) {
      if (b) { sheetDel.push(s.r); }                       // 란부장에서 지운 비품
      else {                                               // 시트에 새로 생긴 비품
        appWrites.push({ update: { name: DOCNAME('items/' + newId_()), fields: toFields_(rowToItem_(s)) } });
        newBase[k] = valsOfRow_(s); toApp++;
      }
    } else if (a) {
      if (b) { appWrites.push({ delete: DOCNAME('items/' + a.id) }); toApp++; }   // 시트에서 지운 줄
      else {                                               // 란부장에서 새로 만든 비품
        const av = valsOfItem_(a);
        sheetAdd.push([a.place, a.zone || '기타', a.sub || a.zone || '', a.name, qtyCell_(a, av.q), '', av.m === '' ? '' : Number(av.m), av.n]);
        newBase[k] = av;
      }
    }
  });

  for (let i = 0; i < appWrites.length; i += 400) commit_(appWrites.slice(i, i + 400));
  sheetSet.forEach(w => sh.getRange(w.r, 6, 1, 4).setValues([w.vals]));
  if (sheetAdd.length) {
    const last = Math.max(sh.getLastRow(), FIRST_ROW - 1);
    const target = sh.getRange(last + 1, 2, sheetAdd.length, 8);
    if (last >= FIRST_ROW) sh.getRange(last, 2, 1, 8).copyTo(target, { formatOnly: true });
    target.setValues(sheetAdd);
  }
  sheetDel.sort((x, y) => y - x).forEach(r => sh.deleteRow(r));

  const toSheet = sheetSet.length + sheetAdd.length + sheetDel.length;
  if (toSheet) {
    const d = new Date();
    sh.getRange('B4').setValue('업데이트일 : ' + Utilities.formatDate(d, 'Asia/Seoul', 'yyyy.MM.dd') + '(' + '일월화수목금토'[d.getDay()] + ')');
  }
  const summary = (toSheet || toApp)
    ? '시트로 ' + toSheet + '건, 란부장으로 ' + toApp + '건 반영' + (conflicts ? ' · 양쪽이 다르게 고친 ' + conflicts + '건은 란부장 값으로' : '')
    : '바뀐 것 없음';
  setState_(newBase, summary);
}

/* ---------- 시트 읽기·변환 ---------- */
function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("'" + SHEET_NAME + "' 시트를 찾을 수 없어요");
  return sh;
}
function readRows_(sh) {
  const last = sh.getLastRow();
  if (last < FIRST_ROW) return [];
  return sh.getRange(FIRST_ROW, 2, last - FIRST_ROW + 1, 8).getDisplayValues()
    .map((v, i) => ({ r: FIRST_ROW + i, v: v.map(x => String(x).trim()) }))
    .filter(x => x.v[0] && x.v[3]);
}
function canonQ_(s) { s = String(s == null ? '' : s).trim(); const m = s.match(/^(\d+)\s*(개|통|롤|ea)?$/); return m ? m[1] : s; }
function canonM_(v) { const s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s : ''; }
function valsOfRow_(r) { return { q: canonQ_(r.v[5] || r.v[4]), m: canonM_(r.v[6]), n: r.v[7] || '' }; }
function valsOfItem_(i) { return { q: typeof i.qty === 'number' ? String(i.qty) : (i.qtyText || ''), m: i.min == null ? '' : String(i.min), n: String(i.note || '').trim() }; }
function qtyCell_(i, q) { return /^\d+$/.test(q) ? (i && i.unit ? q + i.unit : Number(q)) : q; }
function rowToItem_(r) {
  const raw = r.v[5] || r.v[4], q = canonQ_(raw), m = canonM_(r.v[6]);
  const unit = (String(raw).match(/^\d+\s*(통|롤|개)$/) || [])[1] || '';
  const it = { place: r.v[0], zone: r.v[1] || '기타', sub: r.v[2] && r.v[2] !== r.v[1] ? r.v[2] : '', name: r.v[3],
    qty: /^\d+$/.test(q) ? +q : null, qtyText: /^\d+$/.test(q) ? '' : q, min: m === '' ? null : +m, note: r.v[7] || '', order: r.r };
  if (unit) it.unit = unit;
  return it;
}
function keyed_(list, get) {
  const occ = {}, out = new Map();
  list.forEach(x => { const k0 = get(x).join('|'); const n = occ[k0] || 0; occ[k0] = n + 1; out.set(k0 + '|' + n, x); });
  return out;
}
function setState_(base, summary) {
  commit_([{ update: { name: DOCNAME('sync/state'), fields: toFields_({ base: base, at: new Date().toISOString(), summary: summary }) } }]);
}
function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 20); }

/* ---------- Firestore REST ---------- */
function req_(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT_ID },
    payload: body ? JSON.stringify(body) : undefined
  });
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}
function commit_(writes) { if (writes.length) req_('post', FS() + ':commit', { writes: writes }); }
function getDoc_(path) { const d = req_('get', FS() + '/' + path); return d ? fromFields_(d.fields || {}) : null; }
function listDocs_(col) {
  const out = []; let token = '';
  do {
    const d = req_('get', FS() + '/' + col + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    ((d && d.documents) || []).forEach(x => out.push({ id: x.name.split('/').pop(), data: fromFields_(x.fields || {}) }));
    token = d && d.nextPageToken;
  } while (token);
  return out;
}
function toVal_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toVal_) } };
  return { mapValue: { fields: toFields_(v) } };
}
function toFields_(o) { const f = {}; Object.keys(o).forEach(k => { f[k] = toVal_(o[k]); }); return f; }
function fromVal_(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromVal_);
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  return null;
}
function fromFields_(f) { const o = {}; Object.keys(f).forEach(k => { o[k] = fromVal_(f[k]); }); return o; }
