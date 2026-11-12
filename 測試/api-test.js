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

// 共用的工項、常用語
okCall({ action: 'saveCustom', token: tb, op: 'add', kind: 'trade', key: '結構體', text: '防火披覆' }, '新增自填工項');
okCall({ action: 'saveCustom', token: tb, op: 'add', kind: 'trade', key: '結構體', text: '防火披覆' }, '重複新增不出錯');
okCall({ action: 'saveCustom', token: tc, op: 'add', kind: 'phrase', key: '結構體|鋼筋', text: '0-1 鋼筋外露' }, '新增常用語');
badCall({ action: 'saveCustom', token: tb, op: 'add', kind: 'trade', key: '亂', text: 'x' }, '分類不對');
let CU = okCall({ action: 'list', token: tc }, '讀').customs;
ok(CU.length === 2 && CU.some(c => c.kind === 'phrase' && c.text === '0-1 鋼筋外露'), '別人看得到共用清單（文字沒被轉成日期）');
badCall({ action: 'saveCustom', token: tc, op: 'drop', kind: 'trade', key: '結構體', text: '防火披覆' }, '別人拿掉我加的');
okCall({ action: 'saveCustom', token: ta, op: 'drop', kind: 'trade', key: '結構體', text: '防火披覆' }, '後台拿掉');
okCall({ action: 'saveCustom', token: tc, op: 'drop', kind: 'phrase', key: '結構體|鋼筋', text: '0-1 鋼筋外露' }, '自己拿掉');
ok(okCall({ action: 'list', token: tc }, '讀').customs.length === 0, '都拿掉了');

// 同一缺失派給好幾家：共用照片，刪一張不會刪到別張的照片
okCall({ action: 'uploadPhoto', token: tb, id: 'gp0001', data: img }, '共用照片');
const G = { pid: 'proj01', cat: '室內裝修', trade: '其他', bldg: 'A棟', floor: '2F', spot: '', note: '施工垃圾未清', req: '', photos: ['gp0001'], due: '2026-11-20', status: 'wait', reviews: [], grp: 'grp0001' };
const g1 = okCall({ action: 'saveDefect', token: tb, defect: Object.assign({ id: 'grp0001', vid: 'ven001' }, G), baseV: 0 }, '派給第一家');
const g2 = okCall({ action: 'saveDefect', token: tb, defect: Object.assign({ id: 'grp0002', vid: 'ven002' }, G), baseV: 0 }, '派給第二家');
ok(g1.defect.grp === 'grp0001' && g2.defect.grp === 'grp0001' && g2.defect.no === g1.defect.no + 1, '同一組、各自編號');
x = cp(g2.defect); x.grp = 'hack01'; x.note = '改';
ok(okCall({ action: 'saveDefect', token: tb, defect: x, baseV: g2.v }, '改內容').defect.grp === 'grp0001', '組別不能被改');
okCall({ action: 'deleteDefect', token: ta, id: 'grp0001' }, '刪第一張');
ok(!env._files.find(f => f.name === 'gp0001.jpg').trashed, '別張還在用的照片沒被刪');
okCall({ action: 'deleteDefect', token: ta, id: 'grp0002' }, '刪第二張');
ok(env._files.find(f => f.name === 'gp0001.jpg').trashed, '都刪了照片才進垃圾桶');

// 後台在帳號管理改自己的姓名、密碼：拿到新登入，不會被踢出
const S1 = okCall({ action: 'saveUser', token: ta, user: 'boss', name: '王後台改', role: 'admin', pass: 'test-pass-7' }, '後台改自己的姓名和密碼');
ok(S1.token && S1.me.name === '王後台改', '改自己會拿到新登入');
okCall({ action: 'list', token: S1.token }, '新登入可以用');
okCall({ action: 'login', user: 'boss', pass: 'test-pass-7' }, '新密碼可以登入');
const S2 = okCall({ action: 'saveUser', token: S1.token, user: 'boss', name: '王後台', role: 'admin' }, '只改姓名');
ok(S2.token && S2.me.name === '王後台', '只改姓名也正常');

