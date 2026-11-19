/**
 * App shell: state, router, API, capture, inspector actions, language switch.
 * No framework, no build step; views.js renders, overlays.js owns the dialogs.
 */

import {
  applyTranslations,
  formatAge,
  formatDate,
  getLanguage,
  loadLanguage,
  otherLanguage,
  saveLanguage,
  setLanguage,
  t,
} from './i18n.js';
import { bindSearch, openDevices, openSearch } from './overlays.js';
import { fillInspector, renderBoard, renderModel, renderPinned, renderTimeline, renderTriage } from './views.js';

const TOKEN_KEY = 'loam.token';
const KINDS = ['decision', 'pitfall', 'convention', 'fact'];
const $ = (selector, root = document) => root.querySelector(selector);

const els = {
  gate: $('#gate'),
  gateForm: $('#gate-form'),
  token: $('#token'),
  gateError: $('#gate-error'),
  app: $('#app'),
  projectButton: $('#project-button'),
  projectName: $('#project-name'),
  projectMenu: $('#project-menu'),
  projectFilter: $('#project-filter'),
  projectList: $('#project-list'),
  projectsEmpty: $('#projects-empty'),
  captureProjectButton: $('#capture-project-button'),
  captureProjectLabel: $('#capture-project-label'),
  captureProjectMenu: $('#capture-project-menu'),
  captureProjectList: $('#capture-project-list'),
  captureProjectEmpty: $('#capture-project-empty'),
  viewTabs: [...document.querySelectorAll('.view-tab')],
  searchOpen: $('#search-open'),
  langToggle: $('#lang-toggle'),
  devicesOpen: $('#devices-open'),
  exportBtn: $('#export'),
  logout: $('#logout'),
  banner: $('#banner'),
  bannerText: $('#banner-text'),
  bannerRetry: $('#banner-retry'),
  pinned: $('#pinned'),
  pinnedList: $('#pinned-list'),
  pinnedCount: $('#pinned-count'),
  viewBoard: $('#view-board'),
  viewTimeline: $('#view-timeline'),
  viewTriage: $('#view-triage'),
  viewModel: $('#view-model'),
  lanes: $('#lanes'),
  boardEmpty: $('#board-empty'),
  buckets: $('#buckets'),
  timelineEmpty: $('#timeline-empty'),
  triageProgress: $('#triage-progress'),
  triageCard: $('#triage-card'),
  triageMeta: $('#triage-meta'),
  triageText: $('#triage-text'),
  triageTags: $('#triage-tags'),
  triageEmpty: $('#triage-empty'),
  triageKinds: $('#triage-kinds'),
  triagePrev: $('#triage-prev'),
  triageNext: $('#triage-next'),
  triagePin: $('#triage-pin'),
  triageEdit: $('#triage-edit'),
  triageDelete: $('#triage-delete'),
  triageSkip: $('#triage-skip'),
  modelLive: $('#model-live'),
  capture: $('#capture'),
  newText: $('#new-text'),
  newKindGroup: $('#new-kind-group'),
  newTags: $('#new-tags'),
  newProject: $('#new-project'),
  captureTarget: $('#capture-target'),
  captureTargetText: $('#capture-target-text'),
  captureClear: $('#capture-clear'),
  add: $('#add'),
  inspector: $('#inspector'),
  inspectorClose: $('#inspector-close'),
  inspectorKind: $('#inspector-kind'),
  inspectorDot: $('#inspector-dot'),
  inspectorAge: $('#inspector-age'),
  inspectorText: $('#inspector-text'),
  inspectorTags: $('#inspector-tags'),
  inspectorMeta: $('#inspector-meta'),
  inspectorChain: $('#inspector-chain'),
  inspectorChainBody: $('#inspector-chain-body'),
  inspectorRelease: $('#inspector-release'),
  editPanel: $('#edit-panel'),
  editText: $('#edit-text'),
  editTags: $('#edit-tags'),
  editSave: $('#edit-save'),
  editCancel: $('#edit-cancel'),
  editOpen: $('#edit-open'),
  importance: $('#importance'),
  pinToggle: $('#pin-toggle'),
  supersede: $('#supersede'),
  copyId: $('#copy-id'),
  delete: $('#delete'),
  searchDialog: $('#search-dialog'),
  searchInput: $('#search-input'),
  searchResults: $('#search-results'),
  searchEmpty: $('#search-empty'),
  devicesDialog: $('#devices-dialog'),
  devicesClose: $('#devices-close'),
  deviceRows: $('#device-rows'),
  devicesError: $('#devices-error'),
  toast: $('#toast'),
  toastText: $('#toast-text'),
  toastUndo: $('#toast-undo'),
};

