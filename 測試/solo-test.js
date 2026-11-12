// 單機版後端測試：node 測試\solo-test.js（solo.js 在 Node 裡跑，資料放記憶體）
'use strict';
const fs = require('fs'), path = require('path');
global.window = globalThis;
global.fetch = async () => ({ ok: true, text: async () => fs.readFileSync(path.join(__dirname, '..', '後端', 'Code.gs'), 'utf8') });
global.URL.createObjectURL = () => 'blob:test';
require('../solo.js');
const S = window.SoloBackend;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✘ ' + m); } };
const kv = {}, photos = {};
const io = {
  get: async k => (kv[k] ? JSON.parse(JSON.stringify(kv[k])) : null), put: async (k, v) => { kv[k] = JSON.parse(JSON.stringify(v)); },
  photo: async id => photos[id], putPhoto: async (id, d) => { photos[id] = d; },
  delPhoto: async id => { delete photos[id]; }, clearPhotos: async () => { const n = Object.keys(photos).length; for (const k in photos) delete photos[k]; return n; },
};
(async () => {
  await S.init(io);
  ok(!(await S.call({ action: 'soloAuth', name: '' })).ok, '沒填名字');
  const A = await S.call({ action: 'soloAuth', name: '王主任' });
  ok(A.ok && A.me.name === '王主任' && A.me.role === 'admin', '單機使用者是後台');
  const A2 = await S.call({ action: 'soloAuth' });
  ok(A2.ok && A2.me.name === '王主任', '第二次直接進');
  ok((await S.call({ action: 'saveProject', project: { id: 'proj01', name: '0123測試', loc: { n: 3 } } })).ok, '建建案');
  ok((await S.call({ action: 'saveVendor', vendor: { id: 'ven001', name: '大成', cat: '結構體', trades: ['鋼筋'], phone: '0912', pids: ['proj01'] } })).ok, '建廠商');
  photos.ph0001 = 'data:image/jpeg;base64,AAAA'; photos.ph0002 = 'data:image/jpeg;base64,BBBB';
  const D = { id: 'def0001', pid: 'proj01', cat: '結構體', trade: '鋼筋', vid: 'ven001', floor: '3F', spot: '柱', note: '保護層不足', req: '', photos: ['ph0001', 'ph0002'], due: '2026-11-19', status: 'wait', reviews: [] };
  const R = await S.call({ action: 'saveDefect', defect: D, baseV: 0 });
  ok(R.ok && R.defect.no === 1 && R.defect.by === '王主任', '開單');
  const L = await S.call({ action: 'list' });
  ok(L.projects[0].name === '0123測試' && L.vendors[0].phone === '0912' && L.defects.length === 1, '讀得回來（文字沒被改）');
  // 拿掉一張照片 → 手機裡那張也刪掉
  const R2 = await S.call({ action: 'saveDefect', defect: Object.assign({}, R.defect, { photos: ['ph0001'] }), baseV: R.defect.v });
  ok(R2.ok && !photos.ph0002 && photos.ph0001, '拿掉的照片從手機刪掉');
  const X = await S.call({ action: 'exportFile', kind: 'xlsx', ids: ['def0001'], title: '大成', withData: true });
  ok(X.ok && X.url === 'blob:test' && /\.xlsx$/.test(X.name), 'Excel');
  fs.writeFileSync(path.join(__dirname, 'out-solo.xlsx'), Buffer.from(X.data, 'base64'));
  ok((await S.call({ action: 'markSent', ids: ['def0001'] })).defects[0].ns === 'sent', '記錄已通知');
  ok(!(await S.call({ action: 'vendorList', code: 'x'.repeat(24) })).ok, '廠商回報連結關閉');
  // 存在手機（重新載入也還在）
  const B = await S.backup();
  ok(B.app === 'dfi-solo' && B.photos.ph0001 && !B.photos.ph0002, '備份含用到的照片');
  ok((await S.call({ action: 'resetData', confirm: '歸零', mode: 'all' })).ok && !(await S.call({ action: 'list' })).defects.length && !photos.ph0001, '歸零');
  await S.restore(JSON.parse(JSON.stringify(B)));
  const L2 = await S.call({ action: 'list' });
  ok(L2.defects.length === 1 && L2.projects.length === 1 && photos.ph0001, '從備份還原');
  ok(kv['solo-db'] && kv['solo-db'].sheets['缺失'].rows.length === 2, '資料有存進手機');
  const R3 = await S.call({ action: 'deleteDefect', id: 'def0001' });
  ok(R3.ok && !photos.ph0001, '刪單連照片一起刪');
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });
