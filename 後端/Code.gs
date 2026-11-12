// ══════════════════════════════════════════════════════
// 小棒槌 缺失改善系統 後端（Google Apps Script 網頁應用程式）
// 資料：Google 試算表「缺失改善系統資料庫」（帳號、建案、廠商、缺失）
// 照片：雲端硬碟「缺失改善系統\照片」資料夾
// 第一次使用：在 Apps Script 編輯器執行「初始化」並授權。
// ══════════════════════════════════════════════════════

const CHUNK = 40000;          // 一格最多 5 萬字，JSON 切成 4 萬字一格
const TOKEN_DAYS = 30;        // 登入有效天數
const ROLES = { admin: '後台', staff: '工地人員' };
const CATS = ['結構體', '室內裝修', '室外裝修'];
const STATUS = { wait: '待改善', doing: '改善中', check: '待複查', done: '已結案' };
const D_HEAD = 12;            // 缺失表：前 12 欄是給人看的，後面是 JSON

function props_() { return PropertiesService.getScriptProperties(); }
const now_ = () => Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
const today_ = () => Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

// ── 初始化：建試算表、照片資料夾、簽章密鑰 ─────────────
function 初始化() {
  const p = props_();
  if (!p.getProperty('ROOT_ID')) p.setProperty('ROOT_ID', DriveApp.createFolder('缺失改善系統').getId());
  const root = DriveApp.getFolderById(p.getProperty('ROOT_ID'));
  if (!p.getProperty('FOLDER_ID')) p.setProperty('FOLDER_ID', root.createFolder('照片').getId());
  if (!p.getProperty('SS_ID')) {
    const ss = SpreadsheetApp.create('缺失改善系統資料庫');
    const s0 = ss.getSheets()[0];
    s0.setName('帳號'); s0.appendRow(['帳號', '姓名', '角色', '鹽', '雜湊', '停用', '建立時間']);
    ss.insertSheet('建案').appendRow(['建案id', '名稱', '停用', '建立時間', '位置規劃']);
    ss.insertSheet('廠商').appendRow(['廠商id', '名稱', '分類', '工項', '聯絡人', '電話', '回報碼', '停用', '更新時間', '建案']);
    ss.insertSheet('缺失').appendRow(['缺失id', '建案id', '編號', '狀態', '分類', '工項', '廠商', '位置', '期限', '版本', '更新時間', '更新者', '資料']);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    p.setProperty('SS_ID', ss.getId());
  }
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('初始化完成，資料在雲端硬碟「缺失改善系統」資料夾');
}

function sheet_(name) { return SpreadsheetApp.openById(props_().getProperty('SS_ID')).getSheetByName(name); }
function photoFolder_() { return DriveApp.getFolderById(props_().getProperty('FOLDER_ID')); }

// ── 入口 ─────────────────────────────────────
function doGet() { return ContentService.createTextOutput('缺失改善系統後端運作中'); }
function doPost(e) {
  let out;
  try { out = handle_(JSON.parse(e.postData.contents)); }
  catch (err) { out = { ok: false, err: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// 廠商用的（不用登入，靠回報碼）
const PUBLIC_ = { hasUsers: hasUsers_, setupFirst: setupFirst_, login: login_, vendorExport: vendorExport_,
  vendorList: vendorList_, vendorPhotos: vendorPhotos_, vendorUpload: vendorUpload_, vendorAck: vendorAck_, vendorReport: vendorReport_ };
const USER_ = { me: me_, list: list_, exportFile: exportFile_, markSent: markSent_, saveDefect: saveDefect_, deleteDefect: deleteDefect_, saveVendor: saveVendor_, deleteVendor: deleteVendor_, saveCustom: saveCustom_,
  uploadPhoto: uploadPhoto_, getPhotos: getPhotos_, changePass: changePass_ };
const ADMIN_ = { saveProject: saveProject_, listUsers: listUsers_, saveUser: saveUser_, resetData: resetData_ };

function handle_(q) {
  if (!props_().getProperty('SS_ID')) 初始化();
  const a = q && q.action;
  // 廠商回報連結已停用（2026-11-12 使用者決定）；指令碼屬性 VENDOR_PORTAL=1 才打開（測試用）
  if (PUBLIC_[a] && /^vendor/.test(a) && props_().getProperty('VENDOR_PORTAL') !== '1') throw new Error('廠商回報連結已停用，有問題請直接聯絡工地');
  if (PUBLIC_[a]) return Object.assign({ ok: true }, PUBLIC_[a](q));
  const user = auth_(q.token);
  if (!user) return { ok: false, auth: true, err: '請重新登入' };
  if (USER_[a]) return Object.assign({ ok: true }, USER_[a](q, user));
  if (ADMIN_[a]) {
    if (user.role !== 'admin') throw new Error('只有後台帳號能做這件事');
    return Object.assign({ ok: true }, ADMIN_[a](q, user));
  }
  throw new Error('不認得的動作：' + a);
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
const str_ = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 200);

// ── 帳號 ─────────────────────────────────────
function users_() {
  const sh = sheet_('帳號'), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 7).getValues().map((r, i) => ({
    row: i + 2, user: un_(r[0]).toLowerCase(), name: un_(r[1]), role: r[2] === '後台' ? 'admin' : 'staff',
    salt: String(r[3]), hash: String(r[4]), disabled: r[5] === '是' }));
}
const pub_ = u => ({ user: u.user, name: u.name, role: u.role, disabled: u.disabled });
function hash_(pass, salt) {
  let h = salt + '|' + pass;
  for (let i = 0; i < 300; i++) h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  return h;
}
function sign_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, props_().getProperty('SECRET'))); }
function token_(u) {
  const payload = [u.user, Date.now() + TOKEN_DAYS * 864e5, u.hash.slice(0, 10)].join('|');
  return Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8) + '.' + sign_(payload);
}
function auth_(token) {
  if (!token || typeof token !== 'string') return null;
  const [b, sig] = token.split('.');
  let payload;
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString('UTF-8'); } catch (e) { return null; }
  if (sign_(payload) !== sig) return null;
  const [user, exp, h] = payload.split('|');
  if (Date.now() > Number(exp)) return null;
  const u = users_().find(x => x.user === user);
  // 停用或改過密碼 → 舊的登入失效
  if (!u || u.disabled || u.hash.slice(0, 10) !== h) return null;
  return u;
}
const cleanUser_ = s => String(s || '').trim().toLowerCase();
function checkNewUser_(user, name, pass) {
  if (!/^[a-z0-9_.-]{2,30}$/.test(user)) throw new Error('帳號只能用英文、數字（2～30 字）');
  if (!String(name || '').trim()) throw new Error('請填姓名');
  if (pass != null && String(pass).length < 6) throw new Error('密碼至少 6 個字');
}
function addUser_(user, name, role, pass) {
  const salt = Utilities.getUuid();
  sheet_('帳號').appendRow([txt_(user), txt_(String(name).trim()), ROLES[role] || ROLES.staff, salt, hash_(String(pass), salt), '', now_()]);
}
function hasUsers_() { return { has: users_().length > 0 }; }
function setupFirst_(q) {
  return withLock_(() => {
    if (users_().length) throw new Error('已經有帳號了，請用帳號登入');
    const user = cleanUser_(q.user);
    checkNewUser_(user, q.name, q.pass);
    addUser_(user, q.name, 'admin', q.pass);
    return login_({ user, pass: q.pass });
  });
}
function login_(q) {
  const user = cleanUser_(q.user), cache = CacheService.getScriptCache(), ck = 'fail_' + user;
  const fails = Number(cache.get(ck) || 0);
  if (fails >= 8) throw new Error('密碼錯太多次，請 15 分鐘後再試');
  const u = users_().find(x => x.user === user);
  if (!u || u.hash !== hash_(String(q.pass || ''), u.salt)) {
    cache.put(ck, String(fails + 1), 900);
    throw new Error('帳號或密碼不對');
  }
  if (u.disabled) throw new Error('這個帳號已停用，請找後台人員');
  cache.remove(ck);
  return { token: token_(u), me: pub_(u) };
}
function me_(q, u) { return { me: pub_(u) }; }
function changePass_(q, u) {
  return withLock_(() => {
    if (u.hash !== hash_(String(q.old || ''), u.salt)) throw new Error('舊密碼不對');
    checkNewUser_(u.user, u.name, q.pass);
    const salt = Utilities.getUuid(), h = hash_(String(q.pass), salt);
    sheet_('帳號').getRange(u.row, 4, 1, 2).setValues([[salt, h]]);
    return login_({ user: u.user, pass: q.pass });
  });
}
function listUsers_() { return { users: users_().map(pub_) }; }
function saveUser_(q, me) {
  return withLock_(() => {
    const user = cleanUser_(q.user), all = users_(), u = all.find(x => x.user === user);
    const role = q.role === 'admin' ? 'admin' : 'staff';
    if (q.isNew) {
      if (u) throw new Error('這個帳號已經有人用了');
      checkNewUser_(user, q.name, q.pass);
      addUser_(user, q.name, role, q.pass);
      return {};
    }
    if (!u) throw new Error('找不到帳號');
    if (u.user === me.user && (role !== 'admin' || q.disabled)) throw new Error('不能停用自己或拿掉自己的後台權限');
    checkNewUser_(user, q.name, q.pass || null);
    const sh = sheet_('帳號');
    sh.getRange(u.row, 2, 1, 2).setValues([[txt_(String(q.name).trim()), ROLES[role]]]);
    sh.getRange(u.row, 6).setValue(q.disabled ? '是' : '');
    if (q.pass) {
      const salt = Utilities.getUuid();
      sh.getRange(u.row, 4, 1, 2).setValues([[salt, hash_(String(q.pass), salt)]]);
    }
    // 改帳號名稱：舊帳號開的單、加的常用語一起改到新名稱（「開單的人可刪」「加的人可拿掉」才認得）
    const newUser = q.newUser != null ? cleanUser_(q.newUser) : user;
    if (newUser !== user) {
      checkNewUser_(newUser, q.name, null);
      if (all.some(x => x.user === newUser)) throw new Error('帳號「' + newUser + '」已經有人用了');
      sh.getRange(u.row, 1).setValue(txt_(newUser));
      renameOwner_(user, newUser);
    }
    // 改的是自己：換密碼或帳號名稱會讓舊登入失效，直接給新的登入，不要把自己踢出去
    if (u.user === me.user) {
      const nu = users_().find(x => x.user === newUser);
      return { token: token_(nu), me: pub_(nu) };
    }
    return {};
  });
}

function renameOwner_(from, to) {
  const dsh = sheet_('缺失'), vendors = vendors_();
  defectRows_().forEach(h => {
    if (h.d && h.d.byUser === from) { h.d.byUser = to; writeDefect_(dsh, h.row, h.d, h.v, h.who, vendors, h.at); }   // 版本、時間不變
  });
  const csh = customSheet_();
  customs_().forEach(c => { if (c.byUser === from) csh.getRange(c.row, 5).setValue(to); });
}

