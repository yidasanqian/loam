/**
 * Frontend i18n, dependency-free.
 *
 * The shape follows the mature pattern used by i18next's language detector and
 * the WHATWG `navigator.languages` contract:
 *   1. an explicit user choice (localStorage) always wins;
 *   2. otherwise take the first supported language from `navigator.languages`
 *      using RFC 4647 lookup (match on the primary subtag);
 *   3. otherwise fall back to English.
 *
 * Dates go through Intl so the locale and the user's time zone are respected;
 * nothing is translated on the server, and stored facts keep their own language.
 */

const SUPPORTED = ['zh', 'en'];
const STORAGE_KEY = 'loam.lang';

/** key: [zh, en] — keep both sides the same length so `t` stays a plain index. */
const MESSAGES = {
  'app.title': ['loam · 项目记忆', 'loam · project memory'],

  'gate.title': ['接上你的项目记忆', 'Connect to your project memory'],
  'gate.lede': [
    '决策、坑与约定沉淀成一层壤土，跨设备、多种 harness 共用同一份。',
    'Decisions, pitfalls and conventions settle into one layer shared by every device and harness.',
  ],
  'gate.label': ['设备 token', 'Device token'],
  'gate.connect': ['连接', 'Connect'],
  'gate.help': ['token 从哪里来？', 'Where does the token come from?'],
  'gate.helpBody': [
    '本机已登录时，打开 ~/.loamrc.json 复制 token；或运行 loam login --server … --name 本机名。token 只保存在这个浏览器。',
    'If this machine is already logged in, open ~/.loamrc.json and copy the token, or run loam login --server … --name this-host. The token stays in this browser.',
  ],
  'gate.errorEmpty': ['先粘贴设备 token', 'Paste a device token first'],
  'gate.errorInvalid': ['token 无效或已被撤销', 'That token is invalid or revoked'],
  'gate.errorNetwork': ['连不上服务端，检查网络或代理后重试', 'Cannot reach the server. Check the network or proxy and retry.'],

  'topbar.project': ['项目', 'Project'],
  'topbar.projectFilter': ['筛选项目', 'Filter projects'],
  'topbar.noProject': ['还没有项目', 'No projects yet'],
  'topbar.search': ['搜索', 'Search'],
  'topbar.lang': ['切换语言', 'Switch language'],
  'topbar.devices': ['设备', 'Devices'],
  'topbar.export': ['导出', 'Export'],
  'topbar.logout': ['退出', 'Sign out'],

  'view.board': ['工作台', 'Board'],
  'view.timeline': ['时间轴', 'Timeline'],
  'view.triage': ['复盘', 'Review'],
  'view.model': ['原理', 'Model'],

  'banner.offline': ['连不上服务端，检查网络或代理。', 'Cannot reach the server. Check the network or proxy.'],
  'banner.rateLimit': ['请求过于频繁（60 次/分钟），稍后再试。', 'Too many requests (60/min). Try again shortly.'],
  'banner.retry': ['重试', 'Retry'],

  'pinned.title': ['常驻', 'Pinned'],

  'lane.empty': ['这一列还空着', 'This lane is empty'],
  'lane.more': ['加载更多', 'Load more'],
  'lane.add': ['在这一类下记录', 'Add to this lane'],
  'lane.error': ['这一列没加载出来', 'This lane failed to load'],
  'lane.retry': ['重试', 'Retry'],

  'board.emptyTitle': ['这里还是空地', 'Nothing planted yet'],
  'board.emptyHint': ['用下方输入框记第一条决策、坑或约定。', 'Use the box below to record the first decision, pitfall or convention.'],

  'capture.placeholder': [
    '记一条：什么决定、什么坑、什么约定…',
    'Record one: a decision, a pitfall, a convention…',
  ],
  'capture.tags': ['标签，逗号分隔', 'Tags, comma separated'],
  'capture.project': ['project', 'project'],
  'capture.add': ['记录', 'Record'],
  'capture.clearTarget': ['取消取代', 'Clear supersede'],
  'capture.target': ['将取代 {id}：新条目写在这里', 'Supersedes {id}: write the new fact here'],
  'capture.textRequired': ['写点什么再记录', 'Write something first'],
  'capture.projectRequired': ['先填 project 名称', 'A project name is required'],
  'capture.saved': ['已记录 {id}', 'Recorded {id}'],
  'capture.duplicate': ['已存在 {id}', 'Already exists {id}'],

  'kind.decision': ['决策', 'Decision'],
  'kind.pitfall': ['坑', 'Pitfall'],
  'kind.convention': ['约定', 'Convention'],
  'kind.fact': ['事实', 'Fact'],
  'kind.decision.desc': ['做过选择并且要长期遵守的结论。', 'A choice made once and kept.'],
  'kind.pitfall.desc': ['踩过一次、还会再踩的坑。', 'Something that broke once and will break again.'],
  'kind.convention.desc': ['项目里的惯例与写法。', 'How this project does things.'],
  'kind.fact.desc': ['中性的观察与事实。', 'A neutral observation.'],

  'shape.pinned': ['常驻', 'Pinned'],
  'shape.importance': ['热度', 'Importance'],
  'shape.supersede': ['取代', 'Supersede'],
  'shape.pinned.desc': ['注入上下文时优先，prune 不删。', 'Injected first; prune never touches it.'],
  'shape.importance.desc': ['排序权重，1 低 5 高，默认 3。', 'Rank weight, 1 low to 5 high, default 3.'],
  'shape.supersede.desc': ['新条目代替旧条目，旧条目退出默认召回。', 'A newer fact retires the old one from recall.'],

  'inspector.close': ['关闭', 'Close'],
  'inspector.chain': ['时态', 'State'],
  'inspector.chainSuperseded': ['已被 {id} 取代，默认不再召回。', 'Superseded by {id}; hidden from recall.'],
  'inspector.release': ['取消取代', 'Un-supersede'],
  'inspector.released': ['已恢复召回', 'Back in recall'],
  'inspector.edit': ['修订', 'Edit'],
  'inspector.editLabel': ['内容', 'Text'],
  'inspector.tagsLabel': ['标签', 'Tags'],
  'inspector.pin': ['固定为常驻', 'Pin'],
  'inspector.unpin': ['取消常驻', 'Unpin'],
  'inspector.supersede': ['标为过时', 'Mark outdated'],
  'inspector.copyId': ['复制 ID', 'Copy ID'],
  'inspector.copied': ['已复制 {id}', 'Copied {id}'],
  'inspector.importance': ['重要度 {n}', 'Importance {n}'],
  'inspector.meta': ['{harness} · {device} · {time}', '{harness} · {device} · {time}'],

  'common.save': ['保存', 'Save'],
  'common.cancel': ['取消', 'Cancel'],
  'common.delete': ['删除', 'Delete'],
  'common.undo': ['撤销', 'Undo'],

  'timeline.today': ['今天', 'Today'],
  'timeline.week': ['近 7 天', 'Last 7 days'],
  'timeline.month': ['近 30 天', 'Last 30 days'],
  'timeline.older': ['更早', 'Older'],
  'timeline.empty': ['这段时间没有记录。', 'Nothing recorded in this period.'],

  'triage.hint': ['一次一张：改类型、固定、修订，或跳过。', 'One at a time: reclassify, pin, edit, or skip.'],
  'triage.empty': ['没有待复盘的条目。', 'Nothing left to review.'],
  'triage.progress': ['{done} / {total}', '{done} / {total}'],
  'triage.prev': ['上一个', 'Previous'],
  'triage.next': ['下一个', 'Next'],
  'triage.pin': ['固定', 'Pin'],
  'triage.unpin': ['取消固定', 'Unpin'],
  'triage.edit': ['修订', 'Edit'],
  'triage.delete': ['删除', 'Delete'],
  'triage.skip': ['跳过', 'Skip'],
  'triage.done': ['这一轮复盘完成', 'Review round complete'],

  'search.placeholder': ['搜索记忆：关键词、坑、决策…', 'Search memory: keywords, pitfalls, decisions…'],
  'search.empty': ['没有命中，换个词试试。', 'No hits. Try another word.'],
  'search.superseded': ['已取代', 'superseded'],
  'search.hint': ['点一条打开详情；搜索按词 AND 匹配，最多 20 条。', 'Click a hit to open it. Terms are ANDed; at most 20 results.'],

  'devices.title': ['设备与 token', 'Devices and tokens'],
  'devices.hint': [
    '撤销立即生效，只影响该设备；当前设备被撤销后需要重新登录。',
    'Revocation applies immediately and only to that device. Revoking this device signs you out.',
  ],
  'devices.id': ['ID', 'ID'],
  'devices.name': ['设备', 'Device'],
  'devices.scopes': ['权限', 'Scopes'],
  'devices.seen': ['最近活跃', 'Last seen'],
  'devices.close': ['关闭', 'Close'],
  'devices.never': ['从未', 'Never'],
  'devices.revoked': ['已撤销', 'Revoked'],
  'devices.revoke': ['撤销', 'Revoke'],
  'devices.revokeConfirm': ['确认撤销', 'Confirm revoke'],
  'devices.empty': ['没有设备记录', 'No devices'],
  'devices.error': ['设备列表加载失败', 'Could not load devices'],

  'toast.saved': ['已保存', 'Saved'],
  'toast.deleted': ['已删除 {id}', 'Deleted {id}'],
  'toast.restored': ['已恢复 {id}', 'Restored {id}'],
  'toast.failed': ['操作失败：{message}', 'Failed: {message}'],
  'export.done': ['已导出 {n} 条', 'Exported {n} facts'],
  'export.failed': ['导出失败：{message}', 'Export failed: {message}'],

  'model.title': ['记忆模型工作原理', 'How the memory model works'],
  'model.desc': [
    '一条记忆从写入到被召回：哈希去重决定是否新增，常驻与热度决定排序，取代决定旧条目是否还出现，裁剪决定进入上下文多少行。',
    'A fact from write to recall: hashing decides whether it is new, pinning and importance decide rank, superseding retires the old row, and clipping decides how much enters the context.',
  ],
  'model.caption': [
    '写入按项目去重，召回按常驻与热度排序并按行数裁剪；被取代的条目留在历史里，不再进入上下文。',
    'Writes dedupe per project; recall ranks by pinning and importance, then clips by line budget. Superseded facts stay in history but leave the context.',
  ],
  'model.live': [
    '决策 {d} · 坑 {p} · 约定 {c} · 事实 {f} · 常驻 {pin} · 已取代 {s}',
    'decision {d} · pitfall {p} · convention {c} · fact {f} · pinned {pin} · superseded {s}',
  ],
  'model.band.write': ['① 写入', '① Write'],
  'model.band.shape': ['② 记忆的形状', '② Shape'],
  'model.band.read': ['③ 读取', '③ Recall'],
  'model.band.keep': ['④ 维护与同步', '④ Upkeep'],
  'model.write.entry': ['四个入口', 'Four entry points'],
  'model.write.entryHint': ['同一 project 共用同一份', 'One project, one shared memory'],
  'model.write.normalize': ['规范化 + 哈希', 'Normalize + hash'],
  'model.write.unique': ['唯一索引', 'Unique index'],
  'model.write.dedupe': ['重复写入 → 读回原行', 'Duplicate write → read the original row'],
  'model.shape.title': ['一条记忆 = 一句话 + 元数据', 'One fact = one sentence + metadata'],
  'model.shape.kind': ['kind · 决策 / 坑 / 约定 / 事实', 'kind · decision / pitfall / convention / fact'],
  'model.shape.pinned': ['★ pinned · 常驻，注入优先', '★ pinned · injected first'],
  'model.shape.importance': ['importance · 1–5 热度，默认 3', 'importance · 1–5 weight, default 3'],
  'model.shape.state': ['superseded_by · 时态', 'superseded_by · state'],
  'model.shape.note': [
    '四类决定列位；三个属性决定召回与排序。',
    'Kind picks a lane; attributes rank it.',
  ],
  'model.shape.note2': ['project 是隔离边界：不同项目互不可见。', 'project is the isolation boundary.'],
  'model.shape.supersede': ['新条目 ──取代──► 旧条目', 'new fact ──supersedes──► old fact'],
  'model.shape.hidden': ['旧条目退出默认召回，仍可在历史里查看', 'The old row leaves recall but stays in history'],
  'model.read.recall': ['召回', 'Recall'],
  'model.read.rank': ['排序', 'Rank'],
  'model.read.rankBy': ['★ > 热度 > 时间', '★ > importance > time'],
  'model.read.clip': ['裁剪', 'Clip'],
  'model.read.clipBy': ['≤5 条 · ≤6 行 · 每行 100 字', '≤5 facts · ≤6 lines · 100 chars each'],
  'model.read.inject': ['harness 注入：≤3 条，★ 优先', 'harness inject: ≤3 facts, pinned first'],
  'model.read.lanes': ['页面泳道：按时间倒序', 'board lanes: newest first'],
  'model.keep.outbox': ['断网 → outbox → flush', 'offline → outbox → flush'],
  'model.keep.outboxLine': ['幂等重放，不重复写', 'idempotent replay, never duplicates'],
  'model.keep.prune': ['prune --older 180d', 'prune --older 180d'],
  'model.keep.pruneLine': ['跳过 ★ 常驻', 'skips pinned facts'],
  'model.keep.delete': ['软删除 / 撤销', 'soft delete / undo'],
  'model.keep.deleteLine': ['同文本重新写入即恢复', 're-adding the same text revives it'],
};

