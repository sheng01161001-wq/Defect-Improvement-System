// 後端規則測試：node 測試\api-test.js（全部 ✔ 才能上線）
'use strict';
const { makeEnv } = require('./sim-server.js');
const env = makeEnv();
let pass = 0, fail = 0;
const call = q => JSON.parse(env.doPost({ postData: { contents: JSON.stringify(q) } }).s);
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('✘ ' + msg); } }
const okCall = (q, msg) => { const r = call(q); ok(r.ok && !r.conflict, msg + ' → ' + (r.err || '')); return r; };
const badCall = (q, msg) => { const r = call(q); ok(!r.ok || r.conflict, msg + '（應該被擋）'); return r; };
const cp = o => JSON.parse(JSON.stringify(o));

// 帳號
ok(call({ action: 'hasUsers' }).has === false, '一開始沒有帳號');
const A = okCall({ action: 'setupFirst', user: 'Boss', name: '王後台', pass: 'test-pass-1' }, '建第一個後台');
const ta = A.token;
okCall({ action: 'saveUser', token: ta, isNew: true, user: 'site1', name: '李工地', role: 'staff', pass: 'test-pass-2' }, '新增工地人員');
okCall({ action: 'saveUser', token: ta, isNew: true, user: 'site2', name: '陳工地', role: 'staff', pass: 'test-pass-3' }, '新增工地人員2');
const tb = okCall({ action: 'login', user: 'site1', pass: 'test-pass-2' }, '工地人員登入').token;
const tc = okCall({ action: 'login', user: 'site2', pass: 'test-pass-3' }, '工地人員2登入').token;
badCall({ action: 'listUsers', token: tb }, '工地人員看帳號清單');

// 建案、廠商
badCall({ action: 'saveProject', token: tb, project: { id: 'proj01', name: '冀晨' } }, '工地人員建建案');
okCall({ action: 'saveProject', token: ta, project: { id: 'proj01', name: '冀晨' } }, '後台建建案');
badCall({ action: 'saveProject', token: ta, project: { id: 'proj02', name: '冀晨' } }, '同名建案');
const V = okCall({ action: 'saveVendor', token: tb, vendor: { id: 'ven001', name: '大成營造', cat: '結構體', trades: ['混凝土', '模板'], phone: '0912345678', pids: ['proj01', 'nope'] } }, '工地人員新增廠商').vendor;
ok(V.pids.length === 1 && V.pids[0] === 'proj01', '廠商參與建案（不存在的建案會被拿掉）');
ok(V.code && V.code.length === 24, '廠商有回報碼');
const V2 = okCall({ action: 'saveVendor', token: ta, vendor: { id: 'ven002', name: '美家油漆', cat: '室內裝修', trades: ['油漆'] } }, '新增廠商2').vendor;
ok(V2.pids.length === 0, '廠商2 還沒加入任何建案');
badCall({ action: 'saveVendor', token: tb, vendor: Object.assign({}, V, { disabled: true }) }, '工地人員停用廠商');
badCall({ action: 'saveVendor', token: tb, vendor: { id: 'ven003', name: '亂', cat: '其他' } }, '分類不對');
let L = okCall({ action: 'list', token: tb }, '讀資料');
ok(L.vendors.find(v => v.id === 'ven001').phone === '0912345678', '電話開頭 0 沒被吃掉');

// 開單
const img = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
okCall({ action: 'uploadPhoto', token: tb, id: 'ph0001', data: img }, '上傳照片');
const D = { id: 'def0001', pid: 'proj01', cat: '結構體', trade: '混凝土', vid: 'ven001', bldg: 'A棟', floor: '3F', spot: 'C3柱', note: '樑底蜂窩', req: '打除修補', photos: ['ph0001'], due: '2026-11-19', status: 'wait', reviews: [] };
badCall({ action: 'saveDefect', token: tb, defect: Object.assign({}, D, { status: 'done' }), baseV: 0 }, '新單直接結案');
badCall({ action: 'saveDefect', token: tb, defect: Object.assign({}, D, { pid: 'nope' }), baseV: 0 }, '不存在的建案');
badCall({ action: 'saveDefect', token: tb, defect: Object.assign({}, D, { note: '', photos: [] }), baseV: 0 }, '空白缺失');
okCall({ action: 'saveDefect', token: tb, defect: Object.assign({}, D, { id: 'def0099', vid: 'ven002', photos: [] }), baseV: 0 }, '開單給不在建案的廠商（離線時被移出）');
ok(call({ action: 'list', token: tb }).vendors.find(z => z.id === 'ven002').pids[0] === 'proj01', '廠商自動加回建案');
okCall({ action: 'deleteDefect', token: ta, id: 'def0099' }, '刪測試單');
// 兩人同時改：A 加入建案2、B 用舊畫面改電話 → 建案2 不會被蓋掉
okCall({ action: 'saveProject', token: ta, project: { id: 'proj02', name: '第二案' } }, '建第二案');
okCall({ action: 'saveVendor', token: tb, vendor: Object.assign({}, V2, { pids: ['proj01', 'proj02'], basePids: ['proj01'] }) }, 'A 把廠商2加入第二案');
okCall({ action: 'saveVendor', token: tc, vendor: Object.assign({}, V2, { phone: '0911', pids: ['proj01'], basePids: ['proj01'] }) }, 'B 用舊畫面改電話');
ok(call({ action: 'list', token: tb }).vendors.find(z => z.id === 'ven002').pids.join() === 'proj01,proj02', '同時修改不會蓋掉別人加的建案');
let r = okCall({ action: 'saveDefect', token: tb, defect: D, baseV: 0 }, '開單');
ok(r.v === 1 && r.defect.no === 1 && r.defect.by === '李工地', '編號 1、開單人');
let d = r.defect, v = r.v;
badCall({ action: 'saveDefect', token: tb, defect: D, baseV: 0 }, '舊版本覆蓋');
const r2 = okCall({ action: 'saveDefect', token: tb, defect: Object.assign({}, D, { id: 'def0002', vid: 'ven002', cat: '室內裝修', trade: '油漆', photos: [] }), baseV: 0 }, '開第二單');
ok(r2.defect.no === 2, '編號 2');
// 沒改東西不加版本
ok(okCall({ action: 'saveDefect', token: tb, defect: d, baseV: v }, '原樣存').v === v, '沒改不加版本');
// 偷改廠商回報、編號
let x = cp(d); x.no = 99; x.fixes = [{ note: '假的' }]; x.note = '改說明';
r = okCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '改說明');
ok(r.defect.no === 1 && r.defect.fixes.length === 0 && r.defect.note === '改說明', '編號、廠商回報不會被前端改');
d = r.defect; v = r.v;
x = cp(d); x.status = 'check';
badCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '工地人員直接改狀態');

okCall({ action: 'saveVendor', token: tb, vendor: Object.assign({}, V2, { pids: [] }) }, '廠商2移出建案');
x = cp(r2.defect); x.note = '移出後改說明';
okCall({ action: 'saveDefect', token: tb, defect: x, baseV: r2.v }, '廠商移出建案後舊單照常能改');
okCall({ action: 'saveVendor', token: tb, vendor: Object.assign({}, V2, { pids: ['proj01'] }) }, '廠商2再加回建案');

// 廠商
badCall({ action: 'vendorList', code: 'x'.repeat(24) }, '亂給回報碼');
let VL = okCall({ action: 'vendorList', code: V.code }, '廠商看清單');
ok(VL.defects.length === 1 && VL.defects[0].id === 'def0001' && VL.vendor.name === '大成營造', '廠商只看到自己的');
ok(okCall({ action: 'vendorPhotos', code: V.code, ids: ['ph0001'] }, '廠商看照片').photos.ph0001 === img, '照片一樣');
ok(!Object.keys(okCall({ action: 'vendorPhotos', code: V2.code, ids: ['ph0001'] }, '別的廠商').photos).length, '別的廠商看不到照片');
badCall({ action: 'vendorAck', code: V2.code, id: 'def0001' }, '別的廠商按收到');
okCall({ action: 'vendorAck', code: V.code, id: 'def0001' }, '廠商按收到');
badCall({ action: 'vendorReport', code: V.code, id: 'def0001', note: '好了', photos: [] }, '沒照片回報');
badCall({ action: 'vendorReport', code: V.code, id: 'def0001', note: '好了', photos: ['fx0001'] }, '照片沒傳就回報');
okCall({ action: 'vendorUpload', code: V.code, id: 'def0001', photo: 'fx0001', data: img }, '廠商傳照片');
// 工地這時候用舊版本存 → 衝突，拿到最新
x = cp(d); x.req = '舊畫面改的';
r = badCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '廠商動過後用舊版本存');
ok(r.conflict && r.defect.status === 'doing', '衝突時回傳最新（改善中）');
okCall({ action: 'vendorReport', code: V.code, id: 'def0001', note: '已修補', photos: ['fx0001'] }, '廠商回報完成');
badCall({ action: 'vendorReport', code: V.code, id: 'def0001', note: '再一次', photos: ['fx0001'] }, '重複回報');
L = okCall({ action: 'list', token: tb }, '讀資料');
d = L.defects.find(z => z.id === 'def0001'); v = d.v;
ok(d.status === 'check' && d.fixes.length === 1 && d.log.length === 4, '待複查、有回報、紀錄 4 筆');