// ── 試算表列 ─────────────────────────────────
function rows_(name) {
  const sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().map((r, i) => ({ row: i + 2, r }));
}
// JSON 切塊存，前面加 ~ 避免被試算表當成數字或公式
function readJson_(r, from) {
  let s = '';
  for (let i = from; i < r.length; i++) if (r[i] !== '') s += String(r[i]).slice(1);
  return s ? JSON.parse(s) : null;
}
function writeRow_(sh, row, head, obj) {
  const s = obj ? JSON.stringify(obj) : '', parts = [];
  for (let i = 0; i < s.length; i += CHUNK) parts.push('~' + s.slice(i, i + CHUNK));
  const need = head.length + parts.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  if (row > sh.getLastRow()) row = sh.getLastRow() + 1;
  else sh.getRange(row, 1, 1, sh.getMaxColumns()).clearContent();
  sh.getRange(row, 1, 1, need).setValues([head.concat(parts)]);
}
// 試算表會把 '2026-11-12' 這種字變成日期，前面加 ' 讓它保持文字
const txt_ = s => (s ? "'" + s : '');
// 讀回來時拿掉 '（真的 Google 試算表會自己拿掉，模擬環境不會）
const un_ = x => String(x).replace(/^'/, '');

// ── 建案（後台管理）──────────────────────────
function projects_() {
  return rows_('建案').map(({ row, r }) => {
    let loc = null;
    try { loc = r[4] ? JSON.parse(String(r[4]).replace(/^~/, '')) : null; } catch (e) {}
    return { row, id: String(r[0]), name: un_(r[1]), disabled: r[2] === '是', created: String(r[3]), loc };
  });
}
// 位置規劃：棟別（只有一棟就空的）、地下／地上／屋突層數、另外的樓層、各分類的位置清單
const LOC_LISTS = ['bldgs', 'floorsX', 'struct', 'units', 'rooms', 'outer'];
function cleanLoc_(l) {
  if (!l || typeof l !== 'object') return null;
  const num = (x, max) => Math.max(0, Math.min(max, Math.floor(Number(x) || 0)));
  const out = { b: num(l.b, 10), n: num(l.n, 80), r: num(l.r, 5) };
  LOC_LISTS.forEach(k => {
    const seen = {};
    out[k] = (Array.isArray(l[k]) ? l[k] : []).map(s => str_(s, 20)).filter(s => s && !seen[s] && (seen[s] = 1)).slice(0, 60);
  });
  return out;
}
function saveProject_(q) {
  return withLock_(() => {
    const p = q.project || {};
    if (!okId_(p.id)) throw new Error('建案編號不對');
    const name = str_(p.name, 60);
    if (!name) throw new Error('請填建案名稱');
    const all = projects_(), hit = all.find(x => x.id === p.id);
    if (all.some(x => x.id !== p.id && x.name === name)) throw new Error('已經有同名的建案');
    const sh = sheet_('建案'), loc = cleanLoc_(p.loc), locS = loc ? '~' + JSON.stringify(loc) : '';
    if (sh.getMaxColumns() < 5) sh.insertColumnsAfter(sh.getMaxColumns(), 5 - sh.getMaxColumns());
    if (!sh.getRange(1, 5).getValue()) sh.getRange(1, 5).setValue('位置規劃');
    if (hit) sh.getRange(hit.row, 2, 1, 2).setValues([[txt_(name), p.disabled ? '是' : '']]);
    else sh.appendRow([p.id, txt_(name), p.disabled ? '是' : '', now_(), '']);
    // 沒送位置規劃（舊版 App）就不動原本的
    if (p.loc !== undefined) sh.getRange(hit ? hit.row : sh.getLastRow(), 5).setValue(locS);
    return { loc };
  });
}

// ══ 測試完歸零（後台）：mode 'defects' 只清缺失；'all' 連建案、廠商、自填工項／常用語一起清。帳號都留著 ══
function resetData_(q) {
  if (q.confirm !== '歸零') throw new Error('請打「歸零」確認');
  return withLock_(() => {
    const clear = name => { const sh = name === '常用' ? customSheet_() : sheet_(name), last = sh.getLastRow(); if (last >= 2) sh.deleteRows(2, last - 1); };
    const trashAll = folder => { const it = folder.getFiles(); let n = 0; while (it.hasNext()) { it.next().setTrashed(true); n++; } return n; };
    const nD = Math.max(0, sheet_('缺失').getLastRow() - 1);
    clear('缺失');
    const nPh = trashAll(photoFolder_());
    trashAll(exportFolder_());
    if (q.mode === 'all') { clear('建案'); clear('廠商'); clear('常用'); }
    return { defects: nD, photos: nPh };
  });
}

// ── 廠商 ─────────────────────────────────────
function vendors_() {
  return rows_('廠商').map(({ row, r }) => ({ row, id: String(r[0]), name: un_(r[1]), cat: String(r[2]),
    trades: un_(r[3]).split('、').filter(String), contact: un_(r[4]), phone: un_(r[5]),
    code: String(r[6]), disabled: r[7] === '是', pids: String(r[9] || '').split(',').filter(String) }));
}
const pubVendor_ = v => ({ id: v.id, name: v.name, cat: v.cat, trades: v.trades, contact: v.contact, phone: v.phone, code: v.code, disabled: v.disabled, pids: v.pids });
const newCode_ = () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 24);
// 刪除廠商：完全沒有缺失用到才能刪（有用到的要「從建案移除」或後台「停用」，舊紀錄才看得到廠商名稱）
function deleteVendor_(q) {
  return withLock_(() => {
    const v = vendors_().find(x => x.id === q.id);
    if (!v) return {};
    const n = defectRows_().filter(h => h.d.vid === v.id).length;
    if (n) throw new Error(`「${v.name}」還有 ${n} 筆缺失紀錄，不能整個刪除，可以從建案移除或請後台停用`);
    sheet_('廠商').deleteRow(v.row);
    return {};
  });
}
// 工地人員可新增、修改廠商（含加入／移出建案）；停用和換回報碼只有後台能做
function saveVendor_(q, u) {
  return withLock_(() => {
    const v = q.vendor || {};
    if (!okId_(v.id)) throw new Error('廠商編號不對');
    const name = str_(v.name, 60);
    if (!name) throw new Error('請填廠商名稱');
    if (CATS.indexOf(v.cat) < 0) throw new Error('請選分類');
    const trades = (Array.isArray(v.trades) ? v.trades : []).map(t => str_(t, 20)).filter(String).slice(0, 30);
    // 參與的建案：同一家廠商可以在好幾個建案，回報連結共用一個
    const pidOk = {}; projects_().forEach(p => { pidOk[p.id] = 1; });
    let pids = (Array.isArray(v.pids) ? v.pids : []).filter((id, i, a) => pidOk[id] && a.indexOf(id) === i);
    const all = vendors_(), hit = all.find(x => x.id === v.id);
    // 只套用這次「加入／移出」的差別，別人剛同時加的建案不會被舊畫面蓋掉
    if (hit && Array.isArray(v.basePids)) {
      const base = v.basePids, add = pids.filter(id => base.indexOf(id) < 0), rem = base.filter(id => pids.indexOf(id) < 0);
      pids = hit.pids.filter(id => pidOk[id] && rem.indexOf(id) < 0).concat(add.filter(id => hit.pids.indexOf(id) < 0));
    }
    if (all.some(x => x.id !== v.id && x.name === name)) throw new Error('已經有同名的廠商');
    const admin = u.role === 'admin';
    if (hit && !admin && (!!v.disabled !== hit.disabled || q.resetCode)) throw new Error('停用廠商、換連結只有後台帳號能做');
    const code = !hit || q.resetCode ? newCode_() : hit.code;
    // 文字前面加 '：名稱像「3-1」「0123」「=…」才不會被試算表變成日期、數字或公式
    const row = [v.id, txt_(name), v.cat, txt_(trades.join('、')), txt_(str_(v.contact, 30)), txt_(str_(v.phone, 30)), code, v.disabled ? '是' : '', now_(), pids.join(',')];
    const sh = sheet_('廠商');
    if (sh.getRange(1, 10).getValue() === '') sh.getRange(1, 10).setValue('建案');   // 舊表補欄名
    if (hit) sh.getRange(hit.row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return { vendor: pubVendor_({ id: v.id, name, cat: v.cat, trades, contact: str_(v.contact, 30), phone: str_(v.phone, 30), code, disabled: !!v.disabled, pids }) };
  });
}

// ── 缺失 ─────────────────────────────────────
function defectRows_() {
  return rows_('缺失').map(({ row, r }) => ({ row, id: String(r[0]), v: Number(r[9]) || 0, at: timeStr_(r[10]), who: String(r[11]), d: readJson_(r, D_HEAD) }));
}
// 試算表會把「2026-11-12 09:14」變成日期，讀回來統一轉回文字（舊資料也適用）
function timeStr_(x) {
  if (Object.prototype.toString.call(x) === '[object Date]') return Utilities.formatDate(x, 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  return un_(x);
}
function writeDefect_(sh, row, d, v, who, vendors, at) {
  const vd = vendors.find(x => x.id === d.vid);
  const loc = [d.bldg, d.floor, d.spot].filter(String).join(' ');
  writeRow_(sh, row, [d.id, d.pid, d.no, STATUS[d.status], d.cat, txt_(d.trade), txt_(vd ? vd.name : ''), txt_(loc), txt_(d.due), v, txt_(at || now_()), who], d);
}
// ns：通知廠商的狀態 none 還沒傳／sent 已傳／stale 傳過後內容有改（要再傳）
const outD_ = h => Object.assign({}, h.d, { v: h.v, at: h.at, who: h.who, ns: !h.d.sent ? 'none' : h.d.sent.sig === sigOf_(h.d) ? 'sent' : 'stale' });
// 會影響「廠商要知道」的內容：改了就要再通知
const sigOf_ = d => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canon_({
  vid: d.vid, cat: d.cat, trade: d.trade, bldg: d.bldg, floor: d.floor, spot: d.spot, note: d.note, req: d.req,
  photos: d.photos, due: d.due, rej: (d.reviews || []).filter(r => !r.ok).length }), Utilities.Charset.UTF_8)).slice(0, 16);

