// Renders assets/icon.svg → assets/icon.png (256), assets/icon.ico (16–256) and src/icon.png.
// Run with Electron (it has a renderer for SVG):  electron scripts/make-icon.js
// The generated files are committed, so normal builds don't need this.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/** ICO container with PNG images inside (supported since Windows Vista) */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12); off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.buf)]);
}

app.whenReady().then(async () => {
  const S = 512;
  const win = new BrowserWindow({ width: S, height: S, show: false, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: {} });
  setTimeout(() => { console.error('timed out'); app.exit(2); }, 20000);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}" style="width:${S}px;height:${S}px;display:block"></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise(r => setTimeout(r, 400));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: S, height: S });
  const pngs = SIZES.map(size => ({ size, buf: big.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  const p256 = pngs.find(p => p.size === 256).buf;
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), p256);
  fs.writeFileSync(path.join(ROOT, 'src', 'icon.png'), p256);
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), ico(pngs));
  console.log('icon.png, icon.ico written');
  app.exit(0);
});