let current = 'en';

export function normalizeLanguage(tag) {
  const base = String(tag ?? '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED.includes(base) ? base : null;
}

/** RFC 4647 style lookup over `navigator.languages`, then English. */
export function detectLanguage(stored) {
  const saved = normalizeLanguage(stored);
  if (saved) return saved;
  const candidates =
    Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const tag of candidates) {
    const match = normalizeLanguage(tag);
    if (match) return match;
  }
  return 'en';
}

export function getLanguage() {
  return current;
}

export function setLanguage(lang) {
  current = normalizeLanguage(lang) ?? 'en';
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
  return current;
}

export function otherLanguage() {
  return current === 'zh' ? 'en' : 'zh';
}

export function locale() {
  return current === 'zh' ? 'zh-CN' : 'en';
}

export function t(key, params) {
  const entry = MESSAGES[key];
  const text = entry ? entry[current === 'zh' ? 0 : 1] : key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** Fills every `data-i18n*` node in `root`. Safe to re-run after a language switch. */
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  document.title = t('app.title');
}

export function loadLanguage() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return setLanguage(detectLanguage(stored));
}

export function saveLanguage(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode: the session keeps the in-memory choice.
  }
}

const relativeFormatters = new Map();

function relativeFormatter() {
  const key = locale();
  let formatter = relativeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(key, { numeric: 'auto' });
    relativeFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatAge(ms, now = Date.now()) {
  const diff = now - ms;
  const units = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return relativeFormatter().format(-Math.round(diff / size), unit);
  }
  return relativeFormatter().format(0, 'minute');
}

export function formatDate(ms) {
  return new Intl.DateTimeFormat(locale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export { SUPPORTED as SUPPORTED_LANGUAGES, STORAGE_KEY };