function list_() {
  return {
    projects: projects_().map(p => ({ id: p.id, name: p.name, disabled: p.disabled, loc: p.loc })),
    vendors: vendors_().map(pubVendor_),
    defects: defectRows_().map(outD_),
    customs: customs_().map(c => ({ kind: c.kind, key: c.key, text: c.text, byUser: c.byUser })),
  };
}

// ── 大家自己加的工項、常用語（全公司共用）──────────
const KINDS = { trade: '工項', phrase: '常用語' };
function customSheet_() {
  const ss = SpreadsheetApp.openById(props_().getProperty('SS_ID'));
  let sh = ss.getSheetByName('常用');
  if (!sh) { sh = ss.insertSheet('常用'); sh.appendRow(['類型', '分類', '內容', '新增的人', '帳號', '時間']); }
  return sh;
}
function customs_() {
  const sh = customSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 6).getValues().map((r, i) => ({ row: i + 2,
    kind: r[0] === KINDS.phrase ? 'phrase' : 'trade', key: un_(r[1]), text: un_(r[2]), by: String(r[3]), byUser: String(r[4]) }));
}
// q.op：add 新增／drop 拿掉（新增的人或後台才能拿掉）
function saveCustom_(q, u) {
  return withLock_(() => {
    if (!KINDS[q.kind]) throw new Error('類型不對');
    const key = str_(q.key, 60), text = str_(q.text, q.kind === 'trade' ? 20 : 40);
    const cat = q.kind === 'trade' ? key : key.split('|')[0];
    if (CATS.indexOf(cat) < 0 || !text) throw new Error('常用資料不完整');
    const all = customs_(), hit = all.find(c => c.kind === q.kind && c.key === key && c.text === text);
    if (q.op === 'drop') {
      if (!hit) return {};
      if (u.role !== 'admin' && hit.byUser !== u.user) throw new Error(`「${text}」是 ${hit.by} 加的，只有他或後台能拿掉`);
      customSheet_().deleteRow(hit.row);
      return {};
    }
    if (!hit) customSheet_().appendRow([KINDS[q.kind], txt_(key), txt_(text), u.name, u.user, now_()]);
    return {};
  });
}