const templates = {
  card: $('#card-template'),
  lane: $('#lane-template'),
  project: $('#project-template'),
  device: $('#device-template'),
  result: $('#result-template'),
};

const state = {
  token: '',
  me: null,
  projects: [],
  project: null,
  view: 'board',
  stats: null,
  lanes: {},
  pinned: [],
  timeline: null,
  triage: { queue: [], index: 0, loaded: false },
  selected: null,
  dragging: null,
  captureKind: 'fact',
  supersedes: null,
  loadingBoard: false,
  undo: null,
};

for (const kind of KINDS) state.lanes[kind] = { items: [], cursor: null, loading: false, error: null, seq: 0 };

const VIEW_HASH = { board: 'b', timeline: 't', triage: 'r', model: 'm' };
const HASH_VIEW = { b: 'board', t: 'timeline', r: 'triage', m: 'model' };
const DAY = 86_400_000;

/* ---------- plumbing ---------- */

async function request(path, { method = 'GET', body, token = state.token } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'network');
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { response, data };
}

async function api(path, options) {
  const { response, data } = await request(path, options);
  if (response.status === 401) {
    signOut(t('gate.errorInvalid'));
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function shortId(id) {
  return String(id ?? '').slice(0, 8);
}

function splitTags(raw) {
  const seen = new Set();
  for (const part of raw.split(',')) {
    const tag = part.trim().toLowerCase();
    if (tag && !seen.has(tag)) seen.add(tag);
  }
  return [...seen].slice(0, 8);
}

let toastTimer = 0;

function toast(message, { error = false, undo = null } = {}) {
  els.toastText.textContent = message;
  els.toast.classList.toggle('is-error', error);
  els.toast.classList.add('is-shown');
  els.toastUndo.hidden = !undo;
  state.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove('is-shown');
    state.undo = null;
  }, 6000);
}

function showBanner(show, message = '') {
  els.banner.hidden = !show;
  if (show) els.bannerText.textContent = message || t('banner.offline');
}

function errorText(error) {
  return error?.status === 429 ? t('banner.rateLimit') : error?.message || t('banner.offline');
}

/* ---------- language ---------- */

function updateLangToggle() {
  els.langToggle.textContent = getLanguage() === 'zh' ? 'EN' : '中';
}

function switchLanguage() {
  const next = otherLanguage();
  setLanguage(next);
  saveLanguage(next);
  applyTranslations();
  buildCaptureKinds();
  buildImportance();
  updateLangToggle();
  if (state.selected) {
    const fact = findFact(state.selected.id) ?? state.selected;
    state.selected = fact;
    fillInspector(ctx, fact);
  }
  renderAllViews();
}

/* ---------- session ---------- */

function showGate(message = '') {
  els.app.hidden = true;
  els.gate.hidden = false;
  els.gateError.textContent = message;
}

function signOut(message = '') {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clean up.
  }
  state.token = '';
  state.me = null;
  state.selected = null;
  els.inspector.close();
  for (const dialog of [els.searchDialog, els.devicesDialog]) if (dialog.open) dialog.close();
  els.token.value = '';
  showGate(message);
}

async function onConnect(event) {
  event.preventDefault();
  const token = els.token.value.trim();
  if (!token) {
    els.gateError.textContent = t('gate.errorEmpty');
    return;
  }
  els.gateError.textContent = '';
  try {
    const { response, data } = await request('/v1/me', { token });
    if (!response.ok) {
      els.gateError.textContent = response.status === 401 ? t('gate.errorInvalid') : `HTTP ${response.status}`;
      return;
    }
    state.token = token;
    state.me = data.device;
    localStorage.setItem(TOKEN_KEY, token);
    enterApp();
  } catch {
    els.gateError.textContent = t('gate.errorNetwork');
  }
}

async function restoreSession(token) {
  try {
    const { response, data } = await request('/v1/me', { token });
    if (!response.ok) {
      signOut(response.status === 401 ? t('gate.errorInvalid') : '');
      return;
    }
    state.token = token;
    state.me = data.device;
    enterApp();
  } catch {
    showGate(t('gate.errorNetwork'));
  }
}