// 改帳號名稱：舊帳號開的單、加的常用語跟著改；改自己拿到新登入
okCall({ action: 'saveUser', token: S2.token, isNew: true, user: 'site9', name: '周工地', role: 'staff', pass: 'test-pass-9' }, '新增 site9');
const t9 = okCall({ action: 'login', user: 'site9', pass: 'test-pass-9' }, 'site9 登入').token;
const R1 = okCall({ action: 'saveDefect', token: t9, defect: Object.assign({}, D, { id: 'ren0001', photos: [], vid: 'ven001' }), baseV: 0 }, 'site9 開單');
okCall({ action: 'saveCustom', token: t9, op: 'add', kind: 'trade', key: '室外裝修', text: '雨遮' }, 'site9 加工項');
badCall({ action: 'saveUser', token: S2.token, user: 'site9', newUser: 'site1', name: '周工地', role: 'staff' }, '改成別人已用的帳號');
badCall({ action: 'saveUser', token: S2.token, user: 'site9', newUser: '周', name: '周工地', role: 'staff' }, '帳號用中文');
okCall({ action: 'saveUser', token: S2.token, user: 'site9', newUser: '0123', name: '周工地', role: 'staff' }, '後台把 site9 改成 0123');
badCall({ action: 'login', user: 'site9', pass: 'test-pass-9' }, '舊帳號不能登入');
const t0 = okCall({ action: 'login', user: '0123', pass: 'test-pass-9' }, '新帳號（全數字）可以登入').token;
let LL = okCall({ action: 'list', token: t0 }, '讀');
ok(LL.defects.find(z => z.id === 'ren0001').byUser === '0123' && LL.defects.find(z => z.id === 'ren0001').v === R1.v, '舊單跟著改、版本不變');
ok(LL.customs.find(c => c.text === '雨遮').byUser === '0123', '常用語跟著改');
okCall({ action: 'saveCustom', token: t0, op: 'drop', kind: 'trade', key: '室外裝修', text: '雨遮' }, '改名後還能拿掉自己加的');
okCall({ action: 'deleteDefect', token: t0, id: 'ren0001' }, '改名後還能刪自己開的單');
// 後台改自己的帳號名稱
const S3 = okCall({ action: 'saveUser', token: S2.token, user: 'boss', newUser: 'chief', name: '王後台', role: 'admin' }, '後台改自己的帳號名稱');
ok(S3.token && S3.me.user === 'chief', '拿到新帳號的登入');
okCall({ action: 'list', token: S3.token }, '新登入可以用');

// 匯出 PDF／Excel
const EX = okCall({ action: 'saveDefect', token: S3.token, defect: Object.assign({}, D, { id: 'exp0001', photos: ['ph0009'], vid: 'ven002', note: '牆面<裂縫>' }), baseV: 0 }, '開匯出測試單');
okCall({ action: 'uploadPhoto', token: S3.token, id: 'ph0009', data: img }, '匯出用照片');
const P1 = okCall({ action: 'exportFile', token: S3.token, kind: 'pdf', ids: ['exp0001'], title: '美家油漆', withData: true }, '工地匯出 PDF');
const pdfTxt = Buffer.from(P1.data, 'base64').toString('utf8');
ok(P1.url && /\.pdf$/.test(P1.name) && pdfTxt.includes('牆面&lt;裂縫&gt;') && pdfTxt.includes('data:image/jpeg;base64'), 'PDF 有內容、有照片、文字有跳脫');
ok(env._files.find(f => f.name === P1.name).sharing === 'anyone/view', 'PDF 有連結的人可以看');
const X1 = okCall({ action: 'exportFile', token: S3.token, kind: 'xlsx', ids: ['exp0001'], withData: true }, '工地匯出 Excel');
ok(/\.xlsx$/.test(X1.name) && Buffer.from(X1.data, 'base64').toString('utf8').includes('牆面&lt;裂縫&gt;'), 'Excel 有內容');
badCall({ action: 'exportFile', token: S3.token, kind: 'pdf', ids: [] }, '沒選缺失');
badCall({ action: 'exportFile', kind: 'pdf', ids: ['exp0001'] }, '沒登入匯出');
const VX = okCall({ action: 'vendorExport', code: V2.code, kind: 'pdf' }, '廠商匯出自己的 PDF');
ok(VX.url && !VX.data, '廠商拿到連結');
badCall({ action: 'vendorExport', code: V2.code, kind: 'pdf', ids: ['nope'] }, '廠商匯出別人的單');
okCall({ action: 'vendorExport', code: V2.code, kind: 'xlsx', ids: ['exp0001'] }, '廠商匯出 Excel');

// 已通知廠商／有更新未通知
let N1 = okCall({ action: 'saveDefect', token: S3.token, defect: Object.assign({}, D, { id: 'snt0001', photos: [], vid: 'ven002' }), baseV: 0 }, '開通知測試單');
ok(N1.defect.ns === 'none', '新單是未通知');
let M1 = okCall({ action: 'markSent', token: S3.token, ids: ['snt0001'] }, '記錄已傳');
ok(M1.defects[0].ns === 'sent' && M1.defects[0].sent.by === '王後台' && M1.defects[0].log.slice(-1)[0].msg === '已傳 PDF 給廠商', '變成已通知');
let nd = cp(M1.defects[0]); nd.note = '改了說明';
let N2 = okCall({ action: 'saveDefect', token: S3.token, defect: nd, baseV: M1.defects[0].v }, '傳過後改說明');
ok(N2.defect.ns === 'stale' && N2.defect.sent, '改內容後變成有更新未通知');
let M2 = okCall({ action: 'markSent', token: S3.token, ids: ['snt0001'] }, '再傳一次');
ok(M2.defects[0].ns === 'sent' && M2.defects[0].log.slice(-1)[0].msg === '已傳更新的 PDF 給廠商', '再傳後又是已通知');
okCall({ action: 'vendorAck', code: V2.code, id: 'snt0001' }, '廠商按收到');
ok(okCall({ action: 'list', token: S3.token }, '讀').defects.find(z => z.id === 'snt0001').ns === 'sent', '廠商按收到不影響通知狀態');
nd = cp(okCall({ action: 'list', token: S3.token }, '讀').defects.find(z => z.id === 'snt0001')); nd.sent = null;
ok(okCall({ action: 'saveDefect', token: S3.token, defect: Object.assign(nd, { note: '再改' }), baseV: nd.v }, '前端想清掉通知紀錄').defect.sent, '通知紀錄只有後端能改');
badCall({ action: 'markSent', ids: ['snt0001'] }, '沒登入記錄已傳');