const okDate_ = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const okPhotos_ = (a, max) => Array.isArray(a) && a.length <= max && a.every(okId_);
const photosOfD_ = d => [].concat(d.photos || [],
  ...(d.fixes || []).map(f => f.photos || []), ...(d.reviews || []).map(r => r.photos || []));
const revKey_ = r => canon_({ ok: !!r.ok, note: r.note || '', photos: r.photos || [], due: r.due || '' });
function canon_(o) {
  if (Array.isArray(o)) return '[' + o.map(canon_).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon_(o[k])).join(',') + '}';
  return JSON.stringify(o === undefined ? null : o);
}

// 工地人員存缺失：新增、修改內容、複查（合格結案／退回）。廠商的回報（fixes）、編號、紀錄由後端管。
function saveDefect_(q, u) {
  return withLock_(() => {
    const x = q.defect || {}, admin = u.role === 'admin';
    if (!okId_(x.id)) throw new Error('缺失編號不對');
    const all = defectRows_(), hit = all.find(h => h.id === x.id);
    const oldV = hit ? hit.v : 0;
    if ((q.baseV || 0) !== oldV) {
      if (!hit) return { ok: false, gone: true, err: '這筆缺失已被刪除' };
      return { ok: false, conflict: true, defect: outD_(hit), err: `這筆缺失剛被 ${hit.who} 改過，已載入最新的` };
    }
    const projects = projects_(), vendors = vendors_();
    if (!projects.some(p => p.id === x.pid)) throw new Error('找不到這個建案');
    if (CATS.indexOf(x.cat) < 0) throw new Error('請選大分類');
    const xv = x.vid ? vendors.find(v => v.id === x.vid) : null;
    if (x.vid && !xv) throw new Error('找不到這個廠商');
    if (!okDate_(x.due)) throw new Error('改善期限不對');
    if (!okPhotos_(x.photos, 12)) throw new Error('照片太多或格式不對');
    if (!STATUS[x.status]) throw new Error('狀態不對');
    const reviews = Array.isArray(x.reviews) ? x.reviews : [];
    const d = {
      id: x.id, pid: x.pid, cat: x.cat, trade: str_(x.trade, 20), vid: x.vid || '',
      bldg: str_(x.bldg, 20), floor: str_(x.floor, 20), spot: str_(x.spot, 60),
      note: str_(x.note, 2000), req: str_(x.req, 2000), photos: x.photos, due: x.due, status: x.status,
      // 同一缺失派給好幾家時，每家一張單，用 grp 串起來（共用照片）
      grp: hit ? (hit.d.grp || '') : (okId_(x.grp) ? x.grp : ''),
    };
    // 廠商不在這個建案（例如沒網路時開單，期間別人把他移出）→ 自動加回這個建案，不要讓整筆缺失被擋掉
    const joinVendor = xv && (!hit || hit.d.vid !== x.vid) && xv.pids.indexOf(x.pid) < 0;
    const log = [], who = u.name, vName = id => { const v = vendors.find(z => z.id === id); return v ? v.name : '（未指定）'; };
    if (!d.note && !d.photos.length) throw new Error('請拍照或寫缺失說明');
    if (!hit) {
      if (d.status !== 'wait' || reviews.length) throw new Error('新的缺失狀態要是待改善');
      const nos = all.filter(h => h.d.pid === d.pid).map(h => Number(h.d.no) || 0);
      d.no = (nos.length ? Math.max.apply(null, nos) : 0) + 1;
      d.created = now_(); d.by = who; d.byUser = u.user; d.fixes = []; d.reviews = []; d.log = [];
      log.push('開單' + (d.vid ? '，負責廠商 ' + vName(d.vid) : ''));
    } else {
      const o = hit.d;
      if (o.pid !== d.pid) throw new Error('缺失不能換建案');
      if (o.status === 'done' && !admin) throw new Error('已結案的缺失只有後台帳號能修改');
      // 舊的複查紀錄不能改，只能加一筆
      const ors = o.reviews || [];
      if (reviews.length < ors.length || ors.some((r, i) => revKey_(r) !== revKey_(reviews[i]))) throw new Error('複查紀錄不能修改');
      const added = reviews.slice(ors.length);
      if (added.length > 1) throw new Error('一次只能複查一次');
      d.no = o.no; d.created = o.created; d.by = o.by; d.byUser = o.byUser; d.fixes = o.fixes || []; d.acked = o.acked; d.sent = o.sent;
      d.reviews = ors.slice(); d.log = o.log || [];
      if (added.length) {
        const r = added[0];
        if (!okPhotos_(r.photos || [], 12)) throw new Error('複查照片太多或格式不對');
        const rv = { ok: !!r.ok, note: str_(r.note, 2000), photos: r.photos || [], due: r.ok ? '' : (okDate_(r.due) ? r.due : d.due), at: now_(), by: who };
        if (o.status === 'done') throw new Error('已結案，不用再複查');
        if (rv.ok && d.status !== 'done') throw new Error('合格要結案');
        if (!rv.ok && d.status !== 'wait') throw new Error('不合格要退回待改善');
        if (!rv.ok) d.due = rv.due;
        d.reviews.push(rv);
        log.push(rv.ok ? '複查合格，結案' : '複查不合格，退回改善（期限 ' + d.due + '）');
      } else if (d.status !== o.status) {
        if (!admin) throw new Error('狀態只能用「複查」改');
        log.push('狀態改為「' + STATUS[d.status] + '」');
      }
      if (d.vid !== o.vid) log.push('改派給 ' + vName(d.vid));
      if (d.due !== o.due && !(added.length && !added[0].ok)) log.push('期限改為 ' + d.due);
      const same = k => canon_(d[k]) === canon_(o[k]);
      if (!['cat', 'trade', 'bldg', 'floor', 'spot', 'note', 'req', 'photos'].every(same)) log.push('修改缺失內容');
      // 拿掉的照片丟垃圾桶（30 天內可從雲端硬碟救回）
      const keep = {}; photosOfD_(d).forEach(id => { keep[id] = 1; });
      trashPhotos_(photosOfD_(o).filter(id => !keep[id]), all, d.id);
    }
    if (!log.length) return { v: oldV, defect: outD_(hit) };
    d.log = d.log.concat(log.map(m => ({ at: now_(), who, msg: m })));
    if (joinVendor) sheet_('廠商').getRange(xv.row, 10).setValue(xv.pids.concat([x.pid]).join(','));
    const v = oldV + 1;
    writeDefect_(sheet_('缺失'), hit ? hit.row : 1e9, d, v, who, vendors);
    return { v, defect: outD_({ d, v, at: now_(), who }) };
  });
}
// 刪除：後台隨時可刪；開單的人在廠商還沒回報前可刪
function deleteDefect_(q, u) {
  return withLock_(() => {
    const all = defectRows_(), hit = all.find(h => h.id === q.id);
    if (!hit) return {};
    const o = hit.d;
    if (u.role !== 'admin' && !(o.byUser === u.user && o.status === 'wait' && !(o.fixes || []).length && !(o.reviews || []).length))
      throw new Error('只有後台帳號，或開單的人在廠商回報前能刪除');
    trashPhotos_(photosOfD_(o), all, o.id);
    sheet_('缺失').deleteRow(hit.row);
    return {};
  });
}

