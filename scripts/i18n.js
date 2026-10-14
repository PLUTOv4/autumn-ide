#!/usr/bin/env node
// Autumn — build-time translation of the user interface.
// English in src/ is the source of truth; other languages are generated from it when the app is built:
//   node scripts/i18n.js apply ko [outDir]   → writes a translated copy of src/ (default: src-ko/)
//   node scripts/i18n.js extract ko          → prints the UI text that i18n/ko.json does not translate yet
//   node scripts/i18n.js check ko            → fails if a template rule in i18n/ko.json no longer matches the source
// i18n/<lang>.json = {
//   "templates": { "<exact template literal from the source, with backticks>": "<translated template>" },   // whole sentences with ${…}
//   "text":      { "English UI text": "번역" }                                                             // exact text pieces
// }
// Only string literals, template literals and index.html text / title / placeholder are touched — never code.
// Strings compared with === / switch cases / object keys are left alone so the program logic cannot change.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const I18N = path.join(__dirname, '..', 'i18n');
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const TOOLS = process.env.AUTUMN_TOOLS || path.join(LOCAL, 'Autumn-build', 'tools');
const JS_FILES = ['app.js', 'catalog.js', 'fields.js', 'spec.js'];
const TEXT_ATTRS = new Set(['title', 'placeholder', 'data-tip', 'data-ph', 'aria-label', 'alt', 'label']);
const S = '\u0001';   // stands for a ${…} expression inside a template

function acorn() {
  try { return require(require.resolve('acorn', { paths: [TOOLS, path.join(__dirname, '..')] })); }
  catch (_) { throw new Error('The JavaScript parser "acorn" is missing — the build installs it, or run: npm install acorn --prefix "' + TOOLS + '"'); }
}

/* ---------------------------------------------------------------- finding UI text */
/** Text pieces of a string: HTML text between tags and the values of text attributes; split at ${…} markers.
 *  Returns [{ a, b, text }] (offsets in `s`, text trimmed). Plain strings without tags are one piece. */
function pieces(s) {
  const out = [];
  const push = (a, b) => {
    for (const part of splitAt(s, a, b)) {
      let x = part[0], y = part[1];
      while (x < y && /\s/.test(s[x])) x++;
      while (y > x && /\s/.test(s[y - 1])) y--;
      if (y > x && /[A-Za-z]{2,}/.test(s.slice(x, y))) out.push({ a: x, b: y, text: s.slice(x, y) });
    }
  };
  if (!/<[a-zA-Z/!]/.test(s)) { push(0, s.length); return out; }
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const textEnd = lt < 0 ? s.length : lt;
    if (textEnd > i) push(i, textEnd);
    if (lt < 0) break;
    const gt = findTagEnd(s, lt);
    // attributes inside the tag
    const tag = s.slice(lt, gt), re = /([a-zA-Z-]+)\s*=\s*(["'])([^"']*?)\2/g;
    let m;
    while ((m = re.exec(tag))) if (TEXT_ATTRS.has(m[1].toLowerCase())) { const vs = lt + m.index + m[0].indexOf(m[2]) + 1; push(vs, vs + m[3].length); }
    i = gt;
  }
  return out;
}
function findTagEnd(s, lt) { let q = null; for (let j = lt + 1; j < s.length; j++) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return j + 1; } return s.length; }
function splitAt(s, a, b) { const parts = []; let x = a; for (let j = a; j < b; j++) if (s[j] === S) { parts.push([x, j]); x = j + 1; } parts.push([x, b]); return parts; }

const COMPARE = new Set(['===', '!==', '==', '!=']);
/** Every translatable literal of a JS file: { kind: 'str'|'tpl', node, parent } */
function literals(code) {
  const ast = acorn().parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const found = [];
  (function walk(n, parent) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'string') {
      const skip = (parent && parent.type === 'BinaryExpression' && COMPARE.has(parent.operator)) || (parent && parent.type === 'SwitchCase' && parent.test === n)
        || (parent && parent.type === 'Property' && parent.key === n) || (parent && parent.type === 'MemberExpression' && parent.property === n)
        || (parent && parent.type === 'ExpressionStatement');   // 'use strict'
      if (!skip) found.push({ kind: 'str', node: n });
    }
    if (n.type === 'TemplateLiteral') found.push({ kind: 'tpl', node: n });
    for (const k of Object.keys(n)) {
      if (k === 'parent') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n);
    }
  })(ast, null);
  return found;
}
/** For a template literal: the combined raw text (expressions → marker) and a map back to source offsets */
function templateText(code, node) {
  let text = '', map = [];
  node.quasis.forEach((q, i) => {
    for (let j = q.start; j < q.end; j++) { text += code[j]; map.push(j); }
    if (i < node.quasis.length - 1) { text += S; map.push(-1); }
  });
  return { text, map };
}

/* ---------------------------------------------------------------- apply */
function escapeFor(quote, s) { return quote === '`' ? s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : s.split(quote).join('\\' + quote); }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Key of a template literal in "templates": its raw text with each ${…} written as {0}, {1}, … */
const tplKey = node => node.quasis.map((q, i) => q.value.raw + (i < node.expressions.length ? `{${i}}` : '')).join('');
/** Whole-sentence rules. The translation may reorder or drop {n}; it may also contain its own ${…}.
 *  Innermost templates go first, so an outer rule still sees its {n} placeholders. */
