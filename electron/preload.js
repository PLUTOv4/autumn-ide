// Autumn — preload bridge (renderer ↔ main). The page only gets these functions, never Node itself.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, cb) => ipcRenderer.on(ch, (e, ...a) => cb(...a));

contextBridge.exposeInMainWorld('autumn', {
  init: () => inv('init'),
  openDialog: () => inv('open-dialog'),
  openPath: p => inv('open-path', p),
  save: (p, text) => inv('save', p, text),
  saveAs: (name, text) => inv('save-as', name, text),
  createProject: (name, text) => inv('create-project', name, text),
  listWorkflow: () => inv('list-workflow'),
  openWorkflow: () => inv('open-workflow'),
  saveRecovery: text => inv('save-recovery', text),
  setSettings: s => inv('set-settings', s),
  getRecent: () => inv('get-recent'),
  removeRecent: p => inv('remove-recent', p),
  setCurrent: p => inv('set-current', p),
  reveal: p => inv('reveal', p),
  openInCode: p => inv('open-in-code', p),
  exportFile: (name, data, enc) => inv('export-file', name, data, enc),
  exportPdf: (name, html) => inv('export-pdf', name, html),
  mcpInfo: () => inv('mcp-info'),
  aiClis: refresh => inv('ai-clis', refresh),
  aiAsk: (id, cli, prompt) => inv('ai-ask', id, cli, prompt),
  aiCancel: id => inv('ai-cancel', id),
  setLang: l => inv('set-lang', l),
  putAsset: (b64, ext) => inv('asset-put', b64, ext),
  closeNow: () => inv('close-now'),
  quit: () => inv('quit'),
  onExternal: cb => on('external-change', cb),
  onOpenFile: cb => on('open-file', cb),
  onBeforeClose: cb => on('before-close', cb),
});
