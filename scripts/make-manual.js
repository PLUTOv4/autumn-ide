// Renders a manual page to an A4 PDF with Electron (page numbers in the footer).
//   node scripts/build.js manual [docs/manual-ko.html] [out.pdf]
// Runs as the Electron main process: electron scripts/make-manual.js <in.html> <out.pdf>
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [src, out] = process.argv.slice(-2).map(p => path.resolve(p));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 1500, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL(pathToFileURL(src).href);
  await win.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => document.title)');
  const footer = '<div style="width:100%;padding:0 15mm;font:8px \'Malgun Gothic\',\'Segoe UI\',sans-serif;color:#a08a7a;display:flex;justify-content:space-between">'
    + '<span class="title"></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';
  const pdf = await win.webContents.printToPDF({
    pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: footer,
  });
  fs.writeFileSync(out, pdf);
  console.log(`PDF written: ${out} (${Math.round(pdf.length / 1024)} KB)`);
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