function enterApp() {
  els.gate.hidden = true;
  els.app.hidden = false;
  showBanner(false);
  void bootApp();
}

/* ---------- routing ---------- */

function readRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const view = HASH_VIEW[parts[0]] ?? 'board';
  const project = parts[1] ? decodeURIComponent(parts[1]) : null;
  const id = new URLSearchParams(queryPart).get('id');
  return { view, project, id };
}

function routeHash({ view, project, id }) {
  const path = `/${VIEW_HASH[view] ?? 'b'}${project ? `/${encodeURIComponent(project)}` : ''}`;
  return `#${path}${id ? `?id=${encodeURIComponent(id)}` : ''}`;
}

function writeRoute(next, { replace = false } = {}) {
  const hash = routeHash(next);
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

function setView(view) {
  state.view = view;
  for (const tab of els.viewTabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const section of [els.viewBoard, els.viewTimeline, els.viewTriage, els.viewModel]) {
    section.hidden = section.id !== `view-${view}`;
  }
}

function applyRoute() {
  const route = readRoute();
  const projectChanged = Boolean(route.project) && route.project !== state.project;
  if (route.project) state.project = route.project;
  setView(route.view);
  if (!state.project) {
    renderAllViews();
    return;
  }
  if (projectChanged) {
    resetProjectState();
    void loadProjectData();
  } else {
    ensureViewData(route.view);
  }
  if (route.id) {
    if (!state.selected || state.selected.id !== route.id) void openInspector(route.id, { route: false });
  } else if (state.selected) {
    closeInspector({ route: false });
  }
  renderAllViews();
}

function ensureViewData(view) {
  if (view === 'timeline' && !state.timeline) void loadTimeline();
  if (view === 'triage' && !state.triage.loaded) void loadTriage();
  if (view === 'model') renderModel(ctx);
}

async function bootApp() {
  const loaded = await loadProjects();
  if (!loaded) {
    renderAllViews();
    return;
  }
  const route = readRoute();
  const target = route.project ?? state.projects[0]?.project ?? null;
  if (!target) {
    state.project = null;
    renderAllViews();
    return;
  }
  writeRoute({ view: route.view, project: target, id: route.id }, { replace: true });
  applyRoute();
}

/* ---------- projects ---------- */

async function loadProjects() {
  try {
    const data = await api('/v1/projects');
    state.projects = data.projects ?? [];
    renderProjects();
    return true;
  } catch {
    showBanner(true);
    return false;
  }
}

function renderProjects() {
  const filter = els.projectFilter.value.trim().toLowerCase();
  const visible = filter
    ? state.projects.filter((entry) => entry.project.toLowerCase().includes(filter))
    : state.projects;
  els.projectList.replaceChildren(
    ...visible.map((entry) => {
      const item = templates.project.content.firstElementChild.cloneNode(true);
      const button = item.querySelector('.project');
      button.classList.toggle('is-active', entry.project === state.project);
      item.querySelector('.project-name').textContent = entry.project;
      item.querySelector('.project-count').textContent = String(entry.facts);
      button.addEventListener('click', () => selectProject(entry.project));
      return item;
    }),
  );
  els.projectsEmpty.hidden = state.projects.length > 0;
  els.projectName.textContent = state.project ?? '—';
  els.captureProjectList.replaceChildren(
    ...state.projects.map((entry) => {
      const item = templates.project.content.firstElementChild.cloneNode(true);
      const button = item.querySelector('.project');
      button.classList.toggle('is-active', entry.project === captureProject());
      item.querySelector('.project-name').textContent = entry.project;
      item.querySelector('.project-count').textContent = String(entry.facts);
      button.addEventListener('click', () => chooseCaptureProject(entry.project));
      return item;
    }),
  );
  els.captureProjectEmpty.hidden = state.projects.length > 0;
  renderCaptureProject();
}

/* 捕获条的项目选择：默认跟随当前项目，选了别的只影响下一条记录。 */
function captureProject() {
  return els.newProject.value.trim() || state.project || '';
}

function renderCaptureProject() {
  els.captureProjectLabel.textContent = captureProject() || t('capture.project');
  els.captureProjectButton.setAttribute('aria-expanded', String(!els.captureProjectMenu.hidden));
}

function chooseCaptureProject(project) {
  els.newProject.value = project === state.project ? '' : project;
  els.captureProjectMenu.hidden = true;
  renderCaptureProject();
  els.newText.focus();
}

function selectProject(project) {
  els.projectMenu.hidden = true;
  els.projectButton.setAttribute('aria-expanded', 'false');
  if (!project) return;
  if (project === state.project) return;
  writeRoute({ view: state.view, project, id: null });
}

/* ---------- loading ---------- */

function resetProjectState() {
  state.stats = null;
  state.pinned = [];
  state.timeline = null;
  state.triage = { queue: [], index: 0, loaded: false };
  state.selected = null;
  state.loadingBoard = true;
  if (els.inspector.open) els.inspector.close();
  for (const kind of KINDS) state.lanes[kind] = { items: [], cursor: null, loading: false, error: null, seq: 0 };
}

async function loadStats(project = state.project) {
  try {
    const data = await api(`/v1/stats?project=${encodeURIComponent(project)}`);
    if (state.project === project) state.stats = data;
  } catch (error) {
    if (state.project === project) showBanner(true, errorText(error));
  }
}

async function loadPinned(project = state.project) {
  const params = new URLSearchParams({ project, pinned: '1', sort: 'rank', limit: '8' });
  try {
    const data = await api(`/v1/facts?${params.toString()}`);
    if (state.project === project) state.pinned = data.facts;
  } catch {
    if (state.project === project) state.pinned = [];
  }
}

async function loadLane(kind, { reset = false, append = false } = {}) {
  const lane = state.lanes[kind];
  if (!lane || !state.project) return;
  const project = state.project;
  const seq = (lane.seq += 1);
  if (reset) {
    lane.items = [];
    lane.cursor = null;
  }
  lane.loading = true;
  lane.error = null;
  renderBoard(ctx);
  const params = new URLSearchParams({ project, kind, sort: 'recent', limit: '30' });
  if (append && lane.cursor) params.set('cursor', lane.cursor);
  try {
    const data = await api(`/v1/facts?${params.toString()}`);
    if (seq !== lane.seq || state.project !== project) return;
    lane.items = append ? lane.items.concat(data.facts) : data.facts;
    lane.cursor = data.next;
  } catch (error) {
    if (seq !== lane.seq) return;
    lane.error = errorText(error);
  } finally {
    if (seq === lane.seq) {
      lane.loading = false;
      renderBoard(ctx);
      renderChrome();
    }
  }
}

async function loadProjectData() {
  const project = state.project;
  state.loadingBoard = true;
  showBanner(false);
  await Promise.all([
    loadStats(project),
    loadPinned(project),
    ...KINDS.map((kind) => loadLane(kind, { reset: true })),
  ]);
  if (state.project !== project) return;
  state.loadingBoard = false;
  renderAllViews();
  if (state.view === 'timeline') void loadTimeline();
  if (state.view === 'triage') void loadTriage();
}

async function loadTimeline() {
  const project = state.project;
  try {
    const data = await api(`/v1/facts?project=${encodeURIComponent(project)}&sort=recent&limit=50`);
    if (state.project !== project) return;
    state.timeline = { items: data.facts, loaded: true };
    renderTimeline(ctx);
  } catch {
    showBanner(true);
  }
}

async function loadTriage() {
  const project = state.project;
  try {
    const data = await api(`/v1/facts?project=${encodeURIComponent(project)}&sort=rank&limit=50`);
    if (state.project !== project) return;
    state.triage = { queue: data.facts, index: 0, loaded: true };
    renderTriage(ctx);
  } catch {
    showBanner(true);
  }
}

async function refreshProject() {
  const project = state.project;
  if (!project) return;
  showBanner(false);
  await Promise.all([
    loadStats(project),
    loadPinned(project),
    ...KINDS.map((kind) => loadLane(kind, { reset: true })),
  ]);
  if (state.project !== project) return;
  if (state.timeline) await loadTimeline();
  if (state.view === 'triage') await loadTriage();
  renderAllViews();
}

/* ---------- local fact updates ---------- */

function findFact(id) {
  const pools = [
    state.pinned,
    ...KINDS.map((kind) => state.lanes[kind].items),
    state.timeline?.items ?? [],
    state.triage.queue,
  ];
  for (const pool of pools) {
    const hit = pool.find((fact) => fact.id === id);
    if (hit) return hit;
  }
  return null;
}

function insertByCreatedAt(items, fact) {
  const index = items.findIndex((item) => item.createdAt < fact.createdAt);
  if (index === -1) items.push(fact);
  else items.splice(index, 0, fact);
}

function applyFactUpdate(before, fact) {
  const laneKinds = KINDS.filter((kind) => state.lanes[kind].items.some((item) => item.id === fact.id));
  const wasPinned = state.pinned.some((item) => item.id === fact.id);
  const wasInTimeline = Boolean(state.timeline?.items.some((item) => item.id === fact.id));

  for (const kind of KINDS) state.lanes[kind].items = state.lanes[kind].items.filter((item) => item.id !== fact.id);
  state.pinned = state.pinned.filter((item) => item.id !== fact.id);
  if (state.timeline) state.timeline.items = state.timeline.items.filter((item) => item.id !== fact.id);
  state.triage.queue = state.triage.queue.map((item) => (item.id === fact.id ? fact : item));

  if (laneKinds.length > 0 && !fact.supersededBy) insertByCreatedAt(state.lanes[fact.kind].items, fact);
  if (fact.pinned) {
    state.pinned.push(fact);
    state.pinned.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.importance ?? 3) - (a.importance ?? 3) || b.createdAt - a.createdAt);
  }
  if (wasInTimeline && !fact.supersededBy) insertByCreatedAt(state.timeline.items, fact);

  if (state.stats) {
    if (before && before.kind !== fact.kind) {
      state.stats.byKind[before.kind] = Math.max(0, state.stats.byKind[before.kind] - 1);
      state.stats.byKind[fact.kind] += 1;
    }
    if (before && before.pinned !== fact.pinned) state.stats.pinned += fact.pinned ? 1 : -1;
    if (before && !before.supersededBy && fact.supersededBy) state.stats.superseded += 1;
    if (before && before.supersededBy && !fact.supersededBy) state.stats.superseded = Math.max(0, state.stats.superseded - 1);
  }
  if (wasPinned && !fact.pinned) {
    // Already removed above; the stats line above kept the counter honest.
  }
}

