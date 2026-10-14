// Autumn — project file model used by the MCP server (load / save / find / place). No dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
// The same catalog, field logic and plan generator as the editor — in the language the app shows (src-ko/ for Korean)
const UI = (() => {
  let lang = null;
  try { const st = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Autumn', 'state.json'), 'utf8')); lang = st.uiLang || st.lang; } catch (_) {}
  if (!lang) try { lang = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).autumnLang; } catch (_) {}
  if (process.env.AUTUMN_LANG) lang = process.env.AUTUMN_LANG;
  return lang === 'ko' && fs.existsSync(path.join(__dirname, '..', 'src-ko', 'spec.js')) ? '../src-ko/' : '../src/';
})();
const Catalog = require(UI + 'catalog.js');
const Fields = require(UI + 'fields.js');
const Spec = require(UI + 'spec.js');
const { TYPES, LINK_TYPES, STATUS, SPEC_FIELDS, AI_FIELDS, GUIDE_FIELDS, AI_TYPES, isAiNode } = Catalog;

const uid = (p = 'n') => p + Math.random().toString(36).slice(2, 8) + (Date.now() % 1e6).toString(36);

/* ---------------------------------------------------------------- where things are */
function stateFile() { return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Autumn', 'state.json'); }
function readState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (_) { return {}; } }
/** WorkFlow folder: from the app's state, else next to this server (<home>\app\resources\app\mcp or <home>\Source\mcp) */
function workflowDir() {
  if (process.env.AUTUMN_WORKFLOW) return path.resolve(process.env.AUTUMN_WORKFLOW);
  const st = readState(); if (st.workflow) return st.workflow;
  const up = n => path.resolve(__dirname, ...Array(n).fill('..'));
  for (const home of [up(4), up(2)]) if (fs.existsSync(path.join(home, 'WorkFlow'))) return path.join(home, 'WorkFlow');
  return path.join(os.homedir(), 'Desktop', 'Autumn', 'WorkFlow');
}
/** The target chosen in this MCP session (autumn_open / autumn_new_project) */
let target = null;
function setTarget(f) { target = f ? path.resolve(f) : null; }
/** A file argument: absolute path · path relative to WorkFlow · bare project name ("Todo App" → WorkFlow\Todo App.autumn.json) */
function resolveArg(arg) {
  const s = String(arg).trim().replace(/^["']|["']$/g, '');
  if (path.isAbsolute(s)) return s;
  const wf = workflowDir(), cands = [path.join(wf, s), path.join(wf, s + '.autumn.json'), path.join(wf, s + '.json'), path.resolve(s)];
  const hit = cands.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
  if (hit) return hit;
  const lower = s.toLowerCase();   // case-insensitive name match inside WorkFlow
  try { const f = fs.readdirSync(wf).find(x => x.toLowerCase().replace(/\.autumn\.json$|\.json$/, '') === lower.replace(/\.autumn\.json$|\.json$/, '')); if (f) return path.join(wf, f); } catch (_) {}
  return path.join(wf, /\.json$/i.test(s) ? s : s + '.autumn.json');
}
function resolveFile(arg) {
  if (arg && String(arg).trim()) return resolveArg(arg);
  if (target) return target;
  if (process.env.AUTUMN_FILE) return resolveArg(process.env.AUTUMN_FILE);
  const st = readState(), f = st.currentFile || st.lastFile;
  if (f) return f;
  throw new Error('No project selected. Pass "file" (a project name in WorkFlow or a path), call autumn_list_projects, or open a project in the Autumn app.');
}
const appRunning = () => { const st = readState(); return !!st.currentFile; };

/* ---------------------------------------------------------------- load / save */
function blankProject(name) {
  const b = { id: uid('b'), name: 'Main board', nodes: [], links: [], groups: [], groupLinks: [], view: { x: 240, y: 160, z: 1 } };
  b.nodes.push(makeNode({ type: 'start', title: name || 'New project', body: '' }, 0, 0));
  b.nodes.push(makeNode({ type: 'aiguide', title: 'AI Rules', body: Catalog.DEFAULT_RULES }, 0, 260));
  b.nodes[1].w = 360;
  return { app: 'autumn', format: 1, name: name || 'New project', active: b.id, boards: [b], templates: Fields.defaultTemplates() };
}
function load(file) {
  if (!fs.existsSync(file)) throw new Error('File not found: ' + file);
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!p || !Array.isArray(p.boards)) throw new Error('Not an Autumn project: ' + file);
  for (const b of p.boards) { b.nodes = b.nodes || []; b.links = b.links || []; b.groups = b.groups || []; b.groupLinks = b.groupLinks || []; }
  return p;
}
function save(file, p) {
  const out = { app: 'autumn', format: 1, name: p.name, active: p.active, boards: p.boards };
  if (p.templates) out.templates = p.templates;
  const text = JSON.stringify(out, null, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-mcp';
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, text, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
function listProjects() {
  const wf = workflowDir();
  try {
    return fs.readdirSync(wf).filter(f => /\.json$/i.test(f) && !/\.tmp-/.test(f)).map(f => {
      const file = path.join(wf, f), st = fs.statSync(file);
      let name = f, nodes = 0; try { const p = JSON.parse(fs.readFileSync(file, 'utf8')); name = p.name || f; nodes = (p.boards || []).reduce((a, b) => a + (b.nodes || []).length, 0); } catch (_) {}
      return { file, name, nodes, mtime: st.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch (_) { return []; }
}

/* ---------------------------------------------------------------- lookup */
function findBoard(p, ref) {
  if (!ref) return p.boards.find(b => b.id === p.active) || p.boards[0];
  const r = String(ref).toLowerCase();
  const b = p.boards.find(x => x.id === ref) || p.boards.find(x => x.name.toLowerCase() === r) || p.boards.find(x => x.name.toLowerCase().includes(r));
  if (!b) throw new Error(`Board not found: ${ref} (boards: ${p.boards.map(x => x.name).join(', ')})`);
  return b;
}
function findNode(b, ref) {
  if (!ref) throw new Error('Empty node reference');
  const byId = b.nodes.find(n => n.id === ref);
  if (byId) return byId;
  const r = String(ref).trim().toLowerCase();
  const exact = b.nodes.filter(n => (n.title || '').trim().toLowerCase() === r);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`Several nodes are titled "${ref}" — use an id: ${exact.map(n => n.id).join(', ')}`);
  const part = b.nodes.filter(n => (n.title || '').toLowerCase().includes(r));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new Error(`"${ref}" matches several nodes: ${part.map(n => `${n.title} (${n.id})`).join(', ')}`);
  throw new Error(`Node not found: ${ref}`);
}
function findPort(n, ref) {
  if (!n.outputs || !n.outputs.length) throw new Error(`"${n.title}" has no output port`);
  if (ref === undefined || ref === null || ref === '') return n.outputs[0];
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) { const o = n.outputs[Number(ref)]; if (o) return o; }
  const r = String(ref).toLowerCase();
  const o = n.outputs.find(x => x.id === ref) || n.outputs.find(x => (x.label || '').toLowerCase() === r) || n.outputs.find(x => (x.label || '').toLowerCase().includes(r));
  if (!o) throw new Error(`"${n.title}" has no port "${ref}" (ports: ${n.outputs.map(x => x.label).join(', ')})`);
  return o;
}
function findGroup(b, ref) {
  const r = String(ref || '').trim().replace(/^group\s*:\s*/i, '').toLowerCase();
  const g = b.groups.find(x => x.id === ref || x.id === r) || b.groups.find(x => (x.title || '').trim().toLowerCase() === r);
  if (g) return g;
  const part = b.groups.filter(x => (x.title || '').toLowerCase().includes(r));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new Error(`"${ref}" matches several groups: ${part.map(x => `${x.title} (${x.id})`).join(', ')}`);
  throw new Error(`Group not found: ${ref} (groups: ${b.groups.map(x => x.title).join(', ') || 'none'})`);
}
/** A link end: "group:Name" is a group, anything else a node (falls back to a group with that name) */
function findEnd(b, ref) {
  if (/^group\s*:/i.test(String(ref))) return { group: findGroup(b, ref) };
  try { return { node: findNode(b, ref) }; }
  catch (e) { try { return { group: findGroup(b, ref) }; } catch (_) { throw e; } }
}
const membersOf = (b, g) => Spec.membersOf(b, g);

/* ---------------------------------------------------------------- nodes & links */
const cleanStr = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k]) r[k] = String(o[k]); return r; };
const cleanAi = a => cleanStr(a, AI_FIELDS.map(f => f.k));
function cleanSpec(s) { const o = {}; for (const [k, v] of Object.entries(s || {})) if (v != null && v !== '' && /^[\w-]{1,40}$/.test(k)) o[k] = String(v); return o; }
function makeNode(spec, x, y) {
  const type = TYPES[spec.type] ? spec.type : 'note', t = TYPES[type];
  const outs = Array.isArray(spec.outputs) && spec.outputs.length ? spec.outputs : t.outs;
  const n = {
    id: uid('n'), type, x: Math.round(x), y: Math.round(y), w: 250,
    title: spec.title || 'New ' + t.name, body: spec.body || '', tags: Array.isArray(spec.tags) ? spec.tags.map(String) : [],
    status: STATUS[spec.status] ? spec.status : 'idea', color: null, collapsed: false,
    outputs: outs.map(l => ({ id: uid('p'), label: String(l) })), images: [], data: [], boardRef: null,
  };
  if (AI_TYPES.has(type) || spec.ai) n.ai = cleanAi(spec.ai);
  if (SPEC_FIELDS[type] || spec.spec) n.spec = cleanSpec(spec.spec);
  return n;
}
/** Automatic link type from the two node kinds (same rules as the editor) */
function autoLinkType(a, c) {
  if (isAiNode(a) || isAiNode(c)) return 'ai';
  if (a.type === 'character' && c.type === 'character') return 'relation';
  if (a.type === 'data' || (Catalog.CODE_TYPES.has(a.type) && Catalog.CODE_TYPES.has(c.type) && a.type !== 'test' && a.type !== 'bug')) return 'uses';
  if (a.type === 'item') return 'require';
  if (['lore', 'note', 'doc'].includes(a.type)) return 'ref';
  if (a.type === 'character' || a.type === 'location') return 'relation';
  return 'flow';
}
function addLink(b, from, port, to, type, label) {
  if (from.id === to.id) throw new Error('A node cannot link to itself');
  if (b.links.some(l => l.from.node === from.id && l.from.port === port.id && l.to.node === to.id)) return null;
  const l = { id: uid('l'), from: { node: from.id, port: port.id }, to: { node: to.id }, type: LINK_TYPES[type] ? type : autoLinkType(from, to), label: label || '' };
  b.links.push(l); return l;
}
/** A link with a group on at least one end (board.groupLinks) */
function addGroupLink(b, from, port, to, type, label) {
  const key = e => e.group ? 'g:' + e.group.id : e.node.id;
  if (key(from) === key(to)) throw new Error('A node cannot link to itself');
  const f = from.group ? { group: from.group.id } : { node: from.node.id, port: port.id }, t = to.group ? { group: to.group.id } : { node: to.node.id };
  if (b.groupLinks.some(l => (l.from.group || l.from.node) === (f.group || f.node) && (l.from.port || '') === (f.port || '') && (l.to.group || l.to.node) === (t.group || t.node))) return null;
  const def = isAiNode(from.node) || isAiNode(to.node) ? 'ai' : ['lore', 'note', 'doc'].includes(from.node?.type) ? 'ref' : 'relation';
  const l = { id: uid('l'), from: f, to: t, type: LINK_TYPES[type] ? type : def, label: label || '' };
  b.groupLinks.push(l); return l;
}
const estH = n => n.h && !n.collapsed ? n.h : 72 + Math.min(10, (n.body || '').split('\n').length) * 19 + Object.keys(n.spec || {}).length * 20 + (n.outputs || []).length * 21 + (n.tags && n.tags.length ? 24 : 0);
/** A free spot: right of `after` (stacking below its siblings), else below everything */
function placeNode(b, after) {
  if (after) {
    const x = after.x + (after.w || 250) + 90;
    const siblings = b.nodes.filter(n => n !== after && Math.abs(n.x - x) < 60);
    let y = after.y;
    const taken = siblings.map(n => [n.y, n.y + estH(n)]);
    for (let guard = 0; guard < 50; guard++) {
      const hit = taken.find(([a, c]) => y < c + 30 && y + 140 > a - 30);
      if (!hit) break; y = hit[1] + 40;
    }
    return { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
  }
  if (!b.nodes.length) return { x: 0, y: 0 };
  const maxY = Math.max(...b.nodes.map(n => n.y + estH(n)), ...(b.groups || []).map(g => g.y + g.h));   // never inside a group frame
  const minX = Math.min(...b.nodes.map(n => n.x));
  return { x: Math.round(minX / 10) * 10, y: Math.round((maxY + 80) / 10) * 10 };
}

/* ---------------------------------------------------------------- groups */
function groupsInside(b, g) { return b.groups.filter(a => a !== g && a.x >= g.x && a.y >= g.y && a.x + a.w <= g.x + g.w && a.y + a.h <= g.y + g.h); }
/** A spot for a frame of g's size that overlaps no group or node: right → below → bottom of the board (same rule as the app) */
function freeSpot(b, g, gap = 60) {
  const boxes = b.groups.map(x => ({ x1: x.x, y1: x.y, x2: x.x + x.w, y2: x.y + x.h }))
    .concat(b.nodes.map(n => ({ x1: n.x, y1: n.y, x2: n.x + (n.w || 250), y2: n.y + estH(n) })));
  const free = (x, y) => !boxes.some(r => x < r.x2 + gap / 2 && x + g.w > r.x1 - gap / 2 && y < r.y2 + gap / 2 && y + g.h > r.y1 - gap / 2);
  const snap = v => Math.round(v / 10) * 10;
  for (const p of [{ x: g.x + g.w + gap, y: g.y }, { x: g.x, y: g.y + g.h + gap }]) if (free(p.x, p.y)) return { x: snap(p.x), y: snap(p.y) };
  return { x: snap(g.x), y: snap(Math.max(...boxes.map(r => r.y2)) + gap) };
}
/** Duplicate a whole group: frame, nodes inside, nested groups, links between them. Links to the outside are not copied. */
function duplicateGroup(b, g, title) {
  const ns = membersOf(b, g), gs = [g, ...groupsInside(b, g)];
  const spot = freeSpot(b, g), dx = spot.x - g.x, dy = spot.y - g.y;
  const nmap = new Map(), pmap = new Map(), gmap = new Map();
  const links0 = b.links.slice(), glinks0 = b.groupLinks.slice();
  for (const n of ns) {
    const c = JSON.parse(JSON.stringify(n)); c.id = uid('n'); nmap.set(n.id, c.id);
    c.outputs = (c.outputs || []).map(o => { const id = uid('p'); pmap.set(o.id, id); return { ...o, id }; });
    c.x = n.x + dx; c.y = n.y + dy; b.nodes.push(c);
  }
  for (const x of gs) { const c = { ...x, id: uid('g'), x: x.x + dx, y: x.y + dy }; if (x === g && title) c.title = String(title); gmap.set(x.id, c.id); b.groups.push(c); }
  const end = e => {
    if (e.group) return gmap.has(e.group) ? { group: gmap.get(e.group) } : null;
    if (!nmap.has(e.node)) return null;
    const o = { ...e, node: nmap.get(e.node) };
    if (e.port) o.port = pmap.get(e.port);
    if (e.at) { if (pmap.has(e.at)) o.at = pmap.get(e.at); else delete o.at; }
    return o;
  };
  let links = 0;
  for (const l of links0) { const from = end(l.from), to = end(l.to); if (from && to && from.node && to.node) { b.links.push({ ...l, id: uid('l'), from, to }); links++; } }
  for (const l of glinks0) { const from = end(l.from), to = end(l.to); if (from && to) { b.groupLinks.push({ ...l, id: uid('l'), from, to }); links++; } }
  return { group: b.groups.find(x => x.id === gmap.get(g.id)), nodes: ns.length, groups: gs.length - 1, links };
}

/* ---------------------------------------------------------------- groups */
const GROUP_COLORS = ['#b8432f', '#d0692e', '#d4a13a', '#8a9a3a', '#4f8a5b', '#3a8a8a', '#3f6fae', '#6a55b0', '#a8458f', '#7a6a5e'];   // the editor's palette
const snap10 = v => Math.round(v / 10) * 10;
const groupColor = (b, c) => /^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : GROUP_COLORS[(b.groups.length * 3 + 5) % GROUP_COLORS.length];
/** A node belongs to a group when its title bar lies inside the frame (same rule as the editor and the build plan) */
const inFrame = (n, g) => { const cx = n.x + (n.w || 250) / 2, cy = n.y + 15; return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h; };
const hitsFrame = (n, g) => n.x < g.x + g.w && n.x + (n.w || 250) > g.x && n.y < g.y + g.h && n.y + estH(n) > g.y;
const overlaps = (a, c) => a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y;
const contains = (a, c) => c.x >= a.x && c.y >= a.y && c.x + c.w <= a.x + a.w && c.y + c.h <= a.y + a.h;
/** Frame around nodes (and nested group frames) with the editor's margins: 30 at the sides, room for the title bar on top */
function frameAround(ns, inner = []) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of ns) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + (n.w || 250)); y2 = Math.max(y2, n.y + estH(n)); }
  for (const g of inner) { x1 = Math.min(x1, g.x); y1 = Math.min(y1, g.y); x2 = Math.max(x2, g.x + g.w); y2 = Math.max(y2, g.y + g.h); }
  return { x: snap10(x1 - 30), y: snap10(y1 - 64), w: snap10(x2 - x1 + 60), h: snap10(y2 - y1 + 94) };
}
/** Move nodes into a tidy grid (reading order kept): where they were if that spot is free, otherwise below everything */
function arrangeNodes(b, ns) {
  const order = [...ns].sort((a, c) => a.y - c.y || a.x - c.x);
  const cols = Math.ceil(Math.sqrt(order.length)), cw = Math.max(...order.map(n => n.w || 250)) + 60, rel = [];
  for (let i = 0, y = 0; i < order.length; i += cols) {
    const row = order.slice(i, i + cols);
    row.forEach((n, j) => rel.push([n, j * cw, y]));
    y += Math.max(...row.map(estH)) + 50;
  }
  const others = b.nodes.filter(n => !ns.includes(n));
  const place = (ax, ay) => { for (const [n, dx, dy] of rel) { n.x = snap10(ax + dx); n.y = snap10(ay + dy); } return frameAround(ns); };
  let f = place(Math.min(...ns.map(n => n.x)), Math.min(...ns.map(n => n.y)));
  if (others.some(o => hitsFrame(o, f)) || b.groups.some(g => overlaps(g, f) && !contains(g, f))) {
    const bottoms = others.map(n => n.y + estH(n)).concat(b.groups.map(g => g.y + g.h));
    f = place((others.length ? Math.min(...others.map(n => n.x)) : 0) + 30, (bottoms.length ? Math.max(...bottoms) : 0) + 140);
  }
  return f;
}
/** The frame for a group of these nodes. Other nodes must not end up inside it (membership is by position) unless listed in "ignore". */
function frameNodes(b, ns, { arrange = false, inner = [], ignore = new Set() } = {}) {
  if (!ns.length) throw new Error('A group needs at least one node');
  if (arrange && inner.length) throw new Error('arrange cannot move nested groups — leave arrange off, or move the nested groups out first');
  const f = arrange ? arrangeNodes(b, ns) : frameAround(ns, inner);
  const extra = b.nodes.filter(n => !ns.includes(n) && !ignore.has(n) && inFrame(n, f));
  if (extra.length) throw new Error(`The frame around these nodes would also take in ${extra.map(n => '"' + n.title + '"').join(', ')} — a group contains whatever lies inside its frame. Add those nodes too, or pass arrange: true to move the listed nodes into a tidy block first.`);
  return f;
}

