#!/usr/bin/env node
// Autumn build
//   node scripts/build.js            → builds Autumn into  <Desktop>\Autumn\  (Autumn.exe · app\ · WorkFlow\)
//   node scripts/build.js --out=DIR  → builds into DIR instead
//   node scripts/build.js --lang=ko  → the build starts in Korean (both languages are always included; View › Language switches)
//   node scripts/build.js dev        → runs Autumn from the source (no packaging)
//   node scripts/build.js portable   → one Autumn.exe in dist\ (unpacks itself on the first start)
//   node scripts/build.js manual [in.html] [out.pdf] → renders the user manual (docs/manual-ko.html) to PDF
//   node scripts/build.js capture out.png [--capture-eval-file=a.js]  → screenshot of the running app (for docs / checks)
// Build tools and the Electron download are kept in %LOCALAPPDATA%\Autumn-build, so the source folder stays clean.
// Offline: set ELECTRON_ZIP_DIR to a folder with electron-v<version>-win32-x64.zip, and AUTUMN_TOOLS to a folder whose
// node_modules contains @electron/packager. ELECTRON_ZIP_DIR may also hold ffmpeg-v<version>-win32-x64.zip.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const BUILD = path.join(LOCAL, 'Autumn-build');
const TOOLS = process.env.AUTUMN_TOOLS || path.join(BUILD, 'tools');
const ELECTRON_VERSION = '44.5.1';
const ELECTRON_ZIP = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const WIN_TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const CSC = ['Framework64', 'Framework'].map(f => path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find(p => fs.existsSync(p));

const log = (...a) => console.log('\x1b[33m[autumn]\x1b[0m', ...a);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`failed: ${path.basename(cmd)} ${args.join(' ')}`);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
const clean = p => fs.rmSync(p, { recursive: true, force: true });
const argVal = name => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };

/** The Windows Desktop folder (follows OneDrive / folder redirection) */
function desktopDir() {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true });
    const d = (r.stdout || '').trim(); if (d && fs.existsSync(d)) return d;
  }
  return path.join(os.homedir(), 'Desktop');
}
function isRunning(exe) {
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').toLowerCase().includes(exe.toLowerCase());
}

/* ---------------------------------------------------------------- tools */
function ensurePackager() {
  const need = ['@electron/packager', 'acorn'].filter(m => !fs.existsSync(path.join(TOOLS, 'node_modules', ...m.split('/'))));
  if (!need.length) return;
  if (process.env.AUTUMN_TOOLS) throw new Error(`${need.join(', ')} not found in AUTUMN_TOOLS (${TOOLS})`);
  fs.mkdirSync(TOOLS, { recursive: true });
  if (!fs.existsSync(path.join(TOOLS, 'package.json'))) fs.writeFileSync(path.join(TOOLS, 'package.json'), '{ "name": "autumn-build-tools", "private": true }');
  log(`Installing build tools: ${need.join(', ')} (one time)…`);
  run(process.execPath, [NPM_CLI, 'install', '--no-audit', '--no-fund', '--loglevel=error', ...need], { cwd: TOOLS });
}
/** A folder that already holds the Electron zip (offline builds, dev runs) */
function electronZipDir() {
  const cands = [process.env.ELECTRON_ZIP_DIR, path.join(BUILD, 'electron')].filter(Boolean);
  const cache = path.join(LOCAL, 'electron', 'Cache');
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache)) cands.push(path.join(cache, d));
  return cands.find(d => fs.existsSync(path.join(d, ELECTRON_ZIP))) || null;
}

/** Electron's default ffmpeg.dll can decode H.264 and AAC, which are covered by patents. Autumn plays no audio or video,
 *  so the build can swap in the ffmpeg.dll without those codecs that Electron publishes with every release:
 *  it does so when that zip is already in the Electron cache or ELECTRON_ZIP_DIR, or when --free-ffmpeg asks to download it. */