const TA = S3.token, TB = okCall({ action: 'login', user: 'site2', pass: 'test-pass-3' }, '工地人員重新登入').token;
// 建案位置規劃
const PL = okCall({ action: 'saveProject', token: TA, project: { id: 'proj01', name: '冀晨', loc: { b: 2, n: 14, r: 2, bldgs: ['A', 'B', 'A', ''], floorsX: ['夾層'], struct: ['柱', '樑'], units: ['A1', 'A2'], rooms: ['客廳'], outer: ['東向外牆'] } } }, '設定位置規劃');
ok(PL.loc.bldgs.join() === 'A,B' && PL.loc.n === 14, '位置規劃去重、去空白');
let LP = okCall({ action: 'list', token: TB }, '讀').projects.find(p => p.id === 'proj01');
ok(LP.loc && LP.loc.struct.join() === '柱,樑' && LP.loc.units.join() === 'A1,A2', '讀得到位置規劃');
okCall({ action: 'saveProject', token: TA, project: { id: 'proj01', name: '冀晨2' } }, '舊版 App 只改名');
LP = okCall({ action: 'list', token: TB }, '讀').projects.find(p => p.id === 'proj01');
ok(LP.name === '冀晨2' && LP.loc && LP.loc.r === 2, '只改名不會清掉位置規劃');
okCall({ action: 'saveProject', token: TA, project: { id: 'projnew', name: '新案位置', loc: { n: 5 } } }, '新建案帶位置規劃');
ok(okCall({ action: 'list', token: TB }, '讀').projects.find(p => p.id === 'projnew').loc.n === 5, '新建案位置規劃存對列');

// 刪除廠商
const VD = okCall({ action: 'saveVendor', token: TB, vendor: { id: 'vdel01', name: '打錯的廠商', cat: '結構體', trades: [], pids: ['proj01'] } }, '新增要刪的廠商').vendor;
okCall({ action: 'saveDefect', token: TB, defect: Object.assign({}, D, { id: 'vdd0001', photos: [], vid: 'vdel01' }), baseV: 0 }, '開一筆給它');
badCall({ action: 'deleteVendor', token: TB, id: 'vdel01' }, '有缺失的廠商整個刪除');
okCall({ action: 'saveVendor', token: TB, vendor: { id: 'vdel02', name: '沒用到的廠商', cat: '結構體', trades: [], pids: ['proj01'] } }, '新增沒用到的廠商');
badCall({ action: 'deleteVendor', id: 'vdel02' }, '沒登入刪廠商');
okCall({ action: 'deleteVendor', token: TB, id: 'vdel02' }, '工地人員刪沒用到的廠商');
ok(!okCall({ action: 'list', token: TB }, '讀').vendors.some(v => v.id === 'vdel02') && VD.id, '廠商刪掉了');

// 歸零
badCall({ action: 'resetData', token: TB, confirm: '歸零' }, '工地人員歸零');
badCall({ action: 'resetData', token: TA, confirm: '好' }, '沒打歸零');
const RZ = okCall({ action: 'resetData', token: TA, confirm: '歸零', mode: 'defects' }, '只清缺失');
let LR = okCall({ action: 'list', token: TA }, '讀');
ok(RZ.defects > 0 && LR.defects.length === 0 && LR.projects.length > 0 && LR.vendors.length > 0, '缺失清空，建案廠商還在');
ok(env._files.filter(f => !f.trashed).length === 0, '照片、匯出檔都丟垃圾桶');
const RN = okCall({ action: 'saveDefect', token: TA, defect: Object.assign({}, D, { id: 'aft0001', photos: [] }), baseV: 0 }, '歸零後開單');
ok(RN.defect.no === 1, '歸零後編號從 1 開始');
okCall({ action: 'resetData', token: TA, confirm: '歸零', mode: 'all' }, '全部清');
LR = okCall({ action: 'list', token: TA }, '讀（帳號還在）');
ok(!LR.defects.length && !LR.projects.length && !LR.vendors.length && !LR.customs.length, '建案、廠商、常用語都清掉');
okCall({ action: 'saveProject', token: TA, project: { id: 'proj09', name: '正式案' } }, '清完可以建新建案');

console.log(`\n通過 ${pass}，失敗 ${fail}`);
process.exit(fail ? 1 : 0);
