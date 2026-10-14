// Autumn — MCP tool definitions
//   createTools(M) → { TOOLS, SERVER, instructions }   (M = model.js)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function createTools(M) {
const INSTRUCTIONS = 'Autumn is a node-based planning IDE. People design a program (or a game / story) as nodes — Start, Feature, Task, Module, Function, API, Data Model, Screen, Test, Result, Programming language, Prompt, AI Rules… — '
  + 'and you read that plan to build it. Projects are .autumn.json files in the WorkFlow folder; pass a project name or path as "file", or omit it to use the project open in the app. '
  + 'To BUILD: call autumn_status, then autumn_build_plan, and implement the steps in order in the Start node\'s output folder; set each node\'s status to "done" with autumn_update_node as you finish it, '
  + 'and add an Issue node (type "bug") for anything unclear. Write the code in the language of the Programming language nodes (unlinked = whole project, linked = only those parts). Result nodes are check points: when the steps linked into one are built, run the program up to there and report what you got with autumn_report_result (or predict it, status "predicted") so people can see it on the board. To PLAN: autumn_read_board, then autumn_add_nodes / autumn_update_node / autumn_link; frame related nodes with autumn_group (a group stands for every node inside it — link to "group:Name"). Nodes are referenced by title or id. '
  + 'If the project has AI Rules (aiguide nodes), they are shown first by status, read_board and build_plan — ALWAYS follow them in every task. Never write secrets (API keys, tokens, passwords) into code or nodes. '
  + 'Edits appear live in the Autumn app.';
const fileProp = { type: 'string', description: 'Project: a name in the WorkFlow folder (e.g. "Todo App"), or a path to a .autumn.json file. Omit to use the project open in Autumn.' };
const boardProp = { type: 'string', description: 'Board name or id. Omit for the active board.' };
const typeEnum = Object.keys(M.TYPES);
const typeHelp = typeEnum.map(k => `${k} (${M.TYPES[k].name})`).join(', ');
const specHelp = Object.entries(M.SPEC_FIELDS).map(([t, fs]) => `${t}: ${fs.map(f => f.k).join('/')}`).join(' · ');
const aiProp = { type: 'object', description: 'AI record. For "ainote": model, prompt, negative (avoid), params (settings), mood (style), refs (one per line). For "aiguide" (AI Rules): prompt = always do, negative = never do, mood = style, model = default model/tool, params = default settings, refs = must-read references.', properties: { model: { type: 'string' }, prompt: { type: 'string' }, negative: { type: 'string' }, params: { type: 'string' }, mood: { type: 'string' }, refs: { type: 'string' } } };
const specProp = { type: 'object', description: `Structured spec fields of the node (strings). By type — ${specHelp}. An empty string removes a field.`, additionalProperties: { type: 'string' } };
const nodeLoad = a => { const f = M.resolveFile(a.file), p = M.load(f); return { f, p, b: M.findBoard(p, a.board) }; };