const FFMPEG_ZIP = `ffmpeg-v${ELECTRON_VERSION}-win32-x64.zip`;
async function useFreeFfmpeg(appDir) {
  const cache = path.join(LOCAL, 'electron', 'Cache');
  const cands = [process.env.ELECTRON_ZIP_DIR, path.join(BUILD, 'electron')].filter(Boolean);
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache)) cands.push(path.join(cache, d));
  let zip = cands.map(d => path.join(d, FFMPEG_ZIP)).find(p => fs.existsSync(p));
  if (!zip && !process.argv.includes('--free-ffmpeg')) { log(`ffmpeg.dll: Electron's standard copy (add --free-ffmpeg to use ${FFMPEG_ZIP})`); return; }
  if (!zip) {
    log(`Downloading ${FFMPEG_ZIP} (ffmpeg without H.264 / AAC) once`);
    const mod = await import(pathToFileURL(require.resolve('@electron/get', { paths: [TOOLS] })).href);
    const downloadArtifact = mod.downloadArtifact || mod.default?.downloadArtifact;
    zip = await downloadArtifact({ version: ELECTRON_VERSION, artifactName: 'ffmpeg', platform: 'win32', arch: 'x64' });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-ffmpeg-'));
  try {
    run(WIN_TAR, ['-x', '-f', zip, '-C', tmp]);
    fs.copyFileSync(path.join(tmp, 'ffmpeg.dll'), path.join(appDir, 'ffmpeg.dll'));
  } finally { clean(tmp); }
  log('ffmpeg.dll: codec-free build (no H.264 / AAC)');
}

/* ---------------------------------------------------------------- build */
async function build() {
  const home = path.resolve(argVal('out') || path.join(desktopDir(), 'Autumn'));
  const stage = path.join(BUILD, 'stage'), out = path.join(BUILD, 'out');
  log(`Autumn ${PKG.version} → ${home}`);
  if (isRunning('Autumn.exe')) throw new Error('Autumn is running. Close it and build again.');
  ensurePackager();

  log('Preparing the app files');
  clean(stage); clean(out);
  fs.mkdirSync(stage, { recursive: true });
  const lang = argVal('lang') === 'ko' ? 'ko' : 'en';
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: PKG.name, productName: PKG.productName, version: PKG.version, description: PKG.description, main: PKG.main, license: PKG.license, autumnLang: lang }, null, 2));
  for (const d of ['electron', 'src', 'mcp']) copyDir(path.join(SRC, d), path.join(stage, d));
  const ko = require('./i18n').apply('ko', path.join(stage, 'src-ko'), path.join(SRC, 'src'));   // Korean UI generated from src/ + i18n/ko.json
  log(`Korean UI: ${ko.text} texts · ${ko.templates} sentences${ko.unusedTemplates.length ? ' · WARNING ' + ko.unusedTemplates.length + ' sentence rules no longer match' : ''} · starts in ${lang === 'ko' ? 'Korean' : 'English'}`);
  for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(stage, f));

  const zipDir = electronZipDir();
  log(`Packaging with Electron ${ELECTRON_VERSION}${zipDir ? ' (local copy, no download)' : ' (downloading once)'}`);
  const entry = require.resolve('@electron/packager', { paths: [TOOLS] });
  const mod = await import(pathToFileURL(entry).href);
  const packager = mod.packager || mod.default?.packager || mod.default;
  const [dir] = await packager({
    dir: stage, out, name: 'Autumn', executableName: 'Autumn', platform: 'win32', arch: 'x64',
    electronVersion: ELECTRON_VERSION, icon: path.join(SRC, 'assets', 'icon.ico'), asar: false, overwrite: true, prune: false,
    appVersion: PKG.version, buildVersion: PKG.version, appCopyright: 'Copyright (c) 2026 PLUTOv4',
    win32metadata: { CompanyName: 'Autumn', FileDescription: 'Autumn', ProductName: 'Autumn', InternalName: 'Autumn', OriginalFilename: 'Autumn.exe' },
    ...(zipDir ? { electronZipDir: zipDir } : {}),
  });

  log('Installing into', home);
  fs.mkdirSync(home, { recursive: true });
  const appDir = path.join(home, 'app');
  clean(appDir);
  copyDir(dir, appDir);
  await useFreeFfmpeg(appDir);
  fs.mkdirSync(path.join(home, 'WorkFlow'), { recursive: true });   // projects live here (never touched by the build)

  const launcher = path.join(home, 'Autumn.exe');
  if (CSC) {
    log('Compiling Autumn.exe (launcher)');
    run(CSC, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${path.join(SRC, 'assets', 'icon.ico')}`, `/out:${launcher}`, '/r:System.Windows.Forms.dll', path.join(SRC, 'launcher', 'Launcher.cs')]);
  } else {
    log('C# compiler not found — creating a shortcut instead of the launcher');
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${path.join(home, 'Autumn.lnk').replace(/'/g, "''")}');$s.TargetPath='${path.join(appDir, 'Autumn.exe').replace(/'/g, "''")}';$s.WorkingDirectory='${home.replace(/'/g, "''")}';$s.Save()`;
    run('powershell.exe', ['-NoProfile', '-Command', ps]);
  }
  clean(stage); clean(out);
  log('Done');
  console.log(`\n  ${launcher}\n  ${path.join(home, 'WorkFlow')}  ← your projects\n  ${appDir}  ← runtime (Electron)\n`);
  if (!process.argv.includes('--no-open') && process.platform === 'win32') spawn('explorer.exe', [home], { detached: true, stdio: 'ignore' }).unref();
  return home;
}

