// 從 index.html 產生單機版 solo.html（node 測試\make-solo.js）。
// 單機版要自己的網頁檔：手機加到主畫面時，一開始讀到的名稱、圖示、manifest 就要是單機版的（用程式換來不及，iPhone 會變成公司版）。
// 程式碼都一樣，只換 <head> 這幾行。改完 index.html 一定要重跑（solo-test.js 會檢查有沒有同步）。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

function build(html) {
  const swap = [
    ['<title>小棒槌 缺失改善系統</title>', '<title>缺失改善單機版</title>'],
    ['<meta name="apple-mobile-web-app-title" content="缺失改善系統">', '<meta name="apple-mobile-web-app-title" content="缺失改善單機版">'],
    ['<link rel="manifest" href="manifest.webmanifest">', '<link rel="manifest" href="manifest-solo.webmanifest">'],
    ['<link rel="icon" href="icon-192.png">', '<link rel="icon" href="icon-solo-192.png">'],
    ['<link rel="apple-touch-icon" href="apple-touch-icon.png">', '<link rel="apple-touch-icon" href="apple-touch-icon-solo.png">'],
  ];
  let out = html;
  for (const [a, b] of swap) {
    if (out.split(a).length !== 2) throw new Error('index.html 找不到（或不只一個）：' + a);
    out = out.replace(a, b);
  }
  // 公司版轉址那段換成單機版的記號
  const m = out.match(/<script id="toSolo">[\s\S]*?<\/script>\r?\n/), nl = /\r\n/.test(out) ? '\r\n' : '\n';
  if (!m) throw new Error('index.html 找不到 <script id="toSolo">');
  return out.replace(m[0], '<meta name="dfi-app" content="solo">' + nl + '<!-- 這個檔是從 index.html 自動產生的（測試\\make-solo.js），不要直接改 -->' + nl);
}

if (require.main === module) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'solo.html'), build(html));
  console.log('已產生 solo.html');
}
module.exports = { build };