// ── 廠商回報（不用登入，用回報碼）────────────────
function vendorByCode_(code) {
  if (!/^[A-Za-z0-9]{16,40}$/.test(String(code || ''))) throw new Error('連結不對，請跟工地要新的連結');
  const v = vendors_().find(x => x.code === code);
  if (!v || v.disabled) throw new Error('連結已失效，請跟工地要新的連結');
  return v;
}
// 廠商看得到的：自己的未結案＋30 天內結案的
function vendorDefects_(v) {
  const cut = Utilities.formatDate(new Date(Date.now() - 30 * 864e5), 'Asia/Taipei', 'yyyy-MM-dd');
  return defectRows_().filter(h => h.d.vid === v.id && (h.d.status !== 'done' || h.at.slice(0, 10) >= cut));
}
function vendorList_(q) {
  const v = vendorByCode_(q.code), pn = {};
  projects_().forEach(p => { pn[p.id] = p.name; });
  const defects = vendorDefects_(v).map(h => {
    const d = h.d;
    return { id: d.id, no: d.no, project: pn[d.pid] || '', cat: d.cat, trade: d.trade, bldg: d.bldg, floor: d.floor, spot: d.spot,
      note: d.note, req: d.req, photos: d.photos, due: d.due, status: d.status, created: d.created, by: d.by,
      fixes: d.fixes || [], reviews: (d.reviews || []).map(r => ({ ok: r.ok, note: r.note, photos: r.photos, due: r.due, at: r.at })), v: h.v };
  });
  return { vendor: { name: v.name, cat: v.cat }, defects };
}
function vendorPhotos_(q) {
  const v = vendorByCode_(q.code), allow = {};
  vendorDefects_(v).forEach(h => photosOfD_(h.d).forEach(id => { allow[id] = 1; }));
  return getPhotos_({ ids: (q.ids || []).filter(id => allow[id]) });
}
function vendorDefect_(q) {
  const v = vendorByCode_(q.code), h = defectRows_().find(x => x.id === q.id && x.d.vid === v.id);
  if (!h) throw new Error('找不到這筆缺失，可能已改派給別的廠商');
  if (h.d.status === 'done') throw new Error('這筆缺失已結案');
  return { v, h };
}
function vendorUpload_(q) {
  const { v } = vendorDefect_(q);
  const cache = CacheService.getScriptCache(), ck = 'up_' + v.id, n = Number(cache.get(ck) || 0);
  if (n >= 80) throw new Error('上傳太多張了，請一小時後再試');
  cache.put(ck, String(n + 1), 3600);
  return uploadPhoto_({ id: q.photo, data: q.data });
}
function vendorAck_(q) {
  return withLock_(() => {
    const { v, h } = vendorDefect_(q);
    if (h.d.status !== 'wait') return {};
    const d = h.d;
    d.status = 'doing'; d.acked = now_();
    d.log = (d.log || []).concat([{ at: now_(), who: v.name, msg: '廠商已收到，改善中' }]);
    writeDefect_(sheet_('缺失'), h.row, d, h.v + 1, v.name, vendors_());
    return {};
  });
}
function vendorReport_(q) {
  return withLock_(() => {
    const { v, h } = vendorDefect_(q);
    const d = h.d;
    if (d.status === 'check') throw new Error('已經回報過了，等工地複查');
    if (!okPhotos_(q.photos, 10) || !q.photos.length) throw new Error('請至少附一張改善後的照片');
    if (q.photos.some(id => !findPhoto_(id))) throw new Error('照片還沒傳完，請再按一次送出');
    d.status = 'check';
    d.fixes = (d.fixes || []).concat([{ note: str_(q.note, 1000), photos: q.photos, at: now_(), by: v.name }]);
    d.log = (d.log || []).concat([{ at: now_(), who: v.name, msg: '廠商回報改善完成' }]);
    writeDefect_(sheet_('缺失'), h.row, d, h.v + 1, v.name, vendors_());
    return {};
  });
}

