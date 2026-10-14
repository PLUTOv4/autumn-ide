// Autumn — Electron main process
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

app.setName('Autumn');
app.setAppUserModelId('io.github.autumn');

const ROOT = path.join(__dirname, '..');                       // the app folder: src/ electron/ mcp/
/** Autumn's home = the folder with Autumn.exe and WorkFlow.
 *  Packaged: <home>\app\Autumn.exe → <home>.  From source: the folder above the source folder.  AUTUMN_HOME overrides. */
const HOME = process.env.AUTUMN_HOME ? path.resolve(process.env.AUTUMN_HOME)
  : app.isPackaged ? path.resolve(path.dirname(process.execPath), '..') : path.resolve(ROOT, '..');
const WORKFLOW = path.join(HOME, 'WorkFlow');                  // every project is a .autumn.json file in here
const USER = app.getPath('userData');                          // %APPDATA%\Autumn
const STATE_FILE = path.join(USER, 'state.json');              // also read by the MCP server
const RECOVERY_FILE = path.join(USER, 'recovery.autumn.json');
const MCP_SERVER = path.join(ROOT, 'mcp', 'server.js');
/** Default UI language of this build (the build writes "autumnLang" into package.json; English otherwise) */
const DEFAULT_LANG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).autumnLang || 'en'; } catch (_) { return 'en'; } })();
const FILTERS = () => [{ name: T('Autumn project', 'Autumn 프로젝트'), extensions: ['json'] }];
const ASSET_DIR = 'autumn-assets';                             // original image files, next to the project file
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif' };

// autumnasset://img/<relative path> → a file inside the current project's folder. Must be registered before ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'autumnasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const argVal = name => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : ''; };
const captureArg = argVal('capture');                          // dev: screenshot to this PNG and quit
const captureEval = argVal('capture-eval') || (argVal('capture-eval-file') ? fs.readFileSync(argVal('capture-eval-file'), 'utf8') : '');
const captureDelay = +argVal('capture-delay') || 1500;
const pdfArg = argVal('export-pdf'), pdfOut = argVal('out');   // headless: project → PDF (used by the MCP server)
if (pdfArg) app.setPath('userData', path.join(os.tmpdir(), 'autumn-headless'));   // never share the profile with a running Autumn window