/* ---------------------------------------------------------------- result → issue */
/** Fixes for a wrong result go into an Issue node next to the Result node (made once, then updated); a passing result marks it done */
function resultIssue(b, node, fixes) {
  let issue = b.links.filter(l => l.from.node === node.id).map(l => b.nodes.find(x => x.id === l.to.node)).find(x => x && x.type === 'bug');
  if (!fixes.length) { if (issue && issue.status !== 'done') { issue.status = 'done'; return { text: `Issue "${issue.title}" marked done` }; } return null; }
  let made = false;
  if (!issue) {
    const pos = placeNode(b, node);
    issue = makeNode({ type: 'bug', title: 'Fix: ' + (node.title || 'Result') }, pos.x, pos.y);
    issue.w = 280;
    b.nodes.push(issue);
    const port = node.outputs[node.outputs.length - 1];
    if (port) b.links.push({ id: uid('l'), from: { node: node.id, port: port.id }, to: { node: issue.id }, type: 'cause', label: '' });
    made = true;
  }
  issue.body = fixes.join('\n');
  issue.status = 'idea';
  return { text: `fixes ${made ? 'written to a new' : 'updated in the'} Issue node "${issue.title}" (id ${issue.id})` };
}

/* ---------------------------------------------------------------- images */
const ASSET_DIR = 'autumn-assets';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };
/** Width, height and format from the file header (no libraries) */
function imageSize(buf) {
  if (buf.length < 30) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: 'image/png' };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), mime: 'image/gif' };
  if (buf.toString('ascii', 0, 2) === 'BM') return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)), mime: 'image/bmp' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, mime: 'image/webp' };
    if (fmt === 'VP8L') { const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]; return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)), mime: 'image/webp' }; }
    if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), mime: 'image/webp' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {   // JPEG: find the SOFn marker
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), mime: 'image/jpeg' };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
/** Copy an image file unchanged into autumn-assets next to the project and return the node image record */
function importImage(projectFile, src, caption) {
  const abs = path.resolve(src);
  if (!fs.existsSync(abs)) throw new Error('Image file not found: ' + abs);
  const buf = fs.readFileSync(abs), info = imageSize(buf);
  if (!info) throw new Error('Unsupported image format (png, jpg, gif, webp, bmp): ' + abs);
  const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + EXT[info.mime];
  const dir = path.join(path.dirname(projectFile), ASSET_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, name);
  if (!fs.existsSync(dst)) fs.copyFileSync(abs, dst);
  const im = { id: uid('i'), name: path.basename(abs), w: info.w, h: info.h, bytes: buf.length, mime: info.mime, file: ASSET_DIR + '/' + name };
  if (caption) im.caption = caption;
  return im;
}