function removeLocally(fact) {
  for (const kind of KINDS) state.lanes[kind].items = state.lanes[kind].items.filter((item) => item.id !== fact.id);
  state.pinned = state.pinned.filter((item) => item.id !== fact.id);
  if (state.timeline) state.timeline.items = state.timeline.items.filter((item) => item.id !== fact.id);
  state.triage.queue = state.triage.queue.filter((item) => item.id !== fact.id);
  if (state.stats) {
    state.stats.facts = Math.max(0, state.stats.facts - 1);
    state.stats.byKind[fact.kind] = Math.max(0, state.stats.byKind[fact.kind] - 1);
    if (fact.pinned) state.stats.pinned = Math.max(0, state.stats.pinned - 1);
    if (fact.supersededBy) state.stats.superseded = Math.max(0, state.stats.superseded - 1);
  }
  if (state.selected?.id === fact.id) closeInspector({ route: false });
}

/* ---------- inspector ---------- */

function markSelected() {
  for (const card of document.querySelectorAll('.card.is-selected')) card.classList.remove('is-selected');
  if (!state.selected) return;
  for (const card of document.querySelectorAll(`.card[data-id="${state.selected.id}"]`)) card.classList.add('is-selected');
}

async function openInspector(id, { route = true } = {}) {
  let fact = findFact(id);
  if (!fact) {
    try {
      fact = (await api(`/v1/facts/${encodeURIComponent(id)}`)).fact;
    } catch {
      return;
    }
  }
  state.selected = fact;
  fillInspector(ctx, fact);
  if (!els.inspector.open) els.inspector.show();
  if (route) writeRoute({ ...readRoute(), id: fact.id }, { replace: true });
  markSelected();
}