/* ---------------------------------------------------------------- state */
function loadState() {
  const def = { recent: [], lastFile: null, currentFile: null, settings: {}, bounds: null };
  try { return Object.assign(def, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (_) { return def; }
}
let state = loadState();
/** UI language: the user's choice, else the build default. Korean needs the generated src-ko folder. */
function uiLang() { const l = process.env.AUTUMN_LANG || state.lang || DEFAULT_LANG; return l === 'ko' && fs.existsSync(path.join(ROOT, 'src-ko', 'index.html')) ? 'ko' : 'en'; }
const uiDir = () => path.join(ROOT, uiLang() === 'ko' ? 'src-ko' : 'src');
const T = (en, ko) => uiLang() === 'ko' ? ko : en;
function saveState() {
  if (captureArg) return;   // screenshots for docs/tests must not touch the user's settings
  try {
    Object.assign(state, { home: HOME, workflow: WORKFLOW, server: MCP_SERVER, exe: process.execPath, uiLang: uiLang() });
    fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.error(e); }
}

/* ---------------------------------------------------------------- file helpers */
let win = null, current = null, lastWritten = null, allowClose = false, watchedPath = null;

function writeAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, p); } catch (_) { fs.writeFileSync(p, text, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
function ensureExt(p) { return /\.json$/i.test(p) ? p : p + '.autumn.json'; }
function ensureWorkflow() { try { fs.mkdirSync(WORKFLOW, { recursive: true }); } catch (_) {} }
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 80) || 'project';
function setCurrent(p) {
  current = p ? path.resolve(p) : null;
  state.currentFile = current;
  if (current) {
    state.lastFile = current;
    state.recent = [current, ...state.recent.filter(x => x.toLowerCase() !== current.toLowerCase())].slice(0, 12);
  }
  saveState();
  watch(current);
}
/** Changes made by other programs (the MCP server, an editor…) are sent to the window, which reloads them live */
function watch(p) {
  if (watchedPath) { fs.unwatchFile(watchedPath); watchedPath = null; }
  if (!p) return;
  watchedPath = p;
  fs.watchFile(p, { interval: 500 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    let text; try { text = fs.readFileSync(p, 'utf8'); } catch (_) { return; }
    if (text === lastWritten || !text.trim()) return;
    try { JSON.parse(text); } catch (_) { return; }   // half-written; the next tick gets the full file
    lastWritten = text;
    if (win && !win.isDestroyed()) win.webContents.send('external-change', text);
  });
}
/** Is abs inside base (safe for case and slash differences on Windows)? */
function inside(base, abs) { const r = path.relative(base, abs); return !!r && !r.startsWith('..') && !path.isAbsolute(r); }
/** Copy the images referenced by a project to another folder (Save as to a different folder) */
function copyAssets(text, from, to) {
  from = path.resolve(from); to = path.resolve(to);
  try {
    const pj = JSON.parse(text);
    for (const b of pj.boards || []) for (const nd of b.nodes || []) for (const im of nd.images || []) {
      if (!im.file) continue;
      const a = path.resolve(from, im.file), c = path.resolve(to, im.file);
      if (!inside(from, a) || !inside(to, c)) continue;
      if (fs.existsSync(a) && !fs.existsSync(c)) { fs.mkdirSync(path.dirname(c), { recursive: true }); fs.copyFileSync(a, c); }
    }
  } catch (_) {}
}
function registerAssetProtocol() {
  protocol.handle('autumnasset', async req => {
    try {
      if (!current) return new Response('no project', { status: 404 });
      const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
      const base = path.dirname(current), abs = path.resolve(base, rel);
      if (!inside(base, abs)) return new Response('forbidden', { status: 403 });
      const data = await fs.promises.readFile(abs);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(abs).slice(1).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' } });
    } catch (_) { return new Response('not found', { status: 404 }); }
  });
}
function readProject(p) {
  p = path.resolve(p);
  const text = fs.readFileSync(p, 'utf8');
  lastWritten = text;
  setCurrent(p);
  return { path: p, text };
}
function fileArg(argv) {
  return argv.slice(1).find(a => !a.startsWith('-') && /\.json$/i.test(a) && fs.existsSync(a)) || null;
}
function findVSCode() {
  const cands = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft VS Code', 'Code.exe'),
  ];
  return cands.find(c => fs.existsSync(c)) || null;
}
/** "~/x" and "%VAR%\x" → absolute paths (the Output folder field of a Start node may use them) */
function expandPath(p) {
  let s = String(p || '').trim().replace(/^["']|["']$/g, '');
  s = s.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m);
  if (/^~(?=$|[\\/])/.test(s)) s = path.join(os.homedir(), s.slice(1));
  return s;
}
let nodeOnPath = null;
function hasNode() {
  if (nodeOnPath === null) { try { nodeOnPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { encoding: 'utf8', windowsHide: true }).status === 0; } catch (_) { nodeOnPath = false; } }
  return nodeOnPath;
}