/* ---------------------------------------------------------------- portable: one Autumn.exe */
/** Builds the app, zips it and embeds the zip in a small launcher (launcher/Portable.cs). The result is a single Autumn.exe:
 *  the first start unpacks the app into %LOCALAPPDATA%\Autumn\app, projects go to Documents\Autumn\WorkFlow. */
async function portable() {
  if (!CSC) throw new Error('The C# compiler of the .NET Framework was not found (it comes with Windows).');
  const dest = path.resolve(argVal('out') || path.join(SRC, 'dist', 'Autumn.exe'));
  const work = path.join(BUILD, 'portable');
  clean(work);
  if (!process.argv.includes('--no-open')) process.argv.push('--no-open');
  process.argv = process.argv.filter(a => !a.startsWith('--out='));
  process.argv.push('--out=' + path.join(work, 'Autumn'));
  const home = await build();
  const zip = path.join(work, 'app.zip');
  log('Packing the app into one file');
  run(WIN_TAR, ['-a', '-c', '-f', zip, '-C', path.join(home, 'app'), '.']);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  run(CSC, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${path.join(SRC, 'assets', 'icon.ico')}`, `/out:${dest}`,
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
    `/resource:${zip},Autumn.app.zip`, path.join(SRC, 'launcher', 'Portable.cs')]);
  clean(work);
  log(`Done: ${dest} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
}

/* ---------------------------------------------------------------- dev / capture */
/** An unpacked Electron for running from source: %LOCALAPPDATA%\Autumn-build\electron-dev */
function devElectron() {
  const dev = path.join(BUILD, 'electron-dev'), exe = path.join(dev, 'electron.exe');
  if (fs.existsSync(exe)) return exe;
  const zipDir = electronZipDir();
  if (!zipDir) throw new Error(`Run "node scripts/build.js" once first (it downloads Electron), or set ELECTRON_ZIP_DIR to a folder with ${ELECTRON_ZIP}.`);
  fs.mkdirSync(dev, { recursive: true });
  run(WIN_TAR, ['-x', '-f', path.join(zipDir, ELECTRON_ZIP), '-C', dev]);
  return exe;
}
function dev(extra = []) {
  ensurePackager();
  require('./i18n').apply('ko', path.join(SRC, 'src-ko'));   // so View › Language › 한국어 works from source too
  const r = spawnSync(devElectron(), [SRC, ...extra], { stdio: 'inherit' });
  process.exit(r.status || 0);
}

(async () => {
  const what = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'build';
  if (what === 'dev') return dev(process.argv.slice(3));
  if (what === 'capture') return dev([`--capture=${path.resolve(process.argv[3] || 'autumn.png')}`, ...process.argv.slice(4)]);
  if (what === 'manual') { const r = spawnSync(devElectron(), [path.join(__dirname, 'make-manual.js'), path.resolve(process.argv[3] || path.join(SRC, 'docs', 'manual-ko.html')), path.resolve(process.argv[4] || path.join(SRC, 'docs', 'manual-ko.pdf'))], { stdio: 'inherit' }); process.exit(r.status || 0); }
  if (what === 'build') return build();
  if (what === 'portable') return portable();
  throw new Error('Unknown command: ' + what);
})().catch(e => { console.error('\x1b[31m[autumn] ' + e.message + '\x1b[0m'); process.exit(1); });
