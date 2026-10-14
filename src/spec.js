/* Autumn — build plan
 * Turns a project (the .autumn.json data) into a plan an AI can implement, step by step:
 *   planModel(project, opts)  → structured plan (rules, project settings, ordered steps with their prompts, specs and context)
 *   planMarkdown(project, opts) → Markdown for an AI (opts.audience 'ai') or for people ('human')
 *   nodePrompt(project, board, node) → one node as a ready-to-paste prompt
 *   planHtml(project, opts)   → a printable HTML document (used for the PDF export)
 * Shared by the editor (window.Spec) and Node (MCP server, headless PDF). Pure functions, no DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'), require('./fields.js'));
  else root.Spec = factory(root.Catalog, root.Fields);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, F) {
  'use strict';
  const { TYPES, LINK_TYPES, STATUS, SPEC_FIELDS, AI_FIELDS, GUIDE_FIELDS, CHOICE_LINKS, RESULT_STATUS, isAiNode } = C;
  const typeName = n => (TYPES[n.type] || TYPES.note).name;
  const statusName = n => (STATUS[n.status] || STATUS.idea).name;
  const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

  /* ---------------------------------------------------------------- graph helpers */
  /** Group membership is geometric: a node belongs to a group when the centre of its title bar is inside the frame */
  function membersOf(b, g) {
    return (b.nodes || []).filter(n => { const cx = n.x + (n.w || 250) / 2, cy = n.y + 15; return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h; });
  }
  function endIds(b, e) {
    if (e.group) { const g = (b.groups || []).find(x => x.id === e.group); return g ? membersOf(b, g).map(n => n.id) : []; }
    return [e.node];
  }
  /** Flow order: depth-first from the starts along flow · cause · require links (output port order), AI-side nodes excluded */
  function flowOrder(b) {
    const byId = new Map(b.nodes.map(n => [n.id, n]));
    const fl = (b.links || []).filter(l => CHOICE_LINKS.has(l.type) && byId.has(l.from.node) && byId.has(l.to.node) && !isAiNode(byId.get(l.from.node)) && !isAiNode(byId.get(l.to.node)));
    const indeg = new Map(b.nodes.map(n => [n.id, 0]));
    fl.forEach(l => indeg.set(l.to.node, indeg.get(l.to.node) + 1));
    const res = [], seen = new Set();
    const starts = [...b.nodes].sort((a, c) => (a.type === 'start' ? -1 : 0) - (c.type === 'start' ? -1 : 0) || a.x - c.x || a.y - c.y);
    const visit = id => {
      if (seen.has(id)) return; seen.add(id); const n = byId.get(id); res.push(n);
      (n.outputs || []).forEach(o => fl.filter(l => l.from.node === id && l.from.port === o.id).forEach(l => visit(l.to.node)));
    };
    starts.filter(n => indeg.get(n.id) === 0 && fl.some(l => l.from.node === n.id)).forEach(n => visit(n.id));
    starts.forEach(n => { if (!seen.has(n.id) && fl.some(l => l.to.node === n.id || l.from.node === n.id)) visit(n.id); });
    return { flow: res, rest: b.nodes.filter(n => !seen.has(n.id)) };
  }

  /* ---------------------------------------------------------------- context of one node */
  /** Everything linked to a node that the AI should know while working on it (links through groups included) */
  function contextOf(b, n) {
    const byId = new Map(b.nodes.map(x => [x.id, x]));
    const groups = (b.groups || []).filter(g => membersOf(b, g).some(m => m.id === n.id));
    const ctx = { prompts: [], refs: [], requires: [], uses: [], usedBy: [], related: [], next: [], prev: [], groups: groups.map(g => g.title) };
    const add = (list, item) => { if (!list.some(x => x.id === item.id && x.label === item.label)) list.push(item); };
    const here = e => e.node === n.id || !!(e.group && groups.some(g => g.id === e.group));
    const name = e => e.group ? ((b.groups || []).find(g => g.id === e.group) || {}).title || 'group' : (byId.get(e.node) || {}).title || '?';
    for (const l of (b.links || []).concat(b.groupLinks || [])) {
      const out = here(l.from), inn = here(l.to);
      if (out === inn) continue;
      const other = out ? l.to : l.from, on = other.node ? byId.get(other.node) : null;
      const info = { id: other.node || other.group, title: name(other), type: on ? typeName(on) : 'Group', label: l.label || '', link: (LINK_TYPES[l.type] || LINK_TYPES.flow).name, viaGroup: (inn && !!l.to.group) || (out && !!l.from.group) };
      if (on && isAiNode(on)) {   // prompts, AI notes and rules linked here apply to this node
        add(ctx.prompts, { ...info, node: on });
        continue;
      }
      if (on && (on.type === 'doc' || on.type === 'note' || on.type === 'lore') && (l.type === 'ref' || l.type === 'relation' || l.type === 'ai')) { add(ctx.refs, { ...info, node: on }); continue; }
      if (l.type === 'require') add(inn ? ctx.requires : ctx.next, { ...info, port: portName(b, l) });
      else if (l.type === 'uses') add(out ? ctx.uses : ctx.usedBy, info);
      else if (l.type === 'flow' || l.type === 'cause') add(out ? ctx.next : ctx.prev, { ...info, port: portName(b, l) });
      else add(ctx.related, info);
    }
    return ctx;
  }
  function portName(b, l) {
    const n = l.from.node && b.nodes.find(x => x.id === l.from.node);
    return n ? ((n.outputs || []).find(o => o.id === l.from.port) || {}).label || '' : '';
  }

  /* ---------------------------------------------------------------- plan model */
  function guides(p) { const out = []; for (const b of p.boards || []) for (const n of b.nodes || []) if (n.type === 'aiguide') out.push(n); return out; }
  function fieldRows(n) {
    const s = n.spec || {};
    return (SPEC_FIELDS[n.type] || []).filter(f => s[f.k]).map(f => ({ name: f.name, value: String(s[f.k]), mono: !!f.mono, long: !!f.long }));
  }
  function aiRows(n) {
    const a = n.ai || {};
    return (n.type === 'aiguide' ? GUIDE_FIELDS : AI_FIELDS).filter(f => a[f.k]).map(f => ({ name: f.name, value: String(a[f.k]), mono: !!f.mono, list: f.k === 'refs' }));
  }
  /** Programming language nodes that are not linked to anything apply to the whole project */
  function projectLanguage(p) {
    const lang = [], fw = [], style = [];
    for (const b of p.boards || []) for (const n of b.nodes || []) {
      const s = n.spec || {};
      if (n.type !== 'lang' || !s.language) continue;
      if ((b.links || []).concat(b.groupLinks || []).some(l => l.from.node === n.id)) continue;
      lang.push(s.language + (s.version ? ` (${s.version})` : ''));
      if (s.framework) fw.push(s.framework);
      if (s.style) style.push(s.style);
    }
    return { language: lang.join(' / '), framework: fw.join(' / '), codeStyle: style.join('\n') };
  }
  /** Project-wide settings come from the first Start node (body = goal, spec = stack · output · run · constraints) */
  function settings(p) {
    const L = projectLanguage(p);
    for (const b of p.boards || []) for (const n of b.nodes || []) if (n.type === 'start') {
      const s = n.spec || {};
      return { start: n.title, goal: n.body || '', stack: s.stack || '', output: s.output || '', run: s.run || '', constraints: s.constraints || '', ...L };
    }
    return { start: '', goal: '', stack: '', output: '', run: '', constraints: '', ...L };
  }
  function item(b, n, num) {
    const t = TYPES[n.type] || TYPES.note;
    return {
      num, id: n.id, type: n.type, typeName: t.name, color: n.color || t.color, title: n.title || 'Untitled', status: n.status || 'idea', statusName: statusName(n),
      bodyLabel: t.body, body: n.body || '', spec: fieldRows(n), ai: aiRows(n), tags: n.tags || [],
      data: n.data && n.data.length ? F.toPlain(n.data) : null, result: n.result && n.result.status ? n.result : null, images: (n.images || []).map(im => ({ name: im.name, file: im.file, w: im.w, h: im.h, caption: im.caption })),
      ctx: contextOf(b, n),
    };
  }
  function planModel(p, opts = {}) {
    const boards = (p.boards || []).filter(b => !opts.board || b.id === opts.board || b.name === opts.board).map(b => {
      const { flow, rest } = flowOrder(b);
      let k = 0;
      const steps = flow.map(n => item(b, n, ++k));
      const comps = rest.filter(n => !isAiNode(n) && n.type !== 'note' && n.type !== 'doc').map(n => item(b, n));
      const notes = rest.filter(n => ['note', 'doc', 'prompt', 'ainote', 'lang'].includes(n.type)).map(n => item(b, n));
      return { name: b.name, id: b.id, steps, comps, notes, counts: { nodes: b.nodes.length, done: b.nodes.filter(n => n.status === 'done').length } };
    });
    return { name: p.name || 'Project', file: opts.file || '', date: new Date().toISOString().slice(0, 10), rules: guides(p).map(n => ({ title: n.title, body: n.body || '', rows: aiRows(n) })), settings: settings(p), boards };
  }

  /* ---------------------------------------------------------------- Markdown */
  const quote = s => String(s).split('\n').map(x => '> ' + x).join('\n');
  const fence = s => '```\n' + String(s).replace(/```/g, '``​`') + '\n```';
  function itemMd(it, ai) {
    const out = [];
    const head = `${it.num ? it.num + '. ' : ''}[${it.typeName}] ${it.title}`;
    out.push(`### ${head}`, `*${it.statusName}${it.tags.length ? ' · ' + it.tags.map(t => '#' + t).join(' ') : ''}${ai ? ` · id: ${it.id}` : ''}*`, '');
    if (it.body) out.push(`**${it.bodyLabel}**`, '', quote(it.body), '');
    for (const r of it.spec) out.push(r.long || r.value.includes('\n') ? `\n**${r.name}**\n\n${r.mono ? fence(r.value) : r.value}\n` : `- **${r.name}:** ${r.mono ? '`' + r.value + '`' : r.value}`);
    if (it.spec.length && !it.spec[it.spec.length - 1].long) out.push('');
    for (const r of it.ai) out.push(r.list ? `**${r.name}**\n${lines(r.value).map(x => '- ' + x).join('\n')}\n` : r.mono ? `**${r.name}**\n\n${fence(r.value)}\n` : `- **${r.name}:** ${r.value}`);
    if (it.data) out.push('**Data**', '', '```json\n' + JSON.stringify(it.data, null, 2) + '\n```', '');
    if (it.type === 'result' && ai) out.push('**Check point** — when everything that leads here is built, run it and report what you got with `autumn_report_result` (status pass or fail; "predicted" if you could not run it).', '');
    if (it.result) { const st = RESULT_STATUS[it.result.status] || RESULT_STATUS.info; out.push(`- **Last result:** ${st.icon} ${st.name}${it.result.value ? ' — ' + it.result.value : ''}${it.result.at ? ' (' + it.result.at.slice(0, 16).replace('T', ' ') + ')' : ''}`); if (it.result.note) out.push(`- **AI note:** ${it.result.note}`); if (it.result.output) out.push('', fence(it.result.output.slice(0, 1500)), ''); }
    const c = it.ctx;
    if (c.prompts.length) {
      out.push('**Prompts & AI notes for this step**', '');
      for (const pr of c.prompts) {
        const n = pr.node, rows = aiRows(n), spec = fieldRows(n);
        out.push(`- **${pr.title}** (${pr.type}${pr.viaGroup ? ', via group' : ''})${n.body ? ':' : ''}`);
        if (n.body) out.push(quote(n.body).split('\n').map(x => '  ' + x).join('\n'));
        for (const r of spec.concat(rows)) out.push(`  - ${r.name}: ${r.value.replace(/\n/g, ' / ')}`);
      }
      out.push('');
    }
    if (c.refs.length) out.push('**References**', ...c.refs.map(r => `- ${r.title} (${r.type})${r.node.body ? ': ' + r.node.body.replace(/\n/g, ' ').slice(0, 300) : ''}${fieldRows(r.node).map(x => ' · ' + x.value.replace(/\n/g, ' ')).join('')}`), '');
    const list = (label, arr, fmt) => { if (arr.length) out.push(`- **${label}:** ${arr.map(fmt).join(', ')}`); };
    list('Requires (do first)', c.requires, r => `${r.title}${r.label ? ' — ' + r.label : ''}`);
    list('Uses', c.uses, r => `${r.title} (${r.type})${r.label ? ' — ' + r.label : ''}`);
    list('Used by', c.usedBy, r => `${r.title} (${r.type})`);
    list('Comes after', c.prev, r => r.title);
    list('Next', c.next, r => `${r.port ? '[' + r.port + '] ' : ''}${r.title}${r.label ? ' — ' + r.label : ''}`);
    list('Related', c.related, r => `${r.title} (${r.link}${r.label ? ': ' + r.label : ''})`);
    list('In group', c.groups.map(g => ({ title: g })), r => r.title);
    if (it.images.length) out.push(...it.images.map(im => `- Image: ${im.name}${im.w ? ` (${im.w}×${im.h}px)` : ''}${im.file ? ` — ${im.file}` : ''}${im.caption ? ` — ${im.caption}` : ''}`));
    out.push('');
    return out.join('\n');
  }
  function rulesMd(m) {
    if (!m.rules.length) return '';
    const out = ['## ⚠ AI Rules — must be followed in every task', ''];
    for (const r of m.rules) {
      out.push(`### ${r.title}`, '');
      if (r.body) out.push(r.body, '');
      for (const x of r.rows) out.push(x.list ? `**${x.name}**\n${lines(x.value).map(v => '- ' + v).join('\n')}\n` : `**${x.name}**\n\n${x.value}\n`);
    }
    return out.join('\n') + '\n';
  }
  function settingsMd(m) {
    const s = m.settings, rows = [['Goal', s.goal], ['Programming language', s.language], ['Framework / libraries', s.framework], ['Code style', s.codeStyle], ['Tech stack', s.stack], ['Output folder', s.output], ['Run / build', s.run], ['Constraints', s.constraints]].filter(r => r[1]);
    if (!rows.length) return '';
    return '## Project\n\n' + rows.map(([k, v]) => v.includes('\n') ? `**${k}**\n\n${v}\n` : `- **${k}:** ${v}`).join('\n') + '\n\n';
  }
  function planMarkdown(p, opts = {}) {
    const m = planModel(p, opts), ai = opts.audience !== 'human';
    let md = `# ${ai ? 'Build plan — ' : ''}${m.name}\n\n`;
    md += `*Autumn · ${m.date}${m.file ? ' · ' + m.file : ''}*\n\n`;
    if (ai) {
      const out = m.settings.output;
      md += '## How to use this plan\n\n'
        + 'You are building the program described below. People designed it as nodes in Autumn; every node is a prompt or a spec.\n\n'
        + '1. Read the **AI Rules** first and follow them in every step — they override anything else.\n'
        + `2. ${out ? `Write the code into **${out}** (create the folder if it does not exist).` : 'Ask where the code should go if no output folder is given (the Start node has an "Output folder" field).'}${m.settings.language ? ` Write it in **${m.settings.language}** unless a step says otherwise.` : ''}\n`
        + '3. Implement the **steps in order**. Prompts and AI notes listed under a step apply to that step only; "Requires" must be done first.\n'
        + '4. **Components** (modules, functions, APIs, data models, screens) are the parts the steps build or use — keep their paths, signatures and schemas.\n'
        + '5. Never hard-code secrets (API keys, tokens, passwords). Read them from environment variables or a git-ignored config file.\n'
        + '6. If the Autumn MCP server is connected, mark each step done with `autumn_update_node` (status "done") as you finish it, and add an Issue node for anything you could not resolve.\n\n';
    }
    md += rulesMd(m) + settingsMd(m);
    for (const b of m.boards) {
      md += `---\n\n## Board: ${b.name}\n\n`;
      if (b.steps.length) md += `## Steps (in flow order)\n\n` + b.steps.map(it => itemMd(it, ai)).join('\n');
      if (b.comps.length) md += `## Components & references\n\n` + b.comps.map(it => itemMd(it, ai)).join('\n');
      if (b.notes.length) md += `## Notes, docs & loose prompts\n\n` + b.notes.map(it => itemMd(it, ai)).join('\n');
      if (!b.steps.length && !b.comps.length && !b.notes.length) md += '*(empty board)*\n\n';
    }
    return md.replace(/\n{3,}/g, '\n\n');
  }
  /** One node as a self-contained prompt (with project settings and AI Rules) */
  function nodePrompt(p, b, n) {
    const m = { name: p.name, rules: guides(p).map(g => ({ title: g.title, body: g.body || '', rows: aiRows(g) })), settings: settings(p) };
    const it = item(b, n);
    return `# Task: ${it.title} (${it.typeName}) — project “${m.name}”\n\n` + rulesMd(m) + settingsMd(m) + '## This step\n\n' + itemMd(it, false);
  }

  /* ---------------------------------------------------------------- HTML (printable, used for PDF) */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const para = s => esc(s).replace(/\n/g, '<br>');
  function itemHtml(it) {
    const c = it.ctx, chips = [];
    const row = (label, arr, fmt) => arr.length ? `<div class="kv"><b>${label}</b><span>${arr.map(fmt).join(', ')}</span></div>` : '';
    return `<section class="item" style="--c:${esc(it.color)}">
      <div class="ih"><span class="chip">${esc(it.typeName)}</span><h3>${it.num ? `<i>${it.num}</i>` : ''}${esc(it.title)}</h3><span class="st st-${esc(it.status)}">${esc(it.statusName)}</span></div>
      ${it.body ? `<div class="body"><div class="lbl">${esc(it.bodyLabel)}</div><div class="${it.bodyLabel === C.P ? 'prompt' : ''}">${para(it.body)}</div></div>` : ''}
      ${it.spec.map(r => `<div class="kv"><b>${esc(r.name)}</b>${r.mono ? `<code>${para(r.value)}</code>` : `<span>${para(r.value)}</span>`}</div>`).join('')}
      ${it.ai.map(r => `<div class="kv"><b>${esc(r.name)}</b>${r.mono ? `<code>${para(r.value)}</code>` : `<span>${para(r.value)}</span>`}</div>`).join('')}
      ${it.data ? `<div class="kv"><b>Data</b><code>${esc(JSON.stringify(it.data, null, 2))}</code></div>` : ''}
      ${it.result ? `<div class="kv"><b>Last result</b><span><b style="color:${(RESULT_STATUS[it.result.status] || RESULT_STATUS.info).color}">${(RESULT_STATUS[it.result.status] || RESULT_STATUS.info).icon} ${(RESULT_STATUS[it.result.status] || RESULT_STATUS.info).name}</b>${it.result.value ? ' — ' + esc(it.result.value) : ''}</span></div>${it.result.output ? `<code>${esc(it.result.output.slice(0, 1500))}</code>` : ''}` : ''}
      ${c.prompts.length ? `<div class="ctx"><div class="lbl">Prompts &amp; AI notes</div>${c.prompts.map(pr => `<div class="pr"><b>${esc(pr.title)}</b> <small>${esc(pr.type)}${pr.viaGroup ? ' · via group' : ''}</small>${pr.node.body ? `<div>${para(pr.node.body)}</div>` : ''}${fieldRows(pr.node).concat(aiRows(pr.node)).map(r => `<div class="sub">${esc(r.name)}: ${para(r.value)}</div>`).join('')}</div>`).join('')}</div>` : ''}
      ${row('References', c.refs, r => esc(r.title))}${row('Requires', c.requires, r => esc(r.title))}${row('Uses', c.uses, r => esc(r.title))}${row('Used by', c.usedBy, r => esc(r.title))}
      ${row('Next', c.next, r => (r.port ? `<em>${esc(r.port)}</em> → ` : '→ ') + esc(r.title))}${row('Related', c.related, r => esc(r.title))}
      ${it.tags.length ? `<div class="tags">${it.tags.map(t => '#' + esc(t)).join(' ')}</div>` : ''}${chips.join('')}
    </section>`;
  }
  function planHtml(p, opts = {}) {
    const m = planModel(p, opts), s = m.settings, total = m.boards.reduce((a, b) => a + b.counts.nodes, 0), done = m.boards.reduce((a, b) => a + b.counts.done, 0);
    const leaf = '<svg viewBox="0 0 100 100" width="34" height="34"><path fill="#e8743b" d="M50 4 58 20 67 15 64 38 78 26 82 34 96 31 90 46 97 50 74 66 78 75 55 71 54 96 46 96 45 71 22 75 26 66 3 50 10 46 4 31 18 34 22 26 36 38 33 15 42 20Z"/></svg>';
    const setRows = [['Goal', s.goal], ['Programming language', s.language], ['Framework / libraries', s.framework], ['Code style', s.codeStyle], ['Tech stack', s.stack], ['Output folder', s.output], ['Run / build', s.run], ['Constraints', s.constraints]].filter(r => r[1]);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.name)} — Autumn plan</title><style>
      @page { size: A4; margin: 16mm 14mm 18mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font: 10.5pt/1.55 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif; color: #2b1d14; background: #fffaf3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .cover { display: flex; align-items: center; gap: 14px; padding: 6px 0 14px; border-bottom: 3px solid #e8743b; margin-bottom: 14px; }
      .cover h1 { margin: 0; font-size: 22pt; letter-spacing: -.3px; } .cover p { margin: 2px 0 0; color: #8a6a55; font-size: 9.5pt; }
      .stats { display: flex; gap: 8px; margin: 0 0 14px; } .stats div { flex: 1; background: #fbeadb; border-radius: 8px; padding: 6px 10px; } .stats b { display: block; font-size: 14pt; color: #b8432f; } .stats span { font-size: 8.5pt; color: #8a6a55; }
      h2 { font-size: 13.5pt; color: #b8432f; margin: 18px 0 8px; padding-bottom: 3px; border-bottom: 1px solid #ecd3bd; break-after: avoid; }
      .board { font-size: 15pt; color: #2b1d14; border-bottom: 2px solid #d4a13a; }
      .rules { background: #fff3d6; border: 1px solid #e2a93b; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; break-inside: avoid; }
      .rules h3 { margin: 0 0 4px; font-size: 11pt; }
      .item { border: 1px solid #ecd3bd; border-left: 4px solid var(--c); border-radius: 8px; padding: 8px 12px; margin: 0 0 9px; background: #fff; break-inside: avoid; }
      .ih { display: flex; align-items: center; gap: 8px; } .ih h3 { flex: 1; margin: 0; font-size: 11.5pt; } .ih h3 i { font-style: normal; color: var(--c); margin-right: 6px; }
      .chip { font-size: 8pt; font-weight: 600; color: #fff; background: var(--c); border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
      .st { font-size: 8pt; border-radius: 10px; padding: 1px 8px; background: #f1e6dc; color: #6e5646; white-space: nowrap; } .st-done { background: #dff0d8; color: #2f6b27; } .st-draft { background: #fdf0cf; color: #8a6200; } .st-hold { background: #f9dcd6; color: #9b2c1c; }
      .lbl { font-size: 8.5pt; font-weight: 700; color: #8a6a55; text-transform: uppercase; letter-spacing: .4px; margin: 6px 0 2px; }
      .prompt { border-left: 3px solid #ff9f43; background: #fff6ec; padding: 4px 10px; border-radius: 0 6px 6px 0; }
      .kv { display: grid; grid-template-columns: 120px 1fr; gap: 8px; margin-top: 4px; } .kv b { font-size: 9pt; color: #6e5646; } .kv em { font-style: normal; color: #b8432f; }
      code { font: 9pt/1.5 Consolas, 'Cascadia Code', monospace; white-space: pre-wrap; word-break: break-word; background: #f7efe6; border-radius: 4px; padding: 2px 6px; display: block; }
      .ctx { margin-top: 6px; } .pr { background: #f4efff; border-radius: 6px; padding: 4px 8px; margin: 3px 0; } .pr small { color: #7a6aa8; } .pr .sub { font-size: 9pt; color: #5d5280; }
      .tags { margin-top: 5px; font-size: 8.5pt; color: #a07a60; }
      .foot { margin-top: 18px; font-size: 8pt; color: #a08a7a; text-align: center; }
    </style></head><body>
      <div class="cover">${leaf}<div><h1>${esc(m.name)}</h1><p>Autumn plan · ${esc(m.date)}${m.file ? ' · ' + esc(m.file) : ''}</p></div></div>
      <div class="stats"><div><b>${total}</b><span>Nodes</span></div><div><b>${m.boards.reduce((a, b) => a + b.steps.length, 0)}</b><span>Steps in flow</span></div><div><b>${done}</b><span>Done</span></div><div><b>${m.boards.length}</b><span>Boards</span></div></div>
      ${m.rules.length ? `<h2>AI Rules — followed in every task</h2>${m.rules.map(r => `<div class="rules"><h3>${esc(r.title)}</h3>${r.body ? `<div>${para(r.body)}</div>` : ''}${r.rows.map(x => `<div class="kv"><b>${esc(x.name)}</b><span>${para(x.value)}</span></div>`).join('')}</div>`).join('')}` : ''}
      ${setRows.length ? `<h2>Project</h2><div class="item" style="--c:#6aa84f">${setRows.map(([k, v]) => `<div class="kv"><b>${k}</b><span>${para(v)}</span></div>`).join('')}</div>` : ''}
      ${m.boards.map(b => `<h2 class="board">${esc(b.name)}</h2>
        ${b.steps.length ? `<h2>Steps in flow order</h2>${b.steps.map(itemHtml).join('')}` : ''}
        ${b.comps.length ? `<h2>Components &amp; references</h2>${b.comps.map(itemHtml).join('')}` : ''}
        ${b.notes.length ? `<h2>Notes, docs &amp; prompts</h2>${b.notes.map(itemHtml).join('')}` : ''}`).join('')}
      <div class="foot">Made with Autumn</div>
    </body></html>`;
  }

  return { membersOf, endIds, flowOrder, contextOf, settings, planModel, planMarkdown, nodePrompt, planHtml };
});