/* ---------------------------------------------------------------- PDF */
/** Render an HTML document to PDF in a hidden window (the plan HTML comes from src/spec.js) */
async function renderPdf(html) {
  const tmp = path.join(os.tmpdir(), `autumn-pdf-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await w.loadFile(tmp);
    return await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' });
  } finally { w.destroy(); fs.rmSync(tmp, { force: true }); }
}
function planHtmlFor(file) {
  const Spec = require(path.join(uiDir(), 'spec.js'));
  return Spec.planHtml(JSON.parse(fs.readFileSync(file, 'utf8')), { file });
}

/* ---------------------------------------------------------------- window */
function createWindow() {
  // capture mode (dev screenshots): a fixed-size window placed off-screen — hidden windows stop painting
  const b = captureArg ? { width: 1480, height: 920, x: -20000, y: -20000 } : state.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1480, height: b.height || 920, x: b.x, y: b.y,
    minWidth: 960, minHeight: 600, skipTaskbar: !!captureArg,
    backgroundColor: '#18110c', title: 'Autumn', show: false,
    icon: path.join(ROOT, 'src', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: !captureArg },
  });
  if (b.maximized && !captureArg) win.maximize();
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(uiDir(), 'index.html'));
  win.once('ready-to-show', () => { if (!captureArg) win.show(); else { win.showInactive(); win.setPosition(-20000, -20000); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('close', e => {
    if (!win.isMinimized()) state.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    saveState();
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('before-close');
    setTimeout(() => { allowClose = true; if (win && !win.isDestroyed()) win.close(); }, 2500);
  });
  win.on('closed', () => { win = null; });

  if (captureArg) {
    const log = [];
    win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') log.push(`${e.level}: ${e.message} (${path.basename(e.sourceId || '')}:${e.lineNumber})`); });
    app.on('before-quit', () => { if (log.length) fs.writeFileSync(captureArg + '.log', log.join('\n')); });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let out = '';
        try { if (captureEval) out = await win.webContents.executeJavaScript(captureEval); } catch (e) { out = 'ERROR ' + e.message; }
        setTimeout(async () => {
          win.webContents.invalidate(); await new Promise(r => setTimeout(r, 120));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(captureArg, img.toPNG());
          if (out !== undefined && out !== '') fs.writeFileSync(captureArg + '.txt', typeof out === 'string' ? out : JSON.stringify(out, null, 2));
          allowClose = true; app.quit();
        }, captureDelay);
      }, 800);
    });
  }
}

/* ---------------------------------------------------------------- IPC */
const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
h('init', () => {
  ensureWorkflow();
  let file = null, recovery = null;
  const arg = fileArg(process.argv);
  const candidate = arg || (state.settings.reopenLast !== false && !captureArg ? state.lastFile : null);
  if (candidate && fs.existsSync(candidate)) { try { file = readProject(candidate); } catch (_) {} }
  if (!file && !captureArg) { try { recovery = fs.readFileSync(RECOVERY_FILE, 'utf8'); } catch (_) {} }
  saveState();
  return { settings: captureArg ? {} : state.settings, recent: state.recent.filter(p => fs.existsSync(p)), file, recovery, version: app.getVersion(), workflow: WORKFLOW, lang: uiLang() };
});
h('open-dialog', async () => {
  ensureWorkflow();
  const r = await dialog.showOpenDialog(win, { title: T('Open project', '프로젝트 열기'), filters: FILTERS(), properties: ['openFile'], defaultPath: WORKFLOW });
  if (r.canceled || !r.filePaths[0]) return null;
  return readProject(r.filePaths[0]);
});
h('open-path', p => readProject(p));
h('save', (p, text) => { writeAtomic(p, text); lastWritten = text; if (p !== current) setCurrent(p); return true; });
h('save-as', async (name, text) => {
  ensureWorkflow();
  const r = await dialog.showSaveDialog(win, { title: T('Save project', '프로젝트 저장'), filters: FILTERS(), defaultPath: path.join(current ? path.dirname(current) : WORKFLOW, name) });
  if (r.canceled || !r.filePath) return null;
  const p = ensureExt(r.filePath), oldDir = current ? path.dirname(current) : null;
  writeAtomic(p, text); lastWritten = text;
  if (oldDir && path.dirname(p) !== oldDir) copyAssets(text, oldDir, path.dirname(p));
  setCurrent(p); return p;
});
/** New project straight into WorkFlow\<name>.autumn.json (a number is added if the name is taken) */
h('create-project', (name, text) => {
  ensureWorkflow();
  const base = safeName(name);
  let p = path.join(WORKFLOW, base + '.autumn.json'), i = 2;
  while (fs.existsSync(p)) p = path.join(WORKFLOW, `${base} (${i++}).autumn.json`);
  writeAtomic(p, text); lastWritten = text; setCurrent(p);
  return p;
});
h('list-workflow', () => {
  ensureWorkflow();
  let items = [];
  try {
    items = fs.readdirSync(WORKFLOW, { withFileTypes: true }).filter(e => e.isFile() && /\.json$/i.test(e.name) && !/\.tmp-/.test(e.name))
      .map(e => { const p = path.join(WORKFLOW, e.name), st = fs.statSync(p); return { path: p, mtime: st.mtimeMs, size: st.size }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {}
  return { dir: WORKFLOW, items };
});
h('open-workflow', () => { ensureWorkflow(); shell.openPath(WORKFLOW); return true; });
// Original image bytes are stored as autumn-assets/<sha1, 16 chars>.<ext> next to the project (each image once)
h('asset-put', (b64, ext) => {
  if (!current) throw new Error('Save the project to a file first');
  const buf = Buffer.from(b64, 'base64');
  const safe = String(ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png';
  const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + safe;
  const dir = path.join(path.dirname(current), ASSET_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  return ASSET_DIR + '/' + name;
});
h('save-recovery', text => {
  if (captureArg) return true;
  try { if (text == null) fs.rmSync(RECOVERY_FILE, { force: true }); else { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(RECOVERY_FILE, text); } } catch (_) {}
  return true;
});
h('set-settings', s => { if (!captureArg) { state.settings = s; saveState(); } return true; });
h('get-recent', () => state.recent.filter(p => fs.existsSync(p)));
h('remove-recent', p => { state.recent = state.recent.filter(x => x !== p); saveState(); return true; });
h('set-current', p => { setCurrent(p); return true; });
h('reveal', p => { shell.showItemInFolder(p); return true; });
/** Open a file or folder in VS Code (falls back to the default app / Explorer). Folders that don't exist yet are created. */
h('open-in-code', p => {
  const abs = expandPath(p);
  if (!path.isAbsolute(abs)) return false;
  if (!fs.existsSync(abs) && !path.extname(abs)) fs.mkdirSync(abs, { recursive: true });
  const code = findVSCode();
  if (!code) { shell.openPath(abs); return false; }
  spawn(code, [abs], { detached: true, stdio: 'ignore' }).unref();
  return true;
});
h('export-file', async (name, data, enc) => {
  const ext = path.extname(name).slice(1) || 'txt';
  const r = await dialog.showSaveDialog(win, { title: T('Export', '내보내기'), defaultPath: path.join(current ? path.dirname(current) : WORKFLOW, name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data, enc === 'base64' ? 'base64' : 'utf8'));
  return r.filePath;
});
h('export-pdf', async (name, html) => {
  const r = await dialog.showSaveDialog(win, { title: T('Save as PDF', 'PDF로 저장'), defaultPath: path.join(current ? path.dirname(current) : WORKFLOW, name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, await renderPdf(html));
  shell.openPath(r.filePath);
  return r.filePath;
});
/** Switch the UI language: remembered, then the window reloads in the other language (the renderer saves first) */
h('set-lang', l => { state.lang = l === 'ko' ? 'ko' : 'en'; saveState(); if (win) win.loadFile(path.join(uiDir(), 'index.html')); return uiLang(); });
/* ---------------------------------------------------------------- local AI tools (Result node: "Ask the AI for this result") */
// MCP calls only go from the AI to Autumn, so Autumn cannot hand a question to an AI that is chatting in a terminal.
// Instead it runs the same AI tool once in its non-interactive mode: the question goes in on stdin, the answer comes back
// as text. The tool uses its own login — Autumn stores no keys — and gets no tools, so it only reads and answers.
const ASK_LINE = 'Follow the instructions in the input exactly and reply with only the JSON object.';
const AI_CLIS = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude', args: () => ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text', ASK_LINE] },
  { id: 'codex', name: 'Codex', cmd: 'codex', args: out => ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--color', 'never', '-o', out, '-'], lastMessage: true },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', args: () => ['-p', ASK_LINE] },
];
let aiCliCache = null;
function findAiClis() {
  if (aiCliCache) return aiCliCache;
  aiCliCache = [];
  for (const c of AI_CLIS) {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [c.cmd], { encoding: 'utf8', windowsHide: true });
    const found = String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const exe = found.find(p => /\.exe$/i.test(p)) || found.find(p => /\.(cmd|bat)$/i.test(p)) || (process.platform !== 'win32' && found[0]);
    if (exe) aiCliCache.push({ ...c, path: exe });
  }
  return aiCliCache;
}
const aiAsks = new Map();   // request id → { cancel }
function killTree(child) {
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }); else child.kill(); } catch (_) {}
}
function askAi(id, cliId, prompt) {
  const c = findAiClis().find(x => x.id === cliId);
  if (!c) return Promise.resolve({ ok: false, error: 'not-found' });
  const dir = path.join(os.tmpdir(), 'autumn-ask');
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  const args = c.args(outFile);
  const env = { ...process.env };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE']) delete env[k];   // a plain, top-level run of the tool
  const q = a => a === '' ? '""' : /[\s"&|<>^()%!]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a;
  const child = /\.(cmd|bat)$/i.test(c.path)   // npm shims: run through cmd (the arguments are fixed; the question only goes in on stdin)
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + [c.path, ...args].map(q).join(' ') + '"'], { cwd: dir, env, windowsHide: true, windowsVerbatimArguments: true })
    : spawn(c.path, args, { cwd: dir, env, windowsHide: true });
  return new Promise(resolve => {
    let out = '', err = '', done = false;
    const finish = r => {
      if (done) return; done = true; clearTimeout(timer); aiAsks.delete(id);
      try { if (r.ok && c.lastMessage && fs.existsSync(outFile)) r.text = fs.readFileSync(outFile, 'utf8') || r.text; fs.rmSync(outFile, { force: true }); } catch (_) {}
      resolve({ ...r, cli: c.name });
    };
    const timer = setTimeout(() => { killTree(child); finish({ ok: false, error: 'timeout' }); }, 5 * 60 * 1000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { if (out.length < 2e6) out += d; });
    child.stderr.on('data', d => { if (err.length < 2e5) err += d; });
    child.on('error', e => finish({ ok: false, error: e.message }));
    child.on('close', code => finish(code === 0 ? { ok: true, text: out } : { ok: false, error: (err || out).trim().split(/\r?\n/).filter(Boolean).slice(-4).join('\n') || 'exit code ' + code }));
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
    aiAsks.set(id, { cancel: () => { killTree(child); finish({ ok: false, error: 'cancelled' }); } });
  });
}
h('ai-clis', refresh => { if (refresh) aiCliCache = null; return findAiClis().map(({ id, name }) => ({ id, name })); });
h('ai-ask', (id, cli, prompt) => askAi(String(id), String(cli), String(prompt || '').slice(0, 200000)));
h('ai-cancel', id => { const a = aiAsks.get(String(id)); if (a) a.cancel(); return true; });
app.on('will-quit', () => { for (const a of [...aiAsks.values()]) a.cancel(); });

h('mcp-info', () => ({ lang: uiLang(), server: MCP_SERVER, exe: app.isPackaged ? process.execPath : null, node: hasNode(), workflow: WORKFLOW, state: STATE_FILE, current }));
h('close-now', () => { allowClose = true; if (win) win.close(); return true; });
h('quit', () => { if (win) win.close(); return true; });

/* ---------------------------------------------------------------- lifecycle */
if (pdfArg) {
  // Headless: Autumn.exe --export-pdf=<project.json> --out=<file.pdf>
  app.whenReady().then(async () => {
    try { fs.writeFileSync(pdfOut || pdfArg.replace(/(\.autumn)?\.json$/i, '') + '.pdf', await renderPdf(planHtmlFor(path.resolve(pdfArg)))); app.exit(0); }
    catch (e) { console.error(e.message); app.exit(1); }
  });
} else if (!captureArg && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileArg(argv);
    if (f) { try { win.webContents.send('open-file', readProject(f)); } catch (_) {} }
  });
  app.whenReady().then(() => { ensureWorkflow(); registerAssetProtocol(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
