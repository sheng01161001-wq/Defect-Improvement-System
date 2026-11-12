// 缺失改善通知單 PDF：在手機上畫（Canvas，A4 150dpi）→ 每頁一張 JPEG → 自己組成 PDF。
// 單機版、公司版共用（照片本來就在手機裡，不用再傳到雲端轉檔，比較快）。
'use strict';
(function () {
  const STATUS = { wait: '待改善', doing: '改善中', check: '待複查', done: '已結案' };
  const roc = s => (s ? (Number(s.slice(0, 4)) - 1911) + '/' + s.slice(5, 7) + '/' + s.slice(8, 10) : '');
  const FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC","Noto Sans CJK TC",sans-serif';
  const W = 1240, H = 1754, M = 70, TW = W - 2 * M, LW = 170, LH = 36, PAD = 12;
  const enc = new TextEncoder();
  const loadImg = src => new Promise(res => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  function wrap(ctx, text, w) {
    const out = [];
    String(text || '').split('\n').forEach(line => {
      let cur = '';
      for (const ch of line) { if (ctx.measureText(cur + ch).width > w && cur) { out.push(cur); cur = ch; } else cur += ch; }
      out.push(cur);
    });
    return out;
  }
  // ds：缺失（照編號排好）；o.projectName(id)、o.vendorName(id)、o.photo(id) → dataURL
  async function make(ds, o) {
    const pages = [], jpgs = [];
    let ctx, y;
    // 畫好的頁面轉成 JPEG 後就放掉畫布（iPhone 畫布記憶體有限，40 頁一起留著會失敗）
    const flush = async () => {
      for (const c of pages.splice(0)) {
        const b = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
        if (!b) throw new Error('PDF 產生失敗（手機記憶體不夠），請少選幾筆再試');
        jpgs.push({ w: c.width, h: c.height, data: new Uint8Array(await b.arrayBuffer()) });
        c.width = c.height = 0;
      }
    };
    const newPage = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; pages.push(cv); y = M; };
    const font = (px, b) => { ctx.font = (b ? 'bold ' : '') + px + 'px ' + FONT; };
    const ensure = h => { if (y + h > H - M) newPage(); };
    const box = (x, yy, w, h, fill) => { if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, yy, w, h); ctx.fillStyle = '#000'; } ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(x, yy, w, h); };
    // 一列：[標題, 內容] 或 [標題, 內容, 標題, 內容]（內容自動換行）
    const row = cells => {
      font(26);
      const widths = cells.length === 2 ? [LW, TW - LW] : [LW, (TW - 2 * LW) / 2, LW, (TW - 2 * LW) / 2];
      const lines = cells.map((c, i) => (i % 2 ? wrap(ctx, c, widths[i] - 2 * PAD) : [c]));
      const h = Math.max(...lines.map(l => l.length)) * LH + 2 * PAD;
      ensure(h);
      let x = M;
      cells.forEach((c, i) => {
        box(x, y, widths[i], h, i % 2 ? null : '#eef1f5');
        font(26, !(i % 2));
        lines[i].forEach((t, k) => ctx.fillText(t, x + PAD, y + PAD + k * LH + 4));
        x += widths[i];
      });
      y += h;
    };
    const photoRow = (label, ims) => {
      const pw = 300, ph = 225, gap = 10, per = 3;
      const h = ims.length ? Math.ceil(ims.length / per) * (ph + gap) - gap + 2 * PAD : 90;
      ensure(h);
      box(M, y, LW, h, '#eef1f5'); box(M + LW, y, TW - LW, h);
      font(26, true); ctx.fillText(label, M + PAD, y + PAD + 4);
      ims.forEach((im, i) => {
        const x = M + LW + PAD + (i % per) * (pw + gap), yy = y + PAD + Math.floor(i / per) * (ph + gap);
        const k = Math.min(pw / im.width, ph / im.height), dw = im.width * k, dh = im.height * k;
        ctx.drawImage(im, x + (pw - dw) / 2, yy + (ph - dh) / 2, dw, dh);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.strokeRect(x, yy, pw, ph);
      });
      y += h;
    };
    // 照片先一起讀進來（不用一張一張等）
    const imgs = await Promise.all(ds.map(d => Promise.all((d.photos || []).slice(0, 6).map(id => o.photo(id).then(loadImg)))));
    for (let n = 0; n < ds.length; n++) {
      const d = ds[n], rvs = d.reviews || [], back = rvs.filter(r => !r.ok).slice(-1)[0], last = rvs.slice(-1)[0];
      newPage();
      // 案名放最上面當抬頭（大字），下面才是表單名稱
      font(58, true); ctx.textAlign = 'center'; ctx.fillText(o.projectName(d.pid) || '', W / 2, y); y += 78;
      ctx.fillRect(M, y, TW, 4); y += 22;
      font(40, true); ctx.fillText('缺 失 改 善 通 知 單', W / 2, y); y += 60;
      font(26); ctx.fillText('編號：No. ' + String(d.no).padStart(4, '0') + '　　狀態：' + STATUS[d.status], W / 2, y); y += 52;
      ctx.textAlign = 'left';
      row(['受通知廠商', o.vendorName(d.vid), '發單日期', roc(String(d.created || '').slice(0, 10))]);
      row(['工項', d.trade || d.cat, '改善期限', roc(d.due)]);
      row(['位置', [d.bldg, d.floor, d.spot].filter(Boolean).join(' ')]);
      row(['缺失說明', d.note || '']);
      row(['改善要求', d.req || '請依規範改善，完成後通知工地複查，合格始得結案。']);
      if (back) row(['複查不合格', back.note + '（' + String(back.at || '').slice(0, 10) + '）']);
      photoRow('缺失照片', imgs[n].filter(Boolean));
      y += 16;
      // 簽名欄（文字置中）
      ensure(160);
      const cw = TW / 4;
      ctx.textAlign = 'center';
      ['開單人', '廠商簽收', '複查人', '結案日期'].forEach((t, i) => { box(M + i * cw, y, cw, 52, '#eef1f5'); font(26, true); ctx.fillText(t, M + i * cw + cw / 2, y + 12); });
      y += 52;
      [d.by || '', '', last && last.ok ? last.by || '' : '', d.status === 'done' && last ? roc(String(last.at || '').slice(0, 10)) : '']
        .forEach((t, i) => { box(M + i * cw, y, cw, 90); font(26); ctx.fillText(t, M + i * cw + cw / 2, y + 30); });
      ctx.textAlign = 'left'; y += 100;
      font(22); ctx.fillText('※ 逾期未改善者，依合約規定辦理。　※ 本單一式兩聯，一聯廠商留存。', M, y);
      await flush();
    }
    return build(jpgs);
  }
  // 組 PDF：每頁一張 JPEG 圖
  function build(imgs) {
    const parts = [], offs = []; let pos = 0;
    const add = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); pos += u.length; };
    const n = imgs.length, pageIds = imgs.map((_, i) => 3 + i * 3);
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const obj = (id, body) => { offs[id] = pos; add(id + ' 0 obj\n'); body(); add('\nendobj\n'); };
    obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => add('<< /Type /Pages /Kids [' + pageIds.map(i => i + ' 0 R').join(' ') + '] /Count ' + n + ' >>'));
    imgs.forEach((im, i) => {
      const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2, pw = 595.28, ph = 841.89;
      obj(pid, () => add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + iid + ' 0 R >> >> /Contents ' + cid + ' 0 R >>'));
      const cs = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
      obj(cid, () => { add('<< /Length ' + cs.length + ' >>\nstream\n'); add(cs); add('\nendstream'); });
      obj(iid, () => { add('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n'); add(im.data); add('\nendstream'); });
    });
    const total = 3 + n * 3, xref = pos;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    add(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    const out = new Uint8Array(pos); let p = 0;
    parts.forEach(u => { out.set(u, p); p += u.length; });
    return out;
  }
  window.NoticePdf = { make, build };
})();
