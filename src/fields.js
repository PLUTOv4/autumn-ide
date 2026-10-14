/* Autumn — data fields and objects (templates)
 * Shared by the editor (browser: window.Fields) and the MCP server (Node: require). Pure functions, no DOM.
 *
 *   field    : { id, key, type: 'num'|'range'|'text'|'bool'|'obj', value | min,max | fields }
 *   template : { id, name, desc, fields }   — a reusable bundle of fields ("object")
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Fields = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIELD_TYPES = { num: 'Number', range: 'Range', text: 'Text', bool: 'Yes/No', obj: 'Object' };
  const fid = () => 'f' + Math.random().toString(36).slice(2, 9);
  const toNum = v => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[,\s_]/g, '')); return isFinite(x) ? x : 0; };

  function mkField(key, type = 'num', extra = {}) {
    const f = { id: fid(), key: String(key), type };
    if (type === 'num') f.value = 0; else if (type === 'range') { f.min = 0; f.max = 0; }
    else if (type === 'text') f.value = ''; else if (type === 'bool') f.value = false; else f.fields = [];
    return Object.assign(f, extra);
  }
  function cleanFields(list, depth = 0) {
    if (!Array.isArray(list) || depth > 8) return [];
    return list.filter(f => f && typeof f === 'object').map(f => {
      const type = FIELD_TYPES[f.type] ? f.type : 'num';
      const o = { id: f.id || fid(), key: String(f.key ?? ''), type };
      if (type === 'num') o.value = toNum(f.value);
      else if (type === 'range') { o.min = toNum(f.min); o.max = toNum(f.max); }
      else if (type === 'text') o.value = String(f.value ?? '');
      else if (type === 'bool') o.value = !!f.value;
      else { o.fields = cleanFields(f.fields, depth + 1); if (f.template) o.template = String(f.template); }
      return o;
    });
  }
  function cloneFields(list) { return (list || []).map(f => { const o = { ...f, id: fid() }; if (f.fields) o.fields = cloneFields(f.fields); return o; }); }
  function findField(list, id) {
    for (const f of list || []) { if (f.id === id) return { f, list }; if (f.fields) { const r = findField(f.fields, id); if (r) return r; } }
    return null;
  }
  /** Change a field's type, keeping the value where possible */
  function convertField(f, type) {
    const v = f.type === 'range' ? (f.min + f.max) / 2 : f.type === 'obj' ? 0 : f.value;
    for (const k of ['value', 'min', 'max', 'fields', 'template']) delete f[k];
    f.type = type;
    if (type === 'num') f.value = toNum(v);
    else if (type === 'range') { f.min = toNum(v); f.max = toNum(v); }
    else if (type === 'text') f.value = v === undefined ? '' : String(v);
    else if (type === 'bool') f.value = !!v && v !== '0' && v !== 'false';
    else f.fields = [];
    return f;
  }
  /** Field list → plain object. Ranges become {min, max}. */
  function toPlain(list) {
    const o = {};
    for (const f of list || []) {
      if (!f.key) continue;
      o[f.key] = f.type === 'obj' ? toPlain(f.fields) : f.type === 'range' ? { min: f.min, max: f.max } : f.value;
    }
    return o;
  }
  /** Plain object → field list. "10~20", {min,max} or [a,b] become ranges. (used by MCP) */
  function fromPlain(obj, depth = 0) {
    return Object.entries(obj || {}).map(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v);
        if ('min' in v && 'max' in v && keys.length === 2) return mkField(k, 'range', { min: toNum(v.min), max: toNum(v.max) });
        return mkField(k, 'obj', { fields: depth < 8 ? fromPlain(v, depth + 1) : [] });
      }
      if (Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number')) return mkField(k, 'range', { min: v[0], max: v[1] });
      if (typeof v === 'number') return mkField(k, 'num', { value: v });
      if (typeof v === 'boolean') return mkField(k, 'bool', { value: v });
      const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      const m = s.match(/^\s*(-?[\d,._]+)\s*[~∼〜]\s*(-?[\d,._]+)\s*$/);
      if (m) return mkField(k, 'range', { min: toNum(m[1]), max: toNum(m[2]) });
      if (/^\s*-?[\d,._]+\s*$/.test(s) && !/^0\d/.test(s.trim())) return mkField(k, 'num', { value: toNum(s) });
      return mkField(k, 'text', { value: s });
    });
  }
  /** Same-named fields are replaced (objects are merged recursively); new ones are appended */
  function mergeFields(base, add) {
    const out = cloneFields(base);
    for (const f of add || []) {
      const i = out.findIndex(x => x.key === f.key);
      if (i < 0) out.push(cloneFields([f])[0]);
      else if (out[i].type === 'obj' && f.type === 'obj') out[i].fields = mergeFields(out[i].fields, f.fields);
      else out[i] = { ...cloneFields([f])[0], id: out[i].id };
    }
    return out;
  }
  const fmtNum = x => !isFinite(x) ? '∞' : Number.isInteger(x) ? x.toLocaleString('en-US') : (+x.toFixed(2)).toLocaleString('en-US');
  const fieldText = f => f.type === 'range' ? `${fmtNum(f.min)}~${fmtNum(f.max)}` : f.type === 'num' ? fmtNum(f.value) : f.type === 'bool' ? (f.value ? 'yes' : 'no') : f.type === 'obj' ? `{${f.fields.length}}` : String(f.value);
  /** One-line summary readable by people and AIs */
  function fieldsSummary(list, depth = 0) {
    return (list || []).filter(f => f.key).map(f => f.type === 'obj' ? `${f.key}{${depth < 4 ? fieldsSummary(f.fields, depth + 1) : '…'}}` : `${f.key} ${fieldText(f)}`).join(', ');
  }

  /* ---------------------------------------------------------------- default objects */
  function defaultTemplates() {
    return [
      { id: 't-config', name: 'App config', desc: 'Typical settings of a program', fields: [
        mkField('name', 'text', { value: 'my-app' }), mkField('version', 'text', { value: '0.1.0' }),
        mkField('port', 'num', { value: 3000 }), mkField('debug', 'bool', { value: false })] },
      { id: 't-model', name: 'Data model', desc: 'Fields of a record (value = type or example)', fields: [
        mkField('id', 'text', { value: 'string (uuid)' }), mkField('createdAt', 'text', { value: 'ISO date' }), mkField('updatedAt', 'text', { value: 'ISO date' })] },
      { id: 't-endpoint', name: 'API endpoint', desc: 'Method, path, auth and limits', fields: [
        mkField('method', 'text', { value: 'GET' }), mkField('path', 'text', { value: '/api/items' }),
        mkField('auth', 'bool', { value: true }), mkField('rateLimitPerMin', 'num', { value: 60 })] },
      { id: 't-env', name: 'Environment variable', desc: 'A secret or setting read at runtime — never hard-coded', fields: [
        mkField('name', 'text', { value: 'API_KEY' }), mkField('required', 'bool', { value: true }), mkField('note', 'text', { value: 'set in .env (git-ignored)' })] },
    ];
  }
  function cleanTemplates(list) {
    return (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object')
      .map(t => ({ id: String(t.id || 't' + Math.random().toString(36).slice(2, 8)), name: String(t.name || 'Object'), desc: String(t.desc || ''), fields: cleanFields(t.fields) }));
  }

  return {
    FIELD_TYPES, mkField, cleanFields, cloneFields, findField, convertField, toPlain, fromPlain, mergeFields,
    fmtNum, fieldText, fieldsSummary, toNum, defaultTemplates, cleanTemplates,
  };
});
