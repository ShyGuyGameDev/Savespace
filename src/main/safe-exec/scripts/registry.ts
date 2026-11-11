/**
 * Script registry. EVERY AppleScript/JXA that Waypoint can run lives here; SafeExec refuses
 * anything else. Templates never interpolate values: parameters arrive via `run(argv)` as
 * separate process arguments, so there is nothing to escape and nothing to inject.
 *
 * Each template declares the verbs it uses. `tests/unit/script-registry.test.ts` fails the build if
 *  - a template contains any forbidden verb (keystroke, key code, click, set value, set contents,
 *    save, send, delete, close, quit, set URL, do script, do JavaScript, write text, ...),
 *  - a template calls a method that isn't in ALLOWED_JXA_METHODS,
 *  - a template assigns a property outside the declared verbs' allowed assignments,
 *  - a template uses a verb it didn't declare.
 */

export type Verb =
  | 'read' // read properties only
  | 'activate' // bring an app to the front
  | 'focus-window' // raise an existing window (set index / frontmost)
  | 'focus-tab' // select an existing tab (active tab index / current tab / select)
  | 'make-tab' // create a NEW tab pointing to a saved URL
  | 'show' // app's own "show <item>" command (Notes, Calendar, Reminders)
  | 'arrange' // set window position/size (only when the user enables Arrange windows)

export const ALLOWED_VERBS: readonly Verb[] = [
  'read',
  'activate',
  'focus-window',
  'focus-tab',
  'make-tab',
  'show',
  'arrange',
]

export interface ScriptTemplate {
  id: string
  description: string
  /** Bundle id the script talks to (for Automation permission bookkeeping). */
  target: string
  verbs: Verb[]
  /** Only runnable when settings.arrangeWindows is true. */
  arrange?: boolean
  source: string
}

/** Methods a template may call. Anything else (e.g. .close(), .save(), .keystroke()) fails the lint. */
export const ALLOWED_JXA_METHODS = new Set([
  // JXA object model reads
  'Application',
  'running',
  'windows',
  'tabs',
  'url',
  'URL',
  'name',
  'title',
  'mode',
  'id',
  'index',
  'activeTabIndex',
  'currentTab',
  'documents',
  'processes',
  'bundleIdentifier',
  'frontmost',
  'position',
  'size',
  'bounds',
  'attributes',
  'value',
  'byName',
  'whose',
  'at',
  'visible',
  'messageId',
  'subject',
  'selectedMessages',
  'messageViewers',
  'draftsMailbox',
  'messages',
  'selection',
  'notes',
  'calendars',
  'events',
  'summary',
  'uid',
  'startDate',
  'endDate',
  'lists',
  'reminders',
  'path',
  'target',
  'finderWindows',
  'incognito',
  'spaces',
  'backgroundOnly',
  'unixId',
  'container',
  'location',
  'tty',
  'customTitle',
  'selected',
  'sessions',
  'currentSession',
  'currentWindow',
  'variable',
  // verbs (each mapped to a declared Verb below)
  'activate',
  'Tab',
  'push',
  'show',
  'select',
  // plain JS
  'stringify',
  'parse',
  'map',
  'filter',
  'forEach',
  'slice',
  'push',
  'indexOf',
  'includes',
  'startsWith',
  'toString',
  'toISOString',
  'getTime',
  'Date',
  'Number',
  'String',
  'replace',
  'trim',
  'toLowerCase',
  'some',
  'find',
  'concat',
  'max',
  'min',
  'round',
  'floor',
  'keys',
  'join',
  'split',
  'endsWith',
  'length',
  'exists',
  'isNaN',
])