/* ---------------------------------------------------------------- text views for the AI */
const typeName = t => (TYPES[t] || TYPES.note).name;
/** Compact, LLM-friendly outline of one board */
function outline(p, b) {
  const byId = new Map(b.nodes.map(n => [n.id, n]));
  const lines = [`# ${p.name} / board: ${b.name}  (${b.nodes.length} nodes, ${b.links.length + b.groupLinks.length} links)`, ''];
  for (const n of b.nodes) {
    lines.push(`## [${typeName(n.type)}] ${n.title}  {id: ${n.id}, type: ${n.type}, status: ${n.status}${n.tags && n.tags.length ? ', tags: ' + n.tags.join(', ') : ''}}`);
    if (n.body) lines.push(n.body.split('\n').map(s => '  ' + s).join('\n'));
    for (const f of SPEC_FIELDS[n.type] || []) if (n.spec && n.spec[f.k]) lines.push(`  ${f.name} (spec.${f.k}): ${n.spec[f.k].replace(/\n/g, ' / ')}`);
    if (n.outputs && n.outputs.length) lines.push('  ports: ' + n.outputs.map(o => o.label).join(' | '));
    if (n.data && n.data.length) lines.push('  data: ' + Fields.fieldsSummary(n.data));
    if (n.images && n.images.length) lines.push('  images: ' + n.images.map(i => `${i.name} (${i.w}×${i.h}px${i.caption ? ', "' + i.caption + '"' : ''})`).join(', '));
    if (n.result && n.result.status) { const st = Catalog.RESULT_STATUS[n.result.status] || Catalog.RESULT_STATUS.info; lines.push(`  result: ${st.icon} ${st.name}${n.result.value ? ' — ' + n.result.value : ''} (by ${n.result.by || 'AI'}${n.result.at ? ', ' + n.result.at.slice(0, 16).replace('T', ' ') : ''})`); if (n.result.output) lines.push('  output: ' + n.result.output.slice(0, 600).replace(/\n/g, ' / ')); if (n.result.note) lines.push('  note: ' + n.result.note); }
    if (n.ai) for (const f of n.type === 'aiguide' ? GUIDE_FIELDS : AI_FIELDS) if (n.ai[f.k]) lines.push(`  ${f.name} (ai.${f.k}): ${n.ai[f.k].replace(/\n/g, ' / ')}`);
    for (const l of b.links.filter(l => l.from.node === n.id)) {
      const port = (n.outputs || []).find(o => o.id === l.from.port), t = byId.get(l.to.node);
      lines.push(`  → (${l.type}${port ? ' · ' + port.label : ''}${l.label ? ' · "' + l.label + '"' : ''}) ${t ? t.title : l.to.node}  {link: ${l.id}}`);
    }
    lines.push('');
  }
  const gtitle = id => (b.groups.find(g => g.id === id) || {}).title || id;
  for (const g of b.groups) lines.push(`## [Group] ${g.title}  {group: ${g.id}}`, '  nodes inside: ' + (membersOf(b, g).map(n => n.title).join(', ') || 'none'), '');
  if (b.groupLinks.length) {
    lines.push('## Group links (a group end stands for every node inside it)');
    for (const l of b.groupLinks) {
      const end = e => e.group ? '[Group] ' + gtitle(e.group) : (byId.get(e.node) || {}).title || e.node;
      lines.push(`  ${end(l.from)} → (${l.type}${l.label ? ' · "' + l.label + '"' : ''}) ${end(l.to)}  {link: ${l.id}}`);
    }
  }
  return lines.join('\n');
}
/** AI Rules of the whole project (all boards) */
function guides(p) { const out = []; for (const b of p.boards) for (const n of b.nodes) if (n.type === 'aiguide') out.push({ board: b, node: n }); return out; }
function guideText(p) {
  const gs = guides(p);
  if (!gs.length) return '';
  const lines = ['# ⚠ AI Rules — apply to every AI task in this project',
    'Follow these whenever you write code for this project, create or edit nodes, or generate anything for it. "Always do" goes into everything you produce; "Never do" is never done. Read the must-read references before you start.', ''];
  for (const { board: b, node: n } of gs) {
    lines.push(`## ${n.title || 'AI Rules'}  {board: ${b.name}, id: ${n.id}}`);
    if (n.body) lines.push('Rules:', ...n.body.split('\n').map(s => '  ' + s));
    const a = n.ai || {};
    for (const f of GUIDE_FIELDS) {
      if (!a[f.k]) continue;
      if (f.k === 'refs') lines.push(`${f.name}:`, ...a[f.k].split('\n').map(x => x.trim()).filter(Boolean).map(x => '  - ' + x));
      else lines.push(`${f.name}: ${a[f.k].includes('\n') ? '\n' + a[f.k].split('\n').map(s => '  ' + s).join('\n') : a[f.k]}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
/** Short reminder appended to write-tool results */
function guideReminder(p) {
  const gs = guides(p);
  return gs.length ? `\n\nAI Rules in effect: ${gs.map(g => g.node.title).join(', ')} — follow them for this work too (full text: autumn_ai_rules).` : '';
}

module.exports = {
  Catalog, Fields, Spec, TYPES, LINK_TYPES, STATUS, RESULT_STATUS: Catalog.RESULT_STATUS, SPEC_FIELDS, AI_FIELDS, GUIDE_FIELDS, AI_TYPES,
  uid, stateFile, readState, workflowDir, setTarget, resolveFile, resolveArg, appRunning, listProjects,
  blankProject, load, save, findBoard, findNode, findPort, findGroup, findEnd, membersOf,
  cleanAi, cleanSpec, makeNode, addLink, addGroupLink, placeNode, groupsInside, freeSpot, duplicateGroup,
  groupColor, inFrame, contains, frameNodes, resultIssue,
  imageSize, importImage, outline, guides, guideText, guideReminder,
};
