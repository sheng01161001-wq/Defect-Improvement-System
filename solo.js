// 單機版後端：把雲端用的 後端\Code.gs 原封不動放在手機裡跑（假的 Google 試算表／雲端硬碟），
// 資料存在這支手機的 IndexedDB，不用網路、不用 Google 帳號。
// 照片不另外存：直接用 App 本來就存在手機的照片（photos 倉庫）。
'use strict';
(function () {
  // ── 位元組、Base64、UTF-8 ─────────────
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toU8 = x => (typeof x === 'string' ? enc.encode(x) : x instanceof Uint8Array ? x : Uint8Array.from(x, b => b & 255));
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }

  // ── SHA-256／HMAC（同步版，Code.gs 是同步呼叫）─────
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(msg) {
    const m = toU8(msg), l = m.length, n = ((l + 9 + 63) >> 6) << 6, b = new Uint8Array(n);
    b.set(m); b[l] = 0x80;
    const dv = new DataView(b.buffer);
    dv.setUint32(n - 4, l * 8 >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, bb, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    H.forEach((x, i) => ov.setUint32(i * 4, x));
    return out;
  }
  function hmac(msg, key) {
    let k = toU8(key);
    if (k.length > 64) k = sha256(k);
    const ip = new Uint8Array(64), op = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { ip[i] = (k[i] || 0) ^ 0x36; op[i] = (k[i] || 0) ^ 0x5c; }
    const m = toU8(msg), inner = new Uint8Array(64 + m.length); inner.set(ip); inner.set(m, 64);
    const ih = sha256(inner), outer = new Uint8Array(96); outer.set(op); outer.set(ih, 64);
    return sha256(outer);
  }

  // ── ZIP（Excel 用；不壓縮）─────────
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zipStore(files) {   // files: [{name, data: Uint8Array}]
    const parts = [], cen = []; let off = 0;
    files.forEach(f => {
      const nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data); cen.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + f.data.length;
    });
    const cs = cen.reduce((n, x) => n + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return concat(parts.concat(cen, [new Uint8Array(e.buffer)]));
  }
  function concat(arr) { const n = arr.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; arr.forEach(x => { o.set(x, p); p += x.length; }); return o; }

  // ── 假的 Apps Script 環境 ─────────────
  let DB = null;            // { sheets: {名稱: {rows, maxCols}}, props: {} } 存在手機
  const trashQ = [];        // 要刪的照片
  let exportsMem = [];      // 匯出檔（只放記憶體）
  const blob = (bytes, name) => { const b = { name, type: '', getBytes: () => bytes, getDataAsString: () => dec.decode(bytes), getName: () => b.name, setName(n) { b.name = n; return b; }, setContentType(t) { b.type = t; return b; } }; return b; };
  const pad = n => String(n).padStart(2, '0');
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => sha256(s),
    computeHmacSha256Signature: (s, k) => hmac(s, k),
    base64Encode: x => b64(toU8(x)),
    base64EncodeWebSafe: x => b64(toU8(x)).replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: s => unb64(s),
    base64DecodeWebSafe: s => { if (!/^[A-Za-z0-9_=-]*$/.test(s)) throw new Error('bad'); return unb64(s.replace(/-/g, '+').replace(/_/g, '/')); },
    newBlob: (bytes, type, name) => blob(toU8(bytes), name),
    zip: (blobs, name) => blob(zipStore(blobs.map(b => ({ name: b.getName(), data: toU8(b.getBytes()) }))), name),
    getUuid: () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')),
    // 台灣時間（+8）
    formatDate: (d, tz, f) => {
      const t = new Date(d.getTime() + 8 * 3600e3);
      return f.replace('yyyy', t.getUTCFullYear()).replace('MM', pad(t.getUTCMonth() + 1)).replace('dd', pad(t.getUTCDate()))
        .replace('HH', pad(t.getUTCHours())).replace('mm', pad(t.getUTCMinutes()));
    },
  };
  function makeSheet(name) {
    const S = DB.sheets[name] = DB.sheets[name] || { rows: [], maxCols: 26 };
    return sheetObj(name);
  }
  function sheetObj(name) {
    const S = () => DB.sheets[name];
    return {
      setName(n) { DB.sheets[n] = S(); delete DB.sheets[name]; name = n; },
      appendRow(a) { S().rows.push(a.slice()); },
      getLastRow: () => S().rows.length,
      getLastColumn: () => Math.max(1, ...S().rows.map(r => { let k = r.length; while (k && (r[k - 1] === '' || r[k - 1] == null)) k--; return k; })),
      getMaxColumns: () => S().maxCols,
      insertColumnsAfter(c, n) { S().maxCols += n; },
      deleteRow(r) { S().rows.splice(r - 1, 1); },
      deleteRows(r, n) { S().rows.splice(r - 1, n); },
      getRange(r, c, nr = 1, nc = 1) {
        const rows = S().rows;
        return {
          getValue() { return this.getValues()[0][0]; },
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (rows[r - 1 + i] || [])[c - 1 + j]; return v == null ? '' : v; })),
          setValues(v) { v.forEach((row, i) => { while (rows.length < r + i) rows.push([]); row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = typeof x === 'string' ? x.replace(/^'/, '') : x; }); }); },
          setValue(x) { this.setValues([[x]]); },
          clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r - 1 + i]) rows[r - 1 + i][c - 1 + j] = ''; },
        };
      },
    };
  }
  const ss = { getId: () => 'SOLO', getUrl: () => '', getSheets: () => Object.keys(DB.sheets).map(sheetObj), insertSheet: n => makeSheet(n), getSheetByName: n => (DB.sheets[n] ? sheetObj(n) : null) };
  const SpreadsheetApp = { create: () => { makeSheet('工作表1'); return ss; }, openById: () => ss };
  // 照片資料夾：照片本來就在手機裡，這裡只處理「刪掉」；匯出資料夾只放記憶體
  const photoStub = id => ({ isTrashed: () => false, setTrashed: t => { if (t) trashQ.push(id); }, getBlob: () => ({ getBytes: () => new Uint8Array(0) }) });
  function folder(id) {
    return {
      getId: () => id, createFolder: n => folder(id + '/' + n),
      getFiles() { const hit = id.endsWith('/匯出') ? exportsMem.slice() : []; let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; },
      getFilesByName(n) { const m = /^(.+)\.jpg$/.exec(n); let done = !m; return { hasNext: () => !done, next: () => { done = true; return photoStub(m[1]); } }; },
      createFile(b) {
        const f = { name: b.getName(), bytes: b.getBytes(), created: new Date(), getDateCreated: () => f.created, getUrl: () => '', setSharing() {}, setTrashed() { exportsMem = exportsMem.filter(x => x !== f); } };
        exportsMem.push(f); return f;
      },
    };
  }
  const DriveApp = { createFolder: n => folder(n), getFolderById: id => folder(id), getFileById: () => ({ moveTo() {} }), Access: {}, Permission: {} };
  const HtmlService = { createHtmlOutput: h => ({ getAs: () => blob(enc.encode(h), 'x.pdf') }) };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (DB.props[k] == null ? null : DB.props[k]), setProperty: (k, v) => { DB.props[k] = String(v); } }) };
  const mem = {};
  const CacheService = { getScriptCache: () => ({ get: k => mem[k] || null, put: (k, v) => { mem[k] = v; }, remove: k => { delete mem[k]; } }) };
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) };
  const Logger = { log() {} };

  let G = null;   // Code.gs 裡的函式
  const READ_ONLY = { list: 1, me: 1, hasUsers: 1, getPhotos: 1, exportFile: 1 };
  let io = null;  // { get, put, delPhoto, clearPhotos }

  async function init(_io) {
    if (G) return;
    io = _io;
    DB = (await io.get('solo-db')) || { sheets: {}, props: {} };
    const r = await fetch('後端/Code.gs');
    if (!r.ok) throw new Error('單機版程式讀不到，請連一次網路再開');
    const code = await r.text();
    const names = ['Utilities', 'SpreadsheetApp', 'DriveApp', 'HtmlService', 'PropertiesService', 'CacheService', 'LockService', 'ContentService', 'Logger'];
    G = new Function(...names, code + '\nreturn { doPost, token_, users_, setupFirst_, defectRows_, projects_, vendors_ };')(
      Utilities, SpreadsheetApp, DriveApp, HtmlService, PropertiesService, CacheService, LockService, ContentService, Logger);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  const save = () => io.put('solo-db', DB);
  const run = q => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(q) } }).s);

  // 單機只有一個使用者：每次都直接給它新的登入，不會過期
  async function call(q) {
    q = Object.assign({}, q);
    if (q.action === 'soloAuth') {
      if (!G.users_ || !run({ action: 'hasUsers' }).has) {
        const name = String(q.name || '').trim();
        if (!name) return { ok: false, err: '請填你的名字' };
        const r = run({ action: 'setupFirst', user: 'me', name, pass: Utilities.getUuid() });
        await save();
        return r;
      }
      const u = G.users_()[0];
      return { ok: true, token: G.token_(u), me: { user: u.user, name: u.name, role: u.role } };
    }
    let u = null;
    try { u = G.users_()[0]; } catch (e) {}   // 還沒初始化
    if (u) q.token = G.token_(u);
    if (q.action === 'uploadPhoto') return { ok: true };            // 照片已經在手機裡
    if (q.action === 'getPhotos') return { ok: true, photos: {} };  // 手機裡沒有就是真的沒有了
    const res = run(q);
    if (q.action === 'exportFile' && res.ok) {
      const f = exportsMem[exportsMem.length - 1];
      res.url = URL.createObjectURL(new Blob([f.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      exportsMem = [];
    }
    if (q.action === 'resetData' && res.ok) { trashQ.length = 0; res.photos = await io.clearPhotos(); }
    while (trashQ.length) await io.delPhoto(trashQ.shift());
    if (!READ_ONLY[q.action]) await save();
    return res;
  }

  // 備份：手機裡的全部資料＋用到的照片 → 一個檔案
  async function backup() {
    const ids = new Set();
    G.defectRows_().forEach(h => [].concat(h.d.photos || [], ...(h.d.fixes || []).map(f => f.photos || []), ...(h.d.reviews || []).map(r => r.photos || [])).forEach(id => ids.add(id)));
    const photos = {};
    for (const id of ids) { const p = await io.photo(id); if (p) photos[id] = p; }
    return { app: 'dfi-solo', ver: 1, at: new Date().toISOString(), db: JSON.parse(JSON.stringify(DB)), photos };
  }
  async function restore(o) {
    if (!o || o.app !== 'dfi-solo' || !o.db || !o.db.sheets) throw new Error('這不是缺失改善系統的備份檔');
    await io.clearPhotos();
    for (const [id, p] of Object.entries(o.photos || {})) await io.putPhoto(id, p);
    DB = o.db; await save();
  }
  window.SoloBackend = { init, call, backup, restore, _sha256: sha256, _hmac: hmac };
})();