// ── 照片 ─────────────────────────────────────
function okId_(id) { return /^[a-z0-9]{6,30}$/.test(String(id)); }
function findPhoto_(id) {
  const it = photoFolder_().getFilesByName(id + '.jpg');
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}
function uploadPhoto_(q) {
  if (!okId_(q.id)) throw new Error('照片編號不對');
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(q.data || ''));
  if (!m || m[1].length > 4e6) throw new Error('照片格式不對或太大');
  if (!findPhoto_(q.id)) photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/jpeg', q.id + '.jpg'));
  return {};
}
function getPhotos_(q) {
  const out = {};
  (q.ids || []).slice(0, 10).filter(okId_).forEach(id => {
    const f = findPhoto_(id);
    if (f) out[id] = 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes());
  });
  return { photos: out };
}
// 照片丟垃圾桶；同一組的其他單還在用的不丟（all：全部缺失列、self：這張單）
function trashPhotos_(ids, all, self) {
  const used = {};
  (all || []).forEach(h => { if (h.id !== self) photosOfD_(h.d).forEach(id => { used[id] = 1; }); });
  ids.filter(id => okId_(id) && !used[id]).forEach(id => { const f = findPhoto_(id); if (f) f.setTrashed(true); });
}

// ══ 匯出：通知單 PDF、清單 Excel（存到雲端硬碟「匯出」資料夾，任何有連結的人可看，7 天後自動丟垃圾桶）══
function exportFolder_() {
  const p = props_();
  if (!p.getProperty('EXPORT_ID')) p.setProperty('EXPORT_ID', DriveApp.getFolderById(p.getProperty('ROOT_ID')).createFolder('匯出').getId());
  return DriveApp.getFolderById(p.getProperty('EXPORT_ID'));
}
function exportFile_(q) {
  const want = {};
  (q.ids || []).forEach(id => { want[id] = 1; });
  return makeExport_(q.kind, defectRows_().filter(h => want[h.id]), q.title, !!q.withData);
}
// 廠商：只能匯出自己的（沒指定就是全部未結案）
function vendorExport_(q) {
  const v = vendorByCode_(q.code), mine = vendorDefects_(v), want = {};
  (q.ids || []).forEach(id => { want[id] = 1; });
  const hs = q.ids ? mine.filter(h => want[h.id]) : mine.filter(h => h.d.status !== 'done');
  return makeExport_(q.kind, hs, v.name, false);
}
function makeExport_(kind, hs, title, withData) {
  if (!hs.length) throw new Error('沒有可以匯出的缺失');
  if (hs.length > 40) throw new Error('一次最多 40 筆，請先篩選');
  hs.sort((a, b) => (a.d.pid + String(a.d.no).padStart(6, '0')).localeCompare(b.d.pid + String(b.d.no).padStart(6, '0')));
  const pn = {}, vn = {};
  projects_().forEach(p => { pn[p.id] = p.name; });
  vendors_().forEach(v => { vn[v.id] = v; });
  const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmm');
  const base = '缺失改善' + (kind === 'xlsx' ? '清單' : '通知單') + '_' + String(title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20) + '_' + stamp;
  const blob = kind === 'xlsx' ? xlsxBlob_(hs, pn, vn, base + '.xlsx') : pdfBlob_(hs, pn, vn, base + '.pdf');
  const folder = exportFolder_();
  // 7 天前的匯出檔丟垃圾桶
  const old = Date.now() - 7 * 864e5, it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (f.getDateCreated().getTime() < old) f.setTrashed(true); }
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const out = { url: file.getUrl(), name: blob.getName() };
  if (withData) out.data = Utilities.base64Encode(blob.getBytes());
  return out;
}
const h_ = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const roc_ = s => s ? (Number(s.slice(0, 4)) - 1911) + '/' + s.slice(5, 7) + '/' + s.slice(8, 10) : '';
const locOf_ = d => [d.bldg, d.floor, d.spot].filter(String).join(' ');
function imgs_(ids) {
  return (ids || []).slice(0, 6).map(id => {
    const f = okId_(id) && findPhoto_(id);
    return f ? '<img src="data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes()) + '">' : '';
  }).join('');
}
function pdfBlob_(hs, pn, vn, name) {
  const css = 'body{font-family:sans-serif;font-size:12px;color:#000}h2{text-align:center;letter-spacing:6px;margin:0 0 4px}.no{text-align:center;margin-bottom:10px}'
    + 'table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:5px 6px;vertical-align:top;text-align:left}th{background:#eef1f5;width:80px;white-space:nowrap}'
    + 'img{width:160px;height:120px;border:1px solid #999;margin:2px}.pg{page-break-after:always}.pg:last-child{page-break-after:auto}.foot{font-size:11px;margin-top:6px}.sign td{height:46px;vertical-align:middle}.c{text-align:center}';
  const body = hs.map(h => {
    const d = h.d, v = vn[d.vid], fix = (d.fixes || []).slice(-1)[0], okRv = (d.reviews || []).filter(r => r.ok).slice(-1)[0], back = (d.reviews || []).filter(r => !r.ok).slice(-1)[0], last = (d.reviews || []).slice(-1)[0];
    return '<div class="pg"><h2>缺失改善通知單</h2><div class="no">' + h_(pn[d.pid]) + '　　編號：No. ' + String(d.no).padStart(4, '0') + '　　狀態：' + STATUS[d.status] + '</div><table>'
      + '<tr><th>受通知廠商</th><td>' + h_(v ? v.name : '') + '</td><th>發單日期</th><td>' + roc_(String(d.created || '').slice(0, 10)) + '</td></tr>'
      + '<tr><th>缺失分類</th><td>' + h_(d.cat) + (d.trade ? '／' + h_(d.trade) : '') + '</td><th>改善期限</th><td><b>' + roc_(d.due) + '</b></td></tr>'
      + '<tr><th>位置</th><td colspan="3">' + h_(locOf_(d)) + '</td></tr>'
      + '<tr><th>缺失說明</th><td colspan="3">' + h_(d.note) + '</td></tr>'
      + '<tr><th>改善要求</th><td colspan="3">' + h_(d.req || '請依規範改善，完成後通知工地複查，合格始得結案。') + '</td></tr>'
      + (back ? '<tr><th>複查不合格</th><td colspan="3">' + h_(back.note) + '（' + h_(String(back.at || '').slice(0, 10)) + '）</td></tr>' : '')
      + '<tr><th>缺失照片</th><td colspan="3">' + (imgs_(d.photos) || '—') + '</td></tr>'
      + '<tr><th>改善後照片</th><td colspan="3">' + (fix ? imgs_(fix.photos) + (fix.note ? '<div>' + h_(fix.note) + '</div>' : '') : okRv && (okRv.photos || []).length ? imgs_(okRv.photos) : '<div style="height:50px"></div>') + '</td></tr></table>'
      + '<table class="sign" style="margin-top:8px"><tr><th class="c">開單人</th><th class="c">廠商簽收</th><th class="c">複查人</th><th class="c">結案日期</th></tr>'
      + '<tr><td class="c">' + h_(d.by) + '</td><td class="c"></td><td class="c">' + (last && last.ok ? h_(last.by) : '') + '</td><td class="c">' + (d.status === 'done' && last ? roc_(String(last.at || '').slice(0, 10)) : '') + '</td></tr></table>'
      + '<div class="foot">※ 逾期未改善者，依合約規定辦理。　※ 本單一式兩聯，一聯廠商留存。</div></div>';
  }).join('');
  return HtmlService.createHtmlOutput('<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + body + '</body></html>').getAs('application/pdf').setName(name);
}
// Excel（xlsx）：自己組檔案，不用外部函式庫
function xlsxBlob_(hs, pn, vn, name) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const col = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const head = ['編號', '建案', '廠商', '位置', '大分類', '工項', '缺失說明', '改善要求', '改善期限', '狀態', '開單日期', '開單人', '廠商回報', '缺失照片'];
  const rows = [['缺失改善清單　' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd')], head].concat(hs.map(h => {
    const d = h.d, v = vn[d.vid], fix = (d.fixes || []).slice(-1)[0];
    return [String(d.no).padStart(4, '0'), pn[d.pid] || '', v ? v.name : '', locOf_(d), d.cat, d.trade, d.note, d.req, d.due, STATUS[d.status],
      String(d.created || '').slice(0, 10), d.by, fix ? (fix.at + ' ' + (fix.note || '')) : '', (d.photos || []).length + ' 張'];
  }));
  const widths = [8, 14, 14, 18, 10, 10, 34, 30, 12, 9, 12, 10, 26, 9];
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'
    + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>';
  rows.forEach((r, ri) => {
    x += '<row r="' + (ri + 1) + '">' + r.map((c, ci) => '<c r="' + col(ci) + (ri + 1) + '" t="inlineStr" s="' + (ri === 0 ? 2 : ri === 1 ? 1 : 0) + '"><is><t xml:space="preserve">' + esc(c) + '</t></is></c>').join('') + '</row>';
  });
  x += '</sheetData><pageSetup orientation="landscape"/></worksheet>';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const f = (n, t) => Utilities.newBlob(t, 'application/xml', n);
  const files = [
    f('[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    f('_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f('xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="缺失清單" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    f('xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    f('xl/styles.xml', X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="14"/><name val="Microsoft JhengHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="2" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'),
    f('xl/worksheets/sheet1.xml', x),
  ];
  return Utilities.zip(files, name).setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// 記錄「已傳 PDF 給廠商」（工地人員按分享後呼叫）
function markSent_(q, u) {
  return withLock_(() => {
    const want = {};
    (q.ids || []).slice(0, 40).forEach(id => { want[id] = 1; });
    const sh = sheet_('缺失'), vendors = vendors_(), out = [];
    defectRows_().filter(h => want[h.id]).forEach(h => {
      const d = h.d, again = !!d.sent, v = h.v + 1;
      d.sent = { at: now_(), by: u.name, sig: sigOf_(d) };
      d.log = (d.log || []).concat([{ at: now_(), who: u.name, msg: again ? '已傳更新的 PDF 給廠商' : '已傳 PDF 給廠商' }]);
      writeDefect_(sh, h.row, d, v, u.name, vendors);
      out.push(outD_({ d, v, at: now_(), who: u.name }));
    });
    return { defects: out };
  });
}