// 複查不合格
x = cp(d); x.status = 'wait'; x.reviews = [{ ok: false, note: '還有蜂窩', photos: [], due: '2026-11-25' }];
r = okCall({ action: 'saveDefect', token: tc, defect: x, baseV: v }, '複查不合格');
ok(r.defect.status === 'wait' && r.defect.due === '2026-11-25' && r.defect.reviews[0].by === '陳工地', '退回、新期限、複查人');
d = r.defect; v = r.v;
x = cp(d); x.reviews[0].note = '竄改';
badCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '改舊的複查紀錄');
// 前端回傳的舊複查沒有 at/by 也要能過
x = cp(d); x.reviews = x.reviews.map(z => ({ ok: z.ok, note: z.note, photos: z.photos, due: z.due })); x.spot = 'C3柱旁';
r = okCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '帶舊複查改位置');
ok(r.defect.reviews[0].by === '陳工地', '舊複查保留原本的人');
d = r.defect; v = r.v;
x = cp(d); x.status = 'done'; x.reviews.push({ ok: false, note: '' });
badCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '不合格卻結案');
// 工地直接複查合格（廠商沒回報也可以）
okCall({ action: 'vendorUpload', code: V.code, id: 'def0001', photo: 'fx0002', data: img }, '廠商再傳照片');
okCall({ action: 'vendorReport', code: V.code, id: 'def0001', note: '重做好了', photos: ['fx0002'] }, '廠商再回報');
L = okCall({ action: 'list', token: tb }, '讀資料');
d = L.defects.find(z => z.id === 'def0001'); v = d.v;
okCall({ action: 'uploadPhoto', token: tb, id: 'rv0001', data: img }, '複查照片');
x = cp(d); x.status = 'done'; x.reviews.push({ ok: true, note: '合格', photos: ['rv0001'] });
r = okCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '複查合格結案');
ok(r.defect.status === 'done', '已結案');
d = r.defect; v = r.v;
badCall({ action: 'vendorReport', code: V.code, id: 'def0001', note: 'x', photos: ['fx0002'] }, '結案後廠商回報');
x = cp(d); x.note = '結案後改';
badCall({ action: 'saveDefect', token: tb, defect: x, baseV: v }, '工地人員改已結案');
x = cp(d); x.status = 'wait';
r = okCall({ action: 'saveDefect', token: ta, defect: x, baseV: v }, '後台重開');
ok(r.defect.status === 'wait', '重開後待改善');

// 刪除
badCall({ action: 'deleteDefect', token: tc, id: 'def0002' }, '不是開單的人刪');
okCall({ action: 'deleteDefect', token: tb, id: 'def0002' }, '開單的人刪');
badCall({ action: 'deleteDefect', token: tb, id: 'def0001' }, '有回報後工地人員刪');
okCall({ action: 'deleteDefect', token: ta, id: 'def0001' }, '後台刪');
ok(env._files.filter(f => f.trashed).length >= 4, '刪單後照片進垃圾桶');
ok(okCall({ action: 'list', token: ta }, '讀').defects.length === 0, '缺失清空');

// 換回報碼、停用廠商
const V3 = okCall({ action: 'saveVendor', token: ta, vendor: V, resetCode: true }, '換回報碼').vendor;
ok(V3.code !== V.code, '新回報碼');
badCall({ action: 'vendorList', code: V.code }, '舊連結失效');
okCall({ action: 'saveVendor', token: ta, vendor: Object.assign({}, V3, { disabled: true }) }, '停用廠商');
badCall({ action: 'vendorList', code: V3.code }, '停用後連結失效');

// 大資料切塊
const big = Object.assign({}, D, { id: 'def0009', note: '很長'.repeat(900), vid: 'ven002' });
okCall({ action: 'saveDefect', token: ta, defect: big, baseV: 0 }, '長說明');
let bd = okCall({ action: 'list', token: ta }, '讀').defects.find(z => z.id === 'def0009');
for (let i = 0; i < 30; i++) {
  okCall({ action: 'vendorUpload', code: V2.code, id: 'def0009', photo: 'bx' + String(i).padStart(4, '0'), data: img }, '傳照片' + i);
}
ok(okCall({ action: 'list', token: ta }, '讀').defects.find(z => z.id === 'def0009').note.length === 1800, '長資料讀回完整');

console.log(`\n通過 ${pass}，失敗 ${fail}`);
process.exit(fail ? 1 : 0);