function applyTemplateRules(code, rules, stats) {
  for (let guard = 0; guard < 1000; guard++) {
    const hits = literals(code).filter(l => l.kind === 'tpl' && has(rules, tplKey(l.node))).map(l => l.node);
    if (!hits.length) return code;
    const n = hits.sort((a, b) => b.start - a.start)[0], key = tplKey(n);
    const exprs = n.expressions.map(e => code.slice(e.start, e.end));
    const body = rules[key].replace(/\{(\d+)\}/g, (m, i) => exprs[+i] !== undefined ? '${' + exprs[+i] + '}' : m);
    code = code.slice(0, n.start) + '`' + body + '`' + code.slice(n.end);
    stats.templates.add(key);
  }
  throw new Error('template rules do not settle');
}
function translateJs(code, dict, stats) {
  code = applyTemplateRules(code, dict.templates || {}, stats);
  const reps = [], text = dict.text || {};
  for (const { kind, node } of literals(code)) {
    if (kind === 'str') {
      const quote = code[node.start], raw = code.slice(node.start + 1, node.end - 1);
      for (const p of pieces(raw)) if (has(text, p.text)) { reps.push([node.start + 1 + p.a, node.start + 1 + p.b, escapeFor(quote, text[p.text])]); stats.text.add(p.text); }
    } else {
      const { text: t, map } = templateText(code, node);
      for (const p of pieces(t)) if (has(text, p.text)) { reps.push([map[p.a], map[p.b - 1] + 1, escapeFor('`', text[p.text])]); stats.text.add(p.text); }
    }
  }
  reps.sort((x, y) => y[0] - x[0]);
  let out = code;
  for (const [a, b, s] of reps) out = out.slice(0, a) + s + out.slice(b);
  return out;
}
function translateHtml(html, dict, stats) {
  const reps = [];
  for (const p of pieces(html)) if (Object.prototype.hasOwnProperty.call(dict.text || {}, p.text)) { reps.push([p.a, p.b, dict.text[p.text]]); stats.text.add(p.text); }
  reps.sort((x, y) => y[0] - x[0]);
  let out = html;
  for (const [a, b, s] of reps) out = out.slice(0, a) + s + out.slice(b);
  return out.replace('<html lang="en">', `<html lang="${dict.lang || 'en'}">`);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
const loadDict = lang => Object.assign(JSON.parse(fs.readFileSync(path.join(I18N, lang + '.json'), 'utf8')), { lang });
/** Translated copy of a src folder → outDir. Returns how many template rules / text entries were used. */
function apply(lang, outDir, srcDir = SRC) {
  const dict = loadDict(lang), stats = { templates: new Set(), text: new Set() };
  fs.rmSync(outDir, { recursive: true, force: true });
  copyDir(srcDir, outDir);
  for (const f of JS_FILES) fs.writeFileSync(path.join(outDir, f), translateJs(fs.readFileSync(path.join(srcDir, f), 'utf8'), dict, stats));
  fs.writeFileSync(path.join(outDir, 'index.html'), translateHtml(fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8'), dict, stats));
  const unusedTpl = Object.keys(dict.templates || {}).filter(k => !stats.templates.has(k));
  return { templates: stats.templates.size, text: stats.text.size, unusedTemplates: unusedTpl, unusedText: Object.keys(dict.text || {}).filter(k => !stats.text.has(k)) };
}
/** UI text that is not translated yet: [{ text, where }] */
function extract(lang) {
  let dict = { text: {}, templates: {} }; try { dict = loadDict(lang); } catch (_) {}
  const seen = new Map(), add = (t, where) => { if (!dict.text[t] && !seen.has(t)) seen.set(t, where); };
  for (const f of JS_FILES) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8'), lineOf = i => code.slice(0, i).split('\n').length;
    const lits = literals(code), covered = lits.filter(l => l.kind === 'tpl' && has(dict.templates || {}, tplKey(l.node))).map(l => [l.node.start, l.node.end]);
    for (const { kind, node } of lits) {
      if (covered.some(([a, b]) => node.start >= a && node.end <= b)) continue;
      const t = kind === 'str' ? code.slice(node.start + 1, node.end - 1) : templateText(code, node).text;
      for (const p of pieces(t)) if (/[A-Z ]/.test(p.text) || p.text.length > 12) add(p.text, `${f}:${lineOf(node.start)}`);
    }
  }
  for (const p of pieces(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8'))) add(p.text, 'index.html');
  return [...seen].map(([text, where]) => ({ text, where }));
}

module.exports = { apply, extract, pieces };

if (require.main === module) {
  const [cmd, lang = 'ko', out] = process.argv.slice(2);
  if (cmd === 'extract') console.log(JSON.stringify(extract(lang), null, 1));
  else if (cmd === 'apply' || cmd === 'check') {
    const dir = out || path.join(SRC, '..', 'src-' + lang);
    const r = apply(lang, cmd === 'check' ? fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-i18n-')) : dir);
    console.log(`${lang}: ${r.text} text entries · ${r.templates} templates used`);
    if (r.unusedTemplates.length) { console.error('Template rules that no longer match the source:\n' + r.unusedTemplates.map(s => '  ' + s.slice(0, 120)).join('\n')); if (cmd === 'check') process.exit(1); }
    if (r.unusedText.length) console.log(`(${r.unusedText.length} text entries not found in the source)`);
  } else { console.log('usage: node scripts/i18n.js apply|extract|check <lang> [outDir]'); process.exit(1); }
}