function closeInspector({ route = true } = {}) {
  state.selected = null;
  if (els.inspector.open) els.inspector.close();
  if (route) writeRoute({ ...readRoute(), id: null }, { replace: true });
  markSelected();
}

async function patchFact(id, body) {
  const before = findFact(id) ?? state.selected;
  const data = await api(`/v1/facts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  const fact = data.fact;
  applyFactUpdate(before, fact);
  if (state.selected?.id === fact.id) {
    state.selected = fact;
    fillInspector(ctx, fact);
  }
  if (before?.pinned !== fact.pinned) await loadPinned(fact.project);
  renderAllViews();
  return fact;
}

async function moveKind(id, kind) {
  const fact = findFact(id) ?? state.selected;
  if (!fact || !kind || fact.kind === kind) return;
  try {
    await patchFact(fact.id, { kind });
    toast(t('toast.saved'));
  } catch (error) {
    toast(t('toast.failed', { message: error.message }), { error: true });
  }
}

async function setImportance(fact, n) {
  try {
    await patchFact(fact.id, { importance: n });
  } catch (error) {
    toast(t('toast.failed', { message: error.message }), { error: true });
  }
}

async function togglePin(fact) {
  try {
    await patchFact(fact.id, { pinned: !fact.pinned });
  } catch (error) {
    toast(t('toast.failed', { message: error.message }), { error: true });
  }
}

async function removeFact(fact) {
  try {
    await api(`/v1/facts/${encodeURIComponent(fact.id)}`, { method: 'DELETE' });
    removeLocally(fact);
    renderAllViews();
    toast(t('toast.deleted', { id: shortId(fact.id) }), { undo: () => restoreFact(fact) });
  } catch (error) {
    toast(t('toast.failed', { message: error.message }), { error: true });
  }
}

async function restoreFact(fact) {
  try {
    await api('/v1/facts', {
      method: 'POST',
      body: {
        project: fact.project,
        kind: fact.kind,
        text: fact.text,
        tags: fact.tags,
        harness: fact.harness,
        importance: fact.importance,
        pinned: fact.pinned,
      },
    });
    toast(t('toast.restored', { id: shortId(fact.id) }));
    await refreshProject();
  } catch (error) {
    toast(t('toast.failed', { message: error.message }), { error: true });
  }
}

/* ---------- capture ---------- */

function buildCaptureKinds() {
  els.newKindGroup.replaceChildren(
    ...KINDS.map((kind) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = t(`kind.${kind}`);
      button.setAttribute('aria-pressed', String(state.captureKind === kind));
      button.addEventListener('click', () => {
        state.captureKind = kind;
        buildCaptureKinds();
      });
      return button;
    }),
  );
}

function startCapture(kind) {
  if (kind) {
    state.captureKind = kind;
    buildCaptureKinds();
  }
  els.newText.focus();
}

function startSupersede(fact) {
  state.supersedes = fact.id;
  state.captureKind = fact.kind;
  buildCaptureKinds();
  els.captureTarget.hidden = false;
  els.captureTargetText.textContent = t('capture.target', { id: shortId(fact.id) });
  els.newText.value = fact.text;
  closeInspector({ route: false });
  els.newText.focus();
}

function clearSupersede() {
  state.supersedes = null;
  els.captureTarget.hidden = true;
}

function defaultProject() {
  return els.newProject.value.trim() || state.project || state.projects[0]?.project || '';
}

async function addFact(event) {
  event.preventDefault();
  const text = els.newText.value.trim();
  if (!text) {
    toast(t('capture.textRequired'), { error: true });
    els.newText.focus();
    return;
  }
  const project = defaultProject();
  if (!project) {
    toast(t('capture.projectRequired'), { error: true });
    els.captureProjectButton.focus();
    return;
  }
  const body = {
    project,
    kind: state.captureKind,
    text,
    tags: splitTags(els.newTags.value),
    harness: 'web',
    importance: 3,
  };
  if (state.supersedes) body.supersedes = state.supersedes;
  els.add.disabled = true;
  try {
    const data = await api('/v1/facts', { method: 'POST', body });
    els.newText.value = '';
    els.newTags.value = '';
    els.newProject.value = '';
    clearSupersede();
    toast(
      data.deduped
        ? t('capture.duplicate', { id: shortId(data.fact.id) })
        : t('capture.saved', { id: shortId(data.fact.id) }),
    );
    if (project !== state.project) {
      await loadProjects();
      writeRoute({ view: state.view, project, id: null });
    } else if (data.supersededTarget) {
      // A retired fact can live in another lane; reload the whole project.
      await loadProjects();
      await refreshProject();
    } else {
      await Promise.all([loadStats(), loadLane(data.fact.kind, { reset: true })]);
      if (data.fact.pinned) await loadPinned();
      renderAllViews();
    }
  } catch (error) {
    toast(t('toast.failed', { message: error.message }), { error: true });
  } finally {
    els.add.disabled = false;
  }
}

/* ---------- devices / export ---------- */

async function exportNdjson() {
  if (!state.project) return;
  els.exportBtn.disabled = true;
  try {
    const lines = [];
    let cursor = null;
    do {
      const params = new URLSearchParams({ project: state.project, limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const data = await api(`/v1/export?${params.toString()}`);
      for (const fact of data.facts) {
        lines.push(
          JSON.stringify({
            project: fact.project,
            kind: fact.kind,
            text: fact.text,
            tags: fact.tags,
            harness: fact.harness,
            pinned: fact.pinned,
            importance: fact.importance,
            created_at: fact.createdAt,
          }),
        );
      }
      cursor = data.next;
    } while (cursor);
    const blob = new Blob([lines.length ? `${lines.join('\n')}\n` : ''], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `loam-${state.project}-${new Date().toISOString().slice(0, 10)}.ndjson`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(t('export.done', { n: lines.length }));
  } catch (error) {
    toast(t('export.failed', { message: error.message }), { error: true });
  } finally {
    els.exportBtn.disabled = false;
  }
}

/* ---------- render ---------- */

function renderChrome() {
  els.projectName.textContent = state.project ?? '—';
  els.projectButton.setAttribute('aria-expanded', String(!els.projectMenu.hidden));
  renderProjects();
}

function renderAllViews() {
  renderBoard(ctx);
  renderPinned(ctx);
  renderTimeline(ctx);
  renderTriage(ctx);
  if (state.view === 'model') renderModel(ctx);
  renderChrome();
  markSelected();
}

/* ---------- bindings ---------- */

function buildImportance() {
  els.importance.replaceChildren(
    ...[1, 2, 3, 4, 5].map((n) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.n = String(n);
      button.textContent = String(n);
      button.setAttribute('aria-label', t('inspector.importance', { n }));
      button.addEventListener('click', () => {
        if (state.selected) void setImportance(state.selected, n);
      });
      return button;
    }),
  );
}

function bind() {
  els.gateForm.addEventListener('submit', onConnect);

  els.viewTabs.forEach((tab) => {
    tab.addEventListener('click', () => writeRoute({ ...readRoute(), view: tab.dataset.view, id: null }));
  });

  els.projectButton.addEventListener('click', () => {
    els.projectMenu.hidden = !els.projectMenu.hidden;
    els.projectButton.setAttribute('aria-expanded', String(!els.projectMenu.hidden));
    if (!els.projectMenu.hidden) els.projectFilter.focus();
  });
  els.projectFilter.addEventListener('input', renderProjects);
  document.addEventListener('click', (event) => {
    if (els.projectMenu.hidden) return;
    if (event.target.closest('.project-switch')) return;
    els.projectMenu.hidden = true;
    els.projectButton.setAttribute('aria-expanded', 'false');
  });

  els.captureProjectButton.addEventListener('click', () => {
    els.captureProjectMenu.hidden = !els.captureProjectMenu.hidden;
    renderCaptureProject();
  });
  document.addEventListener('click', (event) => {
    if (els.captureProjectMenu.hidden) return;
    if (event.target.closest('.project-pick')) return;
    els.captureProjectMenu.hidden = true;
    renderCaptureProject();
  });

  els.searchOpen.addEventListener('click', () => openSearch(ctx));
  els.langToggle.addEventListener('click', switchLanguage);
  els.devicesOpen.addEventListener('click', () => openDevices(ctx));
  els.exportBtn.addEventListener('click', () => void exportNdjson());
  els.logout.addEventListener('click', () => signOut());
  els.devicesClose.addEventListener('click', () => els.devicesDialog.close());
  els.bannerRetry.addEventListener('click', () => {
    showBanner(false);
    void refreshProject();
    void loadProjects();
  });

  els.capture.addEventListener('submit', addFact);
  els.newText.addEventListener('input', () => {
    els.newText.style.height = 'auto';
    els.newText.style.height = `${Math.min(els.newText.scrollHeight, 120)}px`;
  });
  els.captureClear.addEventListener('click', clearSupersede);

  els.triagePrev.addEventListener('click', () => {
    state.triage.index = Math.max(0, state.triage.index - 1);
    renderTriage(ctx);
  });
  els.triageNext.addEventListener('click', () => {
    state.triage.index = Math.min(state.triage.queue.length, state.triage.index + 1);
    renderTriage(ctx);
  });
  els.triageSkip.addEventListener('click', () => {
    state.triage.index = Math.min(state.triage.queue.length, state.triage.index + 1);
    renderTriage(ctx);
  });
  els.triagePin.addEventListener('click', () => {
    const fact = state.triage.queue[state.triage.index];
    if (fact) void togglePin(fact);
  });
  els.triageEdit.addEventListener('click', () => {
    const fact = state.triage.queue[state.triage.index];
    if (fact) void openInspector(fact.id);
  });
  els.triageDelete.addEventListener('click', () => {
    const fact = state.triage.queue[state.triage.index];
    if (fact) void removeFact(fact);
  });

  els.inspectorClose.addEventListener('click', () => closeInspector());
  els.pinToggle.addEventListener('click', () => {
    if (state.selected) void togglePin(state.selected);
  });
  els.supersede.addEventListener('click', () => {
    if (state.selected) startSupersede(state.selected);
  });
  els.delete.addEventListener('click', () => {
    if (state.selected) void removeFact(state.selected);
  });
  els.copyId.addEventListener('click', async () => {
    if (!state.selected) return;
    try {
      await navigator.clipboard.writeText(state.selected.id);
      toast(t('inspector.copied', { id: shortId(state.selected.id) }));
    } catch {
      toast(t('toast.failed', { message: 'clipboard' }), { error: true });
    }
  });
  els.inspectorRelease.addEventListener('click', async () => {
    if (!state.selected) return;
    try {
      await patchFact(state.selected.id, { supersededBy: null });
      toast(t('inspector.released'));
    } catch (error) {
      toast(t('toast.failed', { message: error.message }), { error: true });
    }
  });
  els.editOpen.addEventListener('click', () => {
    if (!state.selected) return;
    els.editText.value = state.selected.text;
    els.editTags.value = (state.selected.tags || []).join(', ');
    els.editPanel.hidden = false;
    els.editText.focus();
  });
  els.editCancel.addEventListener('click', () => {
    els.editPanel.hidden = true;
  });
  els.editSave.addEventListener('click', async () => {
    if (!state.selected) return;
    const text = els.editText.value.trim();
    if (!text) return;
    els.editSave.disabled = true;
    try {
      await patchFact(state.selected.id, { text, tags: splitTags(els.editTags.value) });
      els.editPanel.hidden = true;
      toast(t('toast.saved'));
    } catch (error) {
      toast(t('toast.failed', { message: error.message }), { error: true });
    } finally {
      els.editSave.disabled = false;
    }
  });

  els.toastUndo.addEventListener('click', () => {
    const action = state.undo;
    state.undo = null;
    els.toast.classList.remove('is-shown');
    if (action) void action();
  });

  els.searchDialog.addEventListener('click', (event) => {
    if (event.target === els.searchDialog) els.searchDialog.close();
  });
  els.devicesDialog.addEventListener('click', (event) => {
    if (event.target === els.devicesDialog) els.devicesDialog.close();
  });

  window.addEventListener('hashchange', applyRoute);
}

const ctx = {
  els,
  state,
  templates,
  t,
  formatAge,
  formatDate,
  api,
  toast,
  openInspector,
  loadMore: (kind) => void loadLane(kind, { append: true }),
  reloadLane: (kind) => void loadLane(kind, { reset: true }),
  moveKind,
  startCapture,
  signOut,
};

/* ---------- version ---------- */

/** `/health` is public and answered by both the Worker and Pages Functions. */
async function loadVersion() {
  const nodes = document.querySelectorAll('.app-version');
  if (nodes.length === 0) return;
  try {
    const response = await fetch('/health', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data?.version !== 'string' || !data.version) return;
    for (const node of nodes) node.textContent = `v${data.version}`;
  } catch {
    /* offline or blocked: keep the placeholder */
  }
}

/* ---------- boot ---------- */

function init() {
  loadLanguage();
  applyTranslations();
  updateLangToggle();
  void loadVersion();
  buildCaptureKinds();
  buildImportance();
  bind();
  bindSearch(ctx);
  els.newProject.value = '';
  let saved = null;
  try {
    saved = localStorage.getItem(TOKEN_KEY);
  } catch {
    saved = null;
  }
  if (saved) void restoreSession(saved);
  else showGate();
}

init();