const TOOLS = [
  {
    name: 'autumn_status',
    description: 'Start here. Shows the target project file, its boards with node/link counts, the output folder and tech stack from the Start node, and the full AI Rules (which you must always follow).',
    inputSchema: { type: 'object', properties: { file: fileProp } },
    run: ({ file }) => {
      const f = M.resolveFile(file), p = M.load(f), active = M.findBoard(p), guide = M.guideText(p), s = M.Spec.settings(p);
      const done = p.boards.reduce((a, b) => a + b.nodes.filter(n => n.status === 'done').length, 0), all = p.boards.reduce((a, b) => a + b.nodes.length, 0);
      return [`File: ${f}`, `Project: ${p.name}`, `Active board: ${active.name}`, `Progress: ${done}/${all} nodes done`,
        s.output ? `Output folder: ${s.output}` : 'Output folder: (not set — "output" spec field of the Start node)', s.language ? `Programming language: ${s.language}` : '', s.stack ? `Tech stack: ${s.stack}` : '', s.run ? `Run / build: ${s.run}` : '',
        '', ...p.boards.map(b => `- ${b.name} (id ${b.id}) · ${b.nodes.length} nodes · ${b.links.length + b.groupLinks.length} links · ${b.groups.length} groups`),
        '', `Node types: ${typeHelp}`, `Link types: ${Object.keys(M.LINK_TYPES).join(', ')}`, `Statuses: ${Object.keys(M.STATUS).join(', ')} (idea, in progress, done, blocked)`,
        '', guide || 'AI Rules: none (create a node of type "aiguide" to set rules for every AI task)'].filter(x => x !== '').join('\n');
    },
  },
  {
    name: 'autumn_ai_rules',
    description: 'The project\'s AI Rules (all "aiguide" nodes) in full. Always follow them when you write code for this project, edit nodes or generate anything.',
    inputSchema: { type: 'object', properties: { file: fileProp } },
    run: ({ file }) => M.guideText(M.load(M.resolveFile(file))) || 'This project has no AI Rules. Create one with autumn_add_nodes (type "aiguide": body = rules, ai.prompt = always do, ai.negative = never do).',
  },
  {
    name: 'autumn_build_plan',
    description: 'The build plan: AI Rules, project settings (goal, stack, output folder, run command) and every step in flow order with its prompt, spec, data and linked prompts/notes/requirements, followed by components (modules, functions, APIs, data models, screens). Implement the program from this.',
    inputSchema: { type: 'object', properties: { file: fileProp, board: { type: 'string', description: 'Only this board (name or id). Omit for all boards.' } } },
    run: ({ file, board }) => { const f = M.resolveFile(file), p = M.load(f); if (board) M.findBoard(p, board); return M.Spec.planMarkdown(p, { file: f, board: board ? M.findBoard(p, board).id : undefined, audience: 'ai' }); },
  },
  {
    name: 'autumn_read_board',
    description: 'All nodes of a board (title, type, status, prompt/body, spec, ports, tags) and links, prefixed by the AI Rules. format=outline (default) is readable text; json is the raw data.',
    inputSchema: { type: 'object', properties: { file: fileProp, board: boardProp, format: { type: 'string', enum: ['outline', 'json'] } } },
    run: ({ file, board, format }) => {
      const p = M.load(M.resolveFile(file)), b = M.findBoard(p, board), guide = M.guideText(p);
      if (format === 'json') return JSON.stringify({ aiRules: guide || null, id: b.id, name: b.name, nodes: b.nodes.map(n => ({ ...n, images: (n.images || []).map(({ data, ...im }) => data ? { ...im, data: '(embedded)' } : im) })), links: b.links, groups: b.groups, groupLinks: b.groupLinks }, null, 2);
      return (guide ? guide + '\n---\n\n' : '') + M.outline(p, b);
    },
  },
  {
    name: 'autumn_search',
    description: 'Find nodes on all boards by title, body, tags, spec or AI record.',
    inputSchema: { type: 'object', properties: { file: fileProp, query: { type: 'string' } }, required: ['query'] },
    run: ({ file, query }) => {
      const p = M.load(M.resolveFile(file)), q = String(query).toLowerCase(), out = [];
      for (const b of p.boards) for (const n of b.nodes) {
        const hay = [n.title, n.body, (n.tags || []).join(' '), ...Object.values(n.ai || {}), ...Object.values(n.spec || {})].join(' ').toLowerCase();
        if (hay.includes(q)) out.push(`- [${b.name}] ${n.title} (${n.type}, ${n.status}, id ${n.id})${n.body ? ': ' + n.body.replace(/\n/g, ' ').slice(0, 90) : ''}`);
      }
      return out.length ? out.join('\n') : 'No matches';
    },
  },
  {
    name: 'autumn_list_projects',
    description: 'Projects in the WorkFlow folder (newest first), with node counts.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const list = M.listProjects();
      return `WorkFlow: ${M.workflowDir()}\n` + (list.length ? list.map(x => `- ${x.name} — ${path.basename(x.file)} · ${x.nodes} nodes · ${new Date(x.mtime).toISOString().slice(0, 16).replace('T', ' ')}`).join('\n') : '(no projects yet — autumn_new_project creates one)');
    },
  },
  {
    name: 'autumn_add_nodes',
    description: 'Add one or more nodes. With "after", the node is placed to the right of that node and linked from it ("port" picks the output port). Nodes created earlier in the same call can be used in "after". '
      + 'Write "body" as a prompt for the AI that will build it (what to do, rules, edge cases) and put structured details into "spec". Branch / condition nodes take "outputs" (port names).',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp,
        nodes: {
          type: 'array', items: {
            type: 'object', properties: {
              type: { type: 'string', enum: typeEnum, description: typeHelp },
              title: { type: 'string' }, body: { type: 'string', description: 'The prompt / description of the node' },
              spec: specProp, ai: aiProp,
              tags: { type: 'array', items: { type: 'string' } },
              status: { type: 'string', enum: Object.keys(M.STATUS) },
              outputs: { type: 'array', items: { type: 'string' }, description: 'Output port names (e.g. branch options)' },
              after: { type: 'string', description: 'Existing node (title or id) this node follows' },
              port: { type: 'string', description: 'Output port of the "after" node (name or 0-based index)' },
              linkType: { type: 'string', enum: Object.keys(M.LINK_TYPES) }, linkLabel: { type: 'string' },
              x: { type: 'number' }, y: { type: 'number' },
            }, required: ['type', 'title'],
          },
        },
      }, required: ['nodes'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a), out = [];
      for (const spec of a.nodes || []) {
        const after = spec.after ? M.findNode(b, spec.after) : null;
        const pos = (spec.x !== undefined && spec.y !== undefined) ? { x: spec.x, y: spec.y } : M.placeNode(b, after);
        const n = M.makeNode(spec, pos.x, pos.y);
        b.nodes.push(n);
        let linked = '';
        if (after) { const port = M.findPort(after, spec.port); const l = M.addLink(b, after, port, n, spec.linkType, spec.linkLabel); linked = ` ← ${after.title} [${port.label}]${l ? ' (' + l.type + ')' : ''}`; }
        out.push(`+ ${n.title} (${n.type}, id ${n.id})${linked}`);
      }
      M.save(f, p);
      return `Added ${out.length} node${out.length === 1 ? '' : 's'} to "${b.name}"\n` + out.join('\n') + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_update_node',
    description: 'Change a node: title, body (prompt), appendBody, type, tags, status (idea | draft = in progress | done | hold = blocked), output port names, spec fields, AI record. Only the given fields change; in spec/ai an empty string removes a field. '
      + 'Mark steps "done" as you implement them.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp, node: { type: 'string', description: 'Node title or id' },
        title: { type: 'string' }, body: { type: 'string' }, appendBody: { type: 'string' },
        type: { type: 'string', enum: typeEnum }, tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: Object.keys(M.STATUS) },
        outputs: { type: 'array', items: { type: 'string' }, description: 'Output port names (existing ports keep their links in order; extra ports are removed)' },
        spec: specProp, ai: aiProp,
      }, required: ['node'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a), n = M.findNode(b, a.node);
      if (a.title !== undefined) n.title = a.title;
      if (a.body !== undefined) n.body = a.body;
      if (a.appendBody) n.body = (n.body ? n.body + '\n' : '') + a.appendBody;
      if (a.type && M.TYPES[a.type]) { n.type = a.type; if (M.AI_TYPES.has(n.type) && !n.ai) n.ai = {}; if (M.SPEC_FIELDS[n.type] && !n.spec) n.spec = {}; }
      if (a.ai && typeof a.ai === 'object') { n.ai = n.ai || {}; for (const f0 of M.AI_FIELDS) if (a.ai[f0.k] !== undefined) { if (a.ai[f0.k]) n.ai[f0.k] = String(a.ai[f0.k]); else delete n.ai[f0.k]; } }
      if (a.spec && typeof a.spec === 'object') { n.spec = n.spec || {}; for (const [k, v] of Object.entries(a.spec)) { if (!/^[\w-]{1,40}$/.test(k)) continue; if (v) n.spec[k] = String(v); else delete n.spec[k]; } }
      if (Array.isArray(a.tags)) n.tags = a.tags.map(String);
      if (a.status && M.STATUS[a.status]) n.status = a.status;
      if (Array.isArray(a.outputs)) {
        const next = a.outputs.map((label, i) => n.outputs[i] ? { id: n.outputs[i].id, label: String(label) } : { id: M.uid('p'), label: String(label) });
        const keep = new Set(next.map(o => o.id));
        b.links = b.links.filter(l => l.from.node !== n.id || keep.has(l.from.port));
        b.groupLinks = b.groupLinks.filter(l => l.from.node !== n.id || keep.has(l.from.port));
        n.outputs = next;
      }
      M.save(f, p);
      return `Updated: ${n.title} (${n.type}, ${n.status}, id ${n.id})` + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_link',
    description: 'Link two nodes (or groups). type: flow (next step), cause (triggers), require (must be done first), uses (calls / imports / reads-writes), relation, conflict, ref (reference), ai (prompt / AI note applies here). '
      + 'Use "group:Name" for a group end — it stands for every node inside. Omit type to pick it from the node kinds.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp,
        from: { type: 'string', description: 'Source node (title or id) or "group:Name"' }, to: { type: 'string', description: 'Target node (title or id) or "group:Name"' },
        port: { type: 'string', description: 'Output port of the source node (name or index)' },
        type: { type: 'string', enum: Object.keys(M.LINK_TYPES) }, label: { type: 'string' },
      }, required: ['from', 'to'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a);
      const fe = M.findEnd(b, a.from), te = M.findEnd(b, a.to);
      if (fe.group || te.group) {
        const port = fe.node ? M.findPort(fe.node, a.port) : null;
        const l = M.addGroupLink(b, fe, port, te, a.type, a.label);
        if (!l) return 'That link already exists';
        M.save(f, p);
        const name = e => e.group ? `[Group] ${e.group.title} (${M.membersOf(b, e.group).length} nodes)` : e.node.title;
        return `Linked: ${name(fe)}${port ? ' [' + port.label + ']' : ''} → ${name(te)} (${l.type}, id ${l.id})`;
      }
      const from = fe.node, to = te.node, port = M.findPort(from, a.port);
      const l = M.addLink(b, from, port, to, a.type, a.label);
      if (!l) return 'That link already exists';
      M.save(f, p);
      return `Linked: ${from.title} [${port.label}] → ${to.title} (${l.type}, id ${l.id})` + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_delete',
    description: 'Delete nodes (with their links), links by id, and/or groups. Deleting a group removes only its frame and the links to it — the nodes inside stay (list them in "nodes" to delete them too).',
    inputSchema: { type: 'object', properties: { file: fileProp, board: boardProp, nodes: { type: 'array', items: { type: 'string' } }, links: { type: 'array', items: { type: 'string' }, description: 'Link ids' }, groups: { type: 'array', items: { type: 'string' }, description: 'Group titles or ids' } } },
    run: (a) => {
      const { f, p, b } = nodeLoad(a);
      const ids = new Set((a.nodes || []).map(r => M.findNode(b, r).id)), lids = new Set(a.links || []), gids = new Set((a.groups || []).map(r => M.findGroup(b, r).id));
      const n0 = b.nodes.length, l0 = b.links.length + b.groupLinks.length, g0 = b.groups.length;
      b.groups = b.groups.filter(g => !gids.has(g.id));
      b.nodes = b.nodes.filter(n => !ids.has(n.id));
      b.links = b.links.filter(l => !lids.has(l.id) && !ids.has(l.from.node) && !ids.has(l.to.node));
      b.groupLinks = b.groupLinks.filter(l => !lids.has(l.id) && !ids.has(l.from.node) && !ids.has(l.to.node) && !gids.has(l.from.group) && !gids.has(l.to.group));
      M.save(f, p);
      return `Deleted ${n0 - b.nodes.length} node(s), ${l0 - b.links.length - b.groupLinks.length} link(s)${gids.size ? `, ${g0 - b.groups.length} group(s) (their nodes stay)` : ''}`;
    },
  },
  {
    name: 'autumn_set_data',
    description: 'Put structured data on a node (config values, constants, sample records…). data is a plain JSON object: numbers, text, true/false, ranges ("10~20" or {min,max}) and nested objects. '
      + '"object" first inserts a saved object (template) by name. mode=merge (default) replaces same-named fields only; replace swaps everything.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp, node: { type: 'string', description: 'Node (title or id)' },
        data: { type: 'object', description: 'e.g. {"port": 3000, "debug": false, "limits": {"maxItems": 500}}' },
        object: { type: 'string', description: 'Name of an object (template) to insert first, e.g. "App config"' },
        mode: { type: 'string', enum: ['merge', 'replace'] },
      }, required: ['node'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a), n = M.findNode(b, a.node), F = M.Fields;
      let fields = a.mode === 'replace' ? [] : F.cleanFields(n.data);
      if (a.object) {
        const t = (p.templates || []).find(x => x.name === a.object || x.id === a.object);
        if (!t) throw new Error(`Object not found: ${a.object} (objects: ${(p.templates || []).map(x => x.name).join(', ') || 'none'})`);
        fields = F.mergeFields(fields, t.fields);
      }
      if (a.data) fields = F.mergeFields(fields, F.fromPlain(a.data));
      n.data = fields; M.save(f, p);
      return `Data saved on ${n.title}: ${F.fieldsSummary(n.data)}`;
    },
  },
  {
    name: 'autumn_define_object',
    description: 'Create (or replace, by name) a reusable object = a bundle of data fields, e.g. a config shape or a data model. Insert it into nodes with autumn_set_data "object".',
    inputSchema: { type: 'object', properties: { file: fileProp, name: { type: 'string' }, desc: { type: 'string' }, fields: { type: 'object', description: 'Same format as autumn_set_data data' } }, required: ['name', 'fields'] },
    run: (a) => {
      const f = M.resolveFile(a.file), p = M.load(f), F = M.Fields;
      p.templates = Array.isArray(p.templates) ? p.templates : F.defaultTemplates();
      const fields = F.fromPlain(a.fields), old = p.templates.find(t => t.name === a.name);
      if (old) { old.fields = fields; if (a.desc !== undefined) old.desc = a.desc; }
      else p.templates.push({ id: M.uid('t'), name: a.name, desc: a.desc || '', fields });
      M.save(f, p);
      return `${old ? 'Updated' : 'Added'} object ${a.name}: ${F.fieldsSummary(fields)}\nObjects: ${p.templates.map(t => t.name).join(', ')}`;
    },
  },
  {
    name: 'autumn_add_image',
    description: 'Attach an image file (png, jpg, gif, webp, bmp) to a node — e.g. a UI mockup or diagram. The original file is copied unchanged into autumn-assets next to the project. Without "node", a new note node is created.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp, image: { type: 'string', description: 'Path of the image file' },
        node: { type: 'string', description: 'Node (title or id); omit for a new note' }, caption: { type: 'string' },
        mode: { type: 'string', enum: ['fit', 'native'], description: 'fit = scaled to the node width (default) · native = node as wide as the image' },
      }, required: ['image'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a);
      const im = M.importImage(f, path.resolve(String(a.image)), a.caption);
      let n;
      if (a.node) n = M.findNode(b, a.node);
      else { const pos = M.placeNode(b, null); n = M.makeNode({ type: 'note', title: im.name.replace(/\.[^.]+$/, '') }, pos.x, pos.y); n.w = 320; b.nodes.push(n); }
      n.images = n.images || [];
      const first = !n.images.length;
      n.images.push(im);
      if (first && a.mode === 'native') n.imageMode = 'native';
      if (n.imageMode === 'native') n.w = Math.max(250, Math.max(...n.images.map(i => i.w || 0)) + 26);
      M.save(f, p);
      return `Image added: ${im.name} (${im.w}×${im.h}px) → ${n.title} (id ${n.id}) · stored as ${im.file}`;
    },
  },
  {
    name: 'autumn_report_result',
    description: 'Show what the program produced at a check point. "node" is a Result node — or a step, then its linked Result node is used (one is created and linked if there is none). '
      + 'Never change the steps themselves for this — put the fixes in "fixes" instead. Run the program up to that point (tests, a script, the app…) and report: status pass | fail (compared with the node\'s "Expected result" field) | info (plain output) | predicted (you could not run it and worked it out instead), '
      + 'a short headline value (e.g. "3 tasks", "200 OK", "42 fps") and the output (console text, test summary). An optional screenshot replaces the previous one. The result appears on the node in the app.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp, node: { type: 'string', description: 'Result node, or the step it checks (title or id)' },
        status: { type: 'string', enum: Object.keys(M.RESULT_STATUS) }, value: { type: 'string', description: 'Headline value, one line' },
        output: { type: 'string', description: 'Output text (trimmed to 20 000 characters)' }, note: { type: 'string', description: 'One short sentence: why' },
        fixes: { type: 'array', items: { type: 'string' }, description: 'When it is wrong: the smallest fixes, one short line each, as before → after (e.g. print(hi) → print("hi")). They go into an Issue node next to the Result node; the steps themselves are not changed.' }, image: { type: 'string', description: 'Optional screenshot file path (png, jpg, gif, webp, bmp)' },
        by: { type: 'string', description: 'Who reports it, e.g. "Claude Code" or "Codex"' },
      }, required: ['node', 'status'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a);
      if (!M.RESULT_STATUS[a.status]) throw new Error('status must be one of: ' + Object.keys(M.RESULT_STATUS).join(', '));
      const step = M.findNode(b, a.node);
      let n = step, made = '';
      if (step.type !== 'result') {
        const linked = b.links.filter(l => l.from.node === step.id).map(l => b.nodes.find(x => x.id === l.to.node)).find(x => x && x.type === 'result');
        if (linked) n = linked;
        else {
          const pos = M.placeNode(b, step);
          n = M.makeNode({ type: 'result', title: 'Result: ' + step.title }, pos.x, pos.y);
          b.nodes.push(n);
          M.addLink(b, step, step.outputs[step.outputs.length - 1] || step.outputs[0], n, 'flow');
          made = ' (new Result node, linked from "' + step.title + '")';
        }
      }
      const r = { status: a.status, source: a.status === 'predicted' ? 'predicted' : 'run', by: String(a.by || 'AI').slice(0, 60), at: new Date().toISOString() };
      if (a.value) r.value = String(a.value).slice(0, 300);
      if (a.output) r.output = String(a.output).slice(0, 20000);
      if (a.note) r.note = String(a.note).slice(0, 2000);
      n.result = r;
      const fixes = (Array.isArray(a.fixes) ? a.fixes : []).map(x => String(x).trim()).filter(Boolean).slice(0, 5).map(x => x.slice(0, 240));
      const did = M.resultIssue(b, n, a.status === 'fail' ? fixes : []);
      if (a.image) {
        const im = M.importImage(f, path.resolve(String(a.image)), 'Result screenshot');
        n.images = (n.images || []).filter(i => i.caption !== 'Result screenshot');
        n.images.push(im);
      }
      M.save(f, p);
      const st = M.RESULT_STATUS[a.status];
      return `Result on "${n.title}" (id ${n.id})${made}: ${st.icon} ${st.name}${r.value ? ' — ' + r.value : ''}${a.image ? ' · screenshot attached' : ''}${did ? ` · ${did.text}` : ''}` + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_add_board',
    description: 'Add a board (a tab), e.g. one per feature area, service or story line.',
    inputSchema: { type: 'object', properties: { file: fileProp, name: { type: 'string' } }, required: ['name'] },
    run: ({ file, name }) => {
      const f = M.resolveFile(file), p = M.load(f);
      const b = { id: M.uid('b'), name, nodes: [], links: [], groups: [], groupLinks: [], view: { x: 240, y: 160, z: 1 } };
      p.boards.push(b); M.save(f, p);
      return `Board added: ${name} (id ${b.id})`;
    },
  },
  {
    name: 'autumn_group',
    description: 'Create a group: a titled frame around nodes, like Ctrl+G in the app. A group stands for every node inside it — link a prompt, a Programming language node or a step to "group:Title" and it reaches them all; Run and trace treat the group as a unit. Groups can be nested. '
      + 'Membership is by position (whatever lies inside the frame): if other nodes sit between the ones you list, add them too, or pass arrange: true to move the listed nodes into a tidy block first.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp,
        nodes: { type: 'array', items: { type: 'string' }, description: 'Nodes to put in the group (titles or ids)' },
        title: { type: 'string', description: 'Group title, e.g. "Screens" or "Storage"' },
        color: { type: 'string', description: 'Frame color #rrggbb (optional)' },
        arrange: { type: 'boolean', description: 'Move the nodes into a tidy block first (default false)' },
      }, required: ['nodes', 'title'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a);
      const ns = [...new Set((a.nodes || []).map(r => M.findNode(b, r)))];
      const fr = M.frameNodes(b, ns, { arrange: !!a.arrange });
      const g = { id: M.uid('g'), ...fr, title: String(a.title || '').trim() || 'Group', color: M.groupColor(b, a.color) };
      b.groups.push(g);
      M.save(f, p);
      const mem = M.membersOf(b, g), outer = b.groups.filter(x => x !== g && M.contains(x, g)).map(x => x.title);
      return `Group created: [Group] ${g.title} (id ${g.id}) · ${mem.length} node${mem.length === 1 ? '' : 's'}: ${mem.map(n => n.title).join(', ')}${a.arrange ? ' · nodes arranged' : ''}${outer.length ? ' · inside ' + outer.join(' › ') : ''}\nLink to it with "group:${g.title}".` + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_update_group',
    description: 'Change a group: title, color, add or remove nodes (the frame is refitted and removed nodes are moved just outside it), fit (refit the frame to its nodes) or arrange (tidy its nodes into a block). Membership is by position, as in autumn_group.',
    inputSchema: {
      type: 'object', properties: {
        file: fileProp, board: boardProp, group: { type: 'string', description: 'Group title or id ("group:" prefix allowed)' },
        title: { type: 'string' }, color: { type: 'string', description: '#rrggbb' },
        add: { type: 'array', items: { type: 'string' }, description: 'Nodes to add (titles or ids)' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Nodes to take out (titles or ids)' },
        fit: { type: 'boolean', description: 'Refit the frame to its nodes' },
        arrange: { type: 'boolean', description: 'Move the nodes into a tidy block' },
      }, required: ['group'],
    },
    run: (a) => {
      const { f, p, b } = nodeLoad(a), g = M.findGroup(b, a.group);
      const add = (a.add || []).map(r => M.findNode(b, r)), rem = new Set((a.remove || []).map(r => M.findNode(b, r)));
      const done = [];
      if (add.length || rem.size || a.fit || a.arrange) {
        const inner = M.groupsInside(b, g);
        const ns = [...new Set(M.membersOf(b, g).concat(add))].filter(n => !rem.has(n));
        if (!ns.length) throw new Error('That would leave the group empty — remove the group with autumn_delete (groups) instead');
        Object.assign(g, M.frameNodes(b, ns, { arrange: !!a.arrange, inner, ignore: rem }));
        for (const n of rem) if (M.inFrame(n, g)) { const pos = M.placeNode(b, { x: g.x, y: g.y, w: g.w }); n.x = pos.x; n.y = pos.y; }
        done.push(add.length ? `added ${add.map(n => n.title).join(', ')}` : '', rem.size ? `took out ${[...rem].map(n => n.title).join(', ')}` : '', a.arrange ? 'arranged' : 'refitted');
      }
      if (a.title !== undefined && String(a.title).trim()) { g.title = String(a.title).trim(); done.push('renamed'); }
      if (a.color) { g.color = M.groupColor(b, a.color); done.push('recolored'); }
      if (!done.length) throw new Error('Nothing to change — give title, color, add, remove, fit or arrange');
      M.save(f, p);
      const mem = M.membersOf(b, g);
      return `Updated [Group] ${g.title} (id ${g.id}): ${done.filter(Boolean).join(' · ')} · ${mem.length} node${mem.length === 1 ? '' : 's'}: ${mem.map(n => n.title).join(', ')}` + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_duplicate_group',
    description: 'Duplicate a whole group: its frame, the nodes inside, nested groups and the links between them (links to the outside are not copied). The copy goes to a free spot. "title" renames the copy.',
    inputSchema: { type: 'object', properties: { file: fileProp, board: boardProp, group: { type: 'string', description: 'Group name or id ("group:" prefix allowed)' }, title: { type: 'string' } }, required: ['group'] },
    run: (a) => {
      const { f, p, b } = nodeLoad(a), g = M.findGroup(b, a.group), r = M.duplicateGroup(b, g, a.title);
      M.save(f, p);
      return `Duplicated [Group] ${g.title} → ${r.group.title} (id ${r.group.id}) · ${r.nodes} nodes · ${r.groups} nested groups · ${r.links} links · at (${r.group.x}, ${r.group.y})` + M.guideReminder(p);
    },
  },
  {
    name: 'autumn_new_project',
    description: 'Create a project. By default it goes into the WorkFlow folder as "<name>.autumn.json" and starts with a Start node and default AI Rules. Never overwrites. It becomes the target of later calls.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string', description: 'Optional explicit file path (.autumn.json)' } } },
    run: ({ name, path: p0 }) => {
      if (!p0 && !name) throw new Error('Give a name (or a path)');
      let f = p0 ? path.resolve(String(p0)) : path.join(M.workflowDir(), String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() + '.autumn.json');
      if (!/\.json$/i.test(f)) f += '.autumn.json';
      if (fs.existsSync(f)) throw new Error('A file already exists there: ' + f);
      M.save(f, M.blankProject(name || path.basename(f).replace(/\.autumn\.json$|\.json$/i, '')));
      M.setTarget(f);
      return `Created ${f}\nLater calls use this project (pass "file" for another). Open it in Autumn to watch it grow.`;
    },
  },
  {
    name: 'autumn_open',
    description: 'Choose the default project for later calls (used when "file" is omitted).',
    inputSchema: { type: 'object', properties: { file: fileProp }, required: ['file'] },
    run: ({ file }) => {
      if (!String(file || '').trim()) throw new Error('"file" is empty');
      const f = M.resolveFile(file), p = M.load(f);
      M.setTarget(f);
      return `Target: ${f} (${p.name} · ${p.boards.length} board${p.boards.length === 1 ? '' : 's'})`;
    },
  },
  {
    name: 'autumn_export',
    description: 'Export the plan. format "markdown" returns the document (and writes it if "out" is given); format "pdf" renders a PDF document with the Autumn app and returns its path (default: next to the project).',
    inputSchema: { type: 'object', properties: { file: fileProp, format: { type: 'string', enum: ['markdown', 'pdf'] }, out: { type: 'string', description: 'Output file path (optional)' } } },
    run: async ({ file, format, out }) => {
      const f = M.resolveFile(file), p = M.load(f);
      if (format !== 'pdf') {
        const md = M.Spec.planMarkdown(p, { file: f, audience: 'human' });
        if (out) { fs.writeFileSync(path.resolve(out), md, 'utf8'); return `Written: ${path.resolve(out)}`; }
        return md;
      }
      const dest = path.resolve(out || f.replace(/(\.autumn)?\.json$/i, '') + '.pdf');
      await renderPdf(f, dest);
      return `PDF written: ${dest}`;
    },
  },
];

/** Make the PDF with Autumn.exe in headless mode (works whether this server runs on Node or on Autumn.exe itself) */
function renderPdf(project, dest) {
  const st = M.readState();
  let exe = process.versions.electron ? process.execPath : st.exe;
  if (!exe || !fs.existsSync(exe)) throw new Error('Autumn.exe not found — start the Autumn app once so the MCP server can find it.');
  const appDir = path.join(__dirname, '..');
  const args = /electron(\.exe)?$/i.test(path.basename(exe)) ? [appDir] : [];   // a dev Electron needs the app folder
  args.push(`--export-pdf=${project}`, `--out=${dest}`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((res, rej) => {
    const c = spawn(exe, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = ''; c.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => { c.kill(); rej(new Error('PDF export timed out')); }, 60000);
    c.on('error', e => { clearTimeout(t); rej(e); });
    c.on('exit', code => { clearTimeout(t); code === 0 && fs.existsSync(dest) ? res(dest) : rej(new Error('PDF export failed' + (err ? ': ' + err.trim().split('\n').pop() : ''))); });
  });
}

return { TOOLS, SERVER: { name: 'autumn', version: '1.1.2' }, instructions: INSTRUCTIONS };
};