/** Patterns that must never appear in any template (AppleScript or JXA spellings). */
export const FORBIDDEN_PATTERNS: { verb: string; re: RegExp }[] = [
  { verb: 'keystroke', re: /keystroke/i },
  { verb: 'key code', re: /key\s*code/i },
  { verb: 'click', re: /\bclick/i },
  { verb: 'set value', re: /set\s+value|\.value\s*=(?!=)/i },
  { verb: 'set contents', re: /set\s+contents|\.contents\s*=(?!=)/i },
  { verb: 'save', re: /\bsave\b|\.save\s*\(/i },
  { verb: 'send', re: /\bsend\b|\.send\s*\(/i },
  { verb: 'delete', re: /\bdelete\b|\.delete\s*\(/i },
  { verb: 'close', re: /\bclose\b|\.close\s*\(/i },
  { verb: 'quit', re: /\bquit\b|\.quit\s*\(/i },
  { verb: 'set URL', re: /set\s+URL|\.url\s*=(?!=)|\.URL\s*=(?!=)/i },
  { verb: 'do script', re: /do\s*script|doScript/i },
  { verb: 'do JavaScript', re: /do\s*JavaScript|doJavaScript|executeJavaScript|\bexecute\b/i },
  { verb: 'do shell script', re: /do\s*shell\s*script|doShellScript/i },
  { verb: 'write text', re: /write\s*text|writeText/i },
  { verb: 'perform action', re: /perform|AXPress|AXConfirm/i },
  {
    verb: 'make new document',
    re: /make\s*\(\s*\{\s*new\s*:\s*['"](document|outgoing message|note|event|reminder)/i,
  },
  { verb: 'outgoing message', re: /OutgoingMessage|outgoing\s*message/i },
  { verb: 'move', re: /\.move\s*\(|\bmove\s+(tab|window|message)/i },
  { verb: 'duplicate', re: /\.duplicate\s*\(/i },
  { verb: 'reload', re: /\.reload\s*\(/i },
  { verb: 'clipboard', re: /setTheClipboard|the\s*clipboard/i },
  { verb: 'includeStandardAdditions', re: /includeStandardAdditions/i },
  { verb: 'ObjC bridge', re: /\bObjC\b|\$\./ },
]

/** Assignments allowed per verb. Any other `obj.prop =` fails the lint. */
export const VERB_ASSIGNMENTS: Record<Verb, RegExp[]> = {
  read: [],
  activate: [/\.frontmost\s*=/],
  'focus-window': [/\.index\s*=/, /\.frontmost\s*=/],
  'focus-tab': [/\.activeTabIndex\s*=/, /\.currentTab\s*=/],
  'make-tab': [/\.currentTab\s*=/, /\.activeTabIndex\s*=/],
  show: [],
  arrange: [/\.position\s*=/, /\.size\s*=/],
}

/** Usage detectors: if a template matches one of these, it must declare that verb. */
export const VERB_USAGE: Record<Exclude<Verb, 'read'>, RegExp> = {
  activate: /\.activate\s*\(|\.frontmost\s*=/,
  'focus-window': /\.index\s*=/,
  'focus-tab': /\.activeTabIndex\s*=|\.select\s*\(/,
  'make-tab': /\.Tab\s*\(|\.tabs\.push\s*\(/,
  show: /\.show\s*\(/,
  arrange: /\.position\s*=|\.size\s*=/,
}

const T = (t: ScriptTemplate) => t

// Small helpers inlined into templates (as source text, not interpolated data).
const chromiumRead = (appRef: string) => `function run(argv) {
  const app = Application(argv[0]);
  if (!app.running()) return JSON.stringify({ running: false, windows: [] });
  const out = [];
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    ${appRef}
    const tabs = w.tabs();
    const t = [];
    for (let j = 0; j < tabs.length; j++) t.push({ url: tabs[j].url(), title: tabs[j].title() });
    out.push({ index: i, active: w.activeTabIndex(), tabs: t, bounds: w.bounds() });
  }
  return JSON.stringify({ running: true, windows: out });
}`

export const SCRIPTS = {
  // ---------- System Events (needs Accessibility + Automation→System Events) ----------
  'system-events.probe': T({
    id: 'system-events.probe',
    description: 'Checks that System Events can be asked for the process list (read-only).',
    target: 'com.apple.systemevents',
    verbs: ['read'],
    source: `function run() { return JSON.stringify({ count: Application('System Events').processes.whose({ backgroundOnly: false })().length }); }`,
  }),
  'system-events.windows': T({
    id: 'system-events.windows',
    description:
      'Lists visible apps and their window titles, frames and document paths (metadata only).',
    target: 'com.apple.systemevents',
    verbs: ['read'],
    source: `function run() {
  const se = Application('System Events');
  const procs = se.processes.whose({ backgroundOnly: false })();
  const out = [];
  for (let i = 0; i < procs.length; i++) {
    const p = procs[i];
    let bid = null; try { bid = p.bundleIdentifier(); } catch (e) {}
    const entry = { name: p.name(), bundleId: bid, pid: p.unixId(), frontmost: p.frontmost(), windows: [] };
    let wins = [];
    try { wins = p.windows(); } catch (e) {}
    for (let j = 0; j < wins.length && j < 30; j++) {
      const w = wins[j];
      let title = null, pos = null, size = null, doc = null;
      try { title = w.name(); } catch (e) {}
      try { pos = w.position(); size = w.size(); } catch (e) {}
      try { doc = w.attributes.byName('AXDocument').value(); } catch (e) {}
      entry.windows.push({ title: title, position: pos, size: size, document: doc });
    }
    out.push(entry);
  }
  return JSON.stringify(out);
}`,
  }),
  'system-events.arrange': T({
    id: 'system-events.arrange',
    description:
      'Moves/resizes the first window of an app whose title matches (only with Arrange windows on).',
    target: 'com.apple.systemevents',
    verbs: ['read', 'arrange'],
    arrange: true,
    source: `function run(argv) {
  const se = Application('System Events');
  const procs = se.processes.whose({ bundleIdentifier: argv[0] })();
  if (!procs.length) return JSON.stringify({ ok: false, reason: 'app not running' });
  const wins = procs[0].windows();
  for (let i = 0; i < wins.length; i++) {
    const t = wins[i].name();
    if (t === argv[1] || (argv[1].length > 8 && t && t.includes(argv[1]))) {
      wins[i].position = [Number(argv[2]), Number(argv[3])];
      wins[i].size = [Number(argv[4]), Number(argv[5])];
      return JSON.stringify({ ok: true });
    }
  }
  return JSON.stringify({ ok: false, reason: 'window not found' });
}`,
  }),
  'app.running': T({
    id: 'app.running',
    description: 'Checks whether an app is running (does not launch it, sends no Apple Events).',
    target: '*',
    verbs: ['read'],
    source: `function run(argv) {
  try { return JSON.stringify({ installed: true, running: Application(argv[0]).running() }); }
  catch (e) { return JSON.stringify({ installed: false, running: false }); }
}`,
  }),

  'app.probe': T({
    id: 'app.probe',
    description:
      'Asks a RUNNING app how many windows it has, to trigger/check the Automation consent. Never launches it.',
    target: '*',
    verbs: ['read'],
    source: `function run(argv) {
  const a = Application(argv[0]);
  if (!a.running()) return JSON.stringify({ running: false });
  const n = a.windows().length;
  return JSON.stringify({ running: true, windows: n });
}`,
  }),

  // ---------- Chromium family (Chrome, Brave, Edge, Vivaldi) ----------
  'chromium.tabs': T({
    id: 'chromium.tabs',
    description: 'Reads tab URLs/titles of NORMAL windows only (incognito windows are skipped).',
    target: 'com.google.Chrome',
    verbs: ['read'],
    source: chromiumRead(`if (w.mode() !== 'normal') continue;`),
  }),
  'chromium.focus-or-open': T({
    id: 'chromium.focus-or-open',
    description:
      'Focuses a tab already showing the URL, otherwise opens it in a NEW tab. Never changes an existing tab.',
    target: 'com.google.Chrome',
    verbs: ['read', 'activate', 'focus-window', 'focus-tab', 'make-tab'],
    source: `function run(argv) {
  const app = Application(argv[0]);
  const target = argv[1];
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    if (wins[i].mode() !== 'normal') continue;
    const tabs = wins[i].tabs();
    for (let j = 0; j < tabs.length; j++) {
      if (tabs[j].url() === target) {
        wins[i].activeTabIndex = j + 1;
        wins[i].index = 1;
        app.activate();
        return JSON.stringify({ status: 'already-open' });
      }
    }
  }
  let w = null;
  for (let i = 0; i < wins.length; i++) { if (wins[i].mode() === 'normal') { w = wins[i]; break; } }
  if (!w) return JSON.stringify({ status: 'no-window' });
  w.tabs.push(app.Tab({ url: target }));
  w.activeTabIndex = w.tabs().length;
  app.activate();
  return JSON.stringify({ status: 'opened' });
}`,
  }),
  'chromium.focus-tab': T({
    id: 'chromium.focus-tab',
    description:
      'Focuses one specific existing tab (window index, tab index), only if it still shows the expected URL.',
    target: 'com.google.Chrome',
    verbs: ['read', 'activate', 'focus-window', 'focus-tab'],
    source: `function run(argv) {
  const app = Application(argv[0]);
  const w = app.windows()[Number(argv[1])];
  if (!w || w.mode() !== 'normal') return JSON.stringify({ status: 'missing' });
  const tabs = w.tabs();
  const j = Number(argv[2]);
  if (!tabs[j] || tabs[j].url() !== argv[3]) return JSON.stringify({ status: 'missing' });
  w.activeTabIndex = j + 1;
  w.index = 1;
  app.activate();
  return JSON.stringify({ status: 'already-open' });
}`,
  }),
  'chromium.has-url': T({
    id: 'chromium.has-url',
    description: 'Returns whether any normal window has a tab showing the URL.',
    target: 'com.google.Chrome',
    verbs: ['read'],
    source: `function run(argv) {
  const app = Application(argv[0]);
  if (!app.running()) return JSON.stringify({ open: false });
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    if (wins[i].mode() !== 'normal') continue;
    const tabs = wins[i].tabs();
    for (let j = 0; j < tabs.length; j++) if (tabs[j].url() === argv[1]) return JSON.stringify({ open: true });
  }
  return JSON.stringify({ open: false });
}`,
  }),

  // ---------- Arc ----------
  'arc.tabs': T({
    id: 'arc.tabs',
    description: 'Reads Arc tab URLs/titles, skipping incognito windows.',
    target: 'company.thebrowser.Browser',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Arc');
  if (!app.running()) return JSON.stringify({ running: false, windows: [] });
  const out = [];
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    let inc = false; try { inc = wins[i].incognito(); } catch (e) {}
    if (inc) continue;
    const tabs = wins[i].tabs();
    const t = [];
    for (let j = 0; j < tabs.length; j++) t.push({ url: tabs[j].url(), title: tabs[j].title() });
    out.push({ index: i, tabs: t });
  }
  return JSON.stringify({ running: true, windows: out });
}`,
  }),
  'arc.focus-or-open': T({
    id: 'arc.focus-or-open',
    description: 'Selects an Arc tab already showing the URL, otherwise opens a new tab.',
    target: 'company.thebrowser.Browser',
    verbs: ['read', 'activate', 'focus-tab', 'make-tab'],
    source: `function run(argv) {
  const app = Application('Arc');
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    let inc = false; try { inc = wins[i].incognito(); } catch (e) {}
    if (inc) continue;
    const tabs = wins[i].tabs();
    for (let j = 0; j < tabs.length; j++) {
      if (tabs[j].url() === argv[0]) { tabs[j].select(); app.activate(); return JSON.stringify({ status: 'already-open' }); }
    }
  }
  if (!wins.length) return JSON.stringify({ status: 'no-window' });
  wins[0].tabs.push(app.Tab({ url: argv[0] }));
  app.activate();
  return JSON.stringify({ status: 'opened' });
}`,
  }),

  // ---------- Safari ----------
  'safari.tabs': T({
    id: 'safari.tabs',
    description: 'Reads Safari tab URLs/titles (opt-in: Safari cannot report private windows).',
    target: 'com.apple.Safari',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Safari');
  if (!app.running()) return JSON.stringify({ running: false, windows: [] });
  const out = [];
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    let tabs = [];
    try { tabs = wins[i].tabs(); } catch (e) { continue; }
    const t = [];
    for (let j = 0; j < tabs.length; j++) t.push({ url: tabs[j].url(), title: tabs[j].name() });
    out.push({ index: i, title: wins[i].name(), tabs: t });
  }
  return JSON.stringify({ running: true, windows: out });
}`,
  }),
  'safari.focus-or-open': T({
    id: 'safari.focus-or-open',
    description:
      'Focuses a Safari tab showing the URL, otherwise opens a new tab in the front window.',
    target: 'com.apple.Safari',
    verbs: ['read', 'activate', 'focus-window', 'focus-tab', 'make-tab'],
    source: `function run(argv) {
  const app = Application('Safari');
  const wins = app.windows();
  for (let i = 0; i < wins.length; i++) {
    let tabs = [];
    try { tabs = wins[i].tabs(); } catch (e) { continue; }
    for (let j = 0; j < tabs.length; j++) {
      if (tabs[j].url() === argv[0]) {
        wins[i].currentTab = tabs[j];
        wins[i].index = 1;
        app.activate();
        return JSON.stringify({ status: 'already-open' });
      }
    }
  }
  let w = null;
  for (let i = 0; i < wins.length; i++) { try { wins[i].tabs(); w = wins[i]; break; } catch (e) {} }
  if (!w) return JSON.stringify({ status: 'no-window' });
  const t = app.Tab({ url: argv[0] });
  w.tabs.push(t);
  w.currentTab = t;
  app.activate();
  return JSON.stringify({ status: 'opened' });
}`,
  }),

  // ---------- Apple Mail ----------
  'mail.context': T({
    id: 'mail.context',
    description:
      'Reads subjects + Message-IDs of selected messages and recent drafts (never bodies).',
    target: 'com.apple.mail',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Mail');
  if (!app.running()) return JSON.stringify({ running: false, selected: [], drafts: [] });
  const selected = [];
  try {
    const viewers = app.messageViewers();
    for (let i = 0; i < viewers.length && i < 5; i++) {
      const msgs = viewers[i].selectedMessages();
      for (let j = 0; j < msgs.length && j < 10; j++) selected.push({ id: msgs[j].messageId(), subject: msgs[j].subject() });
    }
  } catch (e) {}
  const drafts = [];
  try {
    const d = app.draftsMailbox.messages();
    for (let i = 0; i < d.length && i < 15; i++) drafts.push({ id: d[i].messageId(), subject: d[i].subject() });
  } catch (e) {}
  return JSON.stringify({ running: true, selected: selected, drafts: drafts });
}`,
  }),

  // ---------- Apple Notes ----------
  'notes.selection': T({
    id: 'notes.selection',
    description: 'Reads the id and title of the selected note (never its body).',
    target: 'com.apple.Notes',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Notes');
  if (!app.running()) return JSON.stringify({ running: false, notes: [] });
  const out = [];
  try { const s = app.selection(); for (let i = 0; i < s.length && i < 5; i++) out.push({ id: s[i].id(), name: s[i].name() }); } catch (e) {}
  return JSON.stringify({ running: true, notes: out });
}`,
  }),
  'notes.show': T({
    id: 'notes.show',
    description: 'Shows an existing note by id using Notes’ own "show" command.',
    target: 'com.apple.Notes',
    verbs: ['read', 'show', 'activate'],
    source: `function run(argv) {
  const app = Application('Notes');
  const n = app.notes.whose({ id: argv[0] })();
  if (!n.length) return JSON.stringify({ status: 'not-found' });
  n[0].show();
  app.activate();
  return JSON.stringify({ status: 'opened' });
}`,
  }),

  // ---------- Calendar ----------
  'calendar.now': T({
    id: 'calendar.now',
    description:
      'Reads titles + uids of events overlapping now ± 2 hours (no notes, attendees or descriptions).',
    target: 'com.apple.iCal',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Calendar');
  if (!app.running()) return JSON.stringify({ running: false, events: [] });
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 3600 * 1000), to = new Date(now.getTime() + 2 * 3600 * 1000);
  const out = [];
  const cals = app.calendars();
  for (let i = 0; i < cals.length; i++) {
    let ev = [];
    try { ev = cals[i].events.whose({ _and: [{ startDate: { _lessThan: to } }, { endDate: { _greaterThan: from } }] })(); } catch (e) {}
    for (let j = 0; j < ev.length && out.length < 10; j++) out.push({ uid: ev[j].uid(), summary: ev[j].summary(), start: ev[j].startDate().toISOString(), calendar: cals[i].name() });
  }
  return JSON.stringify({ running: true, events: out });
}`,
  }),
  'calendar.show': T({
    id: 'calendar.show',
    description: 'Shows an existing event by uid using Calendar’s "show" command.',
    target: 'com.apple.iCal',
    verbs: ['read', 'show', 'activate'],
    source: `function run(argv) {
  const app = Application('Calendar');
  const cals = app.calendars();
  for (let i = 0; i < cals.length; i++) {
    const ev = cals[i].events.whose({ uid: argv[0] })();
    if (ev.length) { ev[0].show(); app.activate(); return JSON.stringify({ status: 'opened' }); }
  }
  return JSON.stringify({ status: 'not-found' });
}`,
  }),

  // ---------- Terminals ----------
  'terminal.ttys': T({
    id: 'terminal.ttys',
    description: 'Reads the tty device of each Terminal tab (never its contents or history).',
    target: 'com.apple.Terminal',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Terminal');
  if (!app.running()) return JSON.stringify({ running: false, tabs: [] });
  const out = [];
  const wins = app.windows();
  for (let i = 0; i < wins.length && i < 20; i++) {
    let tabs = [];
    try { tabs = wins[i].tabs(); } catch (e) { continue; }
    for (let j = 0; j < tabs.length && j < 20; j++) { try { out.push({ window: i, tty: tabs[j].tty(), selected: tabs[j].selected() }); } catch (e) {} }
  }
  return JSON.stringify({ running: true, tabs: out });
}`,
  }),
  'iterm.paths': T({
    id: 'iterm.paths',
    description:
      'Reads the working directory variable of each iTerm2 session (never its contents).',
    target: 'com.googlecode.iterm2',
    verbs: ['read'],
    source: `function run() {
  const app = Application('iTerm2');
  if (!app.running()) return JSON.stringify({ running: false, paths: [] });
  const out = [];
  const wins = app.windows();
  for (let i = 0; i < wins.length && i < 20; i++) {
    let tabs = [];
    try { tabs = wins[i].tabs(); } catch (e) { continue; }
    for (let j = 0; j < tabs.length && j < 20; j++) {
      try { const p = tabs[j].currentSession().variable({ named: 'path' }); if (p) out.push({ window: i, path: p }); } catch (e) {}
    }
  }
  return JSON.stringify({ running: true, paths: out });
}`,
  }),

  // ---------- Finder ----------
  'finder.windows': T({
    id: 'finder.windows',
    description: 'Reads the folder URLs shown in open Finder windows.',
    target: 'com.apple.finder',
    verbs: ['read'],
    source: `function run() {
  const app = Application('Finder');
  if (!app.running()) return JSON.stringify({ running: false, folders: [] });
  const out = [];
  try { const w = app.finderWindows(); for (let i = 0; i < w.length && i < 10; i++) { try { out.push({ url: w[i].target().url(), name: w[i].name() }); } catch (e) {} } } catch (e) {}
  return JSON.stringify({ running: true, folders: out });
}`,
  }),
} satisfies Record<string, ScriptTemplate>

export type ScriptId = keyof typeof SCRIPTS
export const SCRIPT_LIST: ScriptTemplate[] = Object.values(SCRIPTS)
