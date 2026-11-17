'use strict';

const TOKEN_KEY = 'loam.token';
const KIND_LABEL = { decision: '决策', pitfall: '坑', convention: '约定', fact: '事实' };
const PAGE_SIZE = 20;
const $ = (selector, root = document) => root.querySelector(selector);

const state = {
  token: '',
  me: null,
  projects: [],
  project: null,
  kind: '',
  tag: '',
  q: '',
  facts: [],
  cursor: null,
  loading: false,
};

const els = {
  gate: $('#gate'),
  gateForm: $('#gate-form'),
  token: $('#token'),
  gateError: $('#gate-error'),
  app: $('#app'),
  deviceName: $('#device-name'),
  deviceId: $('#device-id'),
  projectList: $('#projects'),
  projectsEmpty: $('#projects-empty'),
  projectOptions: $('#project-options'),
  allProjects: $('#all-projects'),
  kinds: $('#kinds'),
  tag: $('#tag'),
  totalCount: $('#total-count'),
  q: $('#q'),
  refresh: $('#refresh'),
  newText: $('#new-text'),
  newKind: $('#new-kind'),
  newTags: $('#new-tags'),
  newProject: $('#new-project'),
  add: $('#add'),
  list: $('#list'),
  more: $('#more'),
  listFoot: $('#list-foot'),
  exportBtn: $('#export'),
  devicesBtn: $('#open-devices'),
  logout: $('#logout'),
  editDialog: $('#edit-dialog'),
  editForm: $('#edit-form'),
  editText: $('#edit-text'),
  editKind: $('#edit-kind'),
  editTags: $('#edit-tags'),
  editCancel: $('#edit-cancel'),
  editSave: $('#edit-save'),
  devicesDialog: $('#devices-dialog'),
  devicesClose: $('#devices-close'),
  deviceRows: $('#device-rows'),
  devicesError: $('#devices-error'),
  toast: $('#toast'),
  factTemplate: $('#fact-template'),
  projectTemplate: $('#project-template'),
  deviceTemplate: $('#device-template'),
};

let editingId = null;
let toastTimer = 0;

/* ---------- plumbing ---------- */

async function request(path, { method = 'GET', body, token = state.token } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`网络不可用：${error instanceof Error ? error.message : 'unknown'}`);
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
    signOut('token 已失效，请重新连接');
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

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', isError);
  els.toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('is-shown'), 3200);
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

function splitTags(raw) {
  const seen = new Set();
  for (const part of raw.split(',')) {
    const tag = part.trim().toLowerCase();
    if (tag && !seen.has(tag)) seen.add(tag);
  }
  return [...seen].slice(0, 8);
}

function formatTime(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortId(id) {
  return String(id).slice(0, 8);
}

/* ---------- gate ---------- */

function showGate(message = '') {
  els.app.hidden = true;
  els.gate.hidden = false;
  els.gateError.textContent = message;
}

function signOut(message = '') {
  localStorage.removeItem(TOKEN_KEY);
  state.token = '';
  state.me = null;
  state.facts = [];
  state.cursor = null;
  els.token.value = '';
  showGate(message);
}

async function onConnect(event) {
  event.preventDefault();
  const token = els.token.value.trim();
  if (!token) {
    els.gateError.textContent = '先粘贴设备 token';
    return;
  }
  els.gateError.textContent = '';
  try {
    const { response, data } = await request('/v1/me', { token });
    if (!response.ok) {
      els.gateError.textContent = response.status === 401 ? 'token 无效或已被撤销' : `连接失败：HTTP ${response.status}`;
      return;
    }
    state.token = token;
    state.me = data.device;
    localStorage.setItem(TOKEN_KEY, token);
    enterApp();
  } catch (error) {
    els.gateError.textContent = error.message;
  }
}

async function restoreSession(token) {
  try {
    const { response, data } = await request('/v1/me', { token });
    if (!response.ok) {
      signOut(response.status === 401 ? 'token 已失效，请重新连接' : '');
      return;
    }
    state.token = token;
    state.me = data.device;
    enterApp();
  } catch {
    showGate('连不上服务端，检查网络或代理后重试');
  }
}

function enterApp() {
  els.gate.hidden = true;
  els.app.hidden = false;
  els.deviceName.textContent = state.me.name;
  els.deviceId.textContent = shortId(state.me.id);
  refreshAll();
}

/* ---------- projects ---------- */

function defaultProject() {
  return els.newProject.value.trim() || state.project || state.projects[0]?.project || '';
}

function syncProjectInput() {
  if (state.project) {
    els.newProject.value = state.project;
  } else if (!els.newProject.value && state.projects.length > 0) {
    els.newProject.value = state.projects[0].project;
  }
  els.newProject.placeholder = state.project || 'project';
}

function renderProjects() {
  els.projectList.replaceChildren();
  els.projectOptions.replaceChildren();
  els.projectsEmpty.hidden = state.projects.length > 0;
  const total = state.projects.reduce((sum, entry) => sum + entry.facts, 0);
  els.totalCount.textContent = String(total);
  els.allProjects.classList.toggle('is-active', state.project === null);

  for (const entry of state.projects) {
    const node = els.projectTemplate.content.firstElementChild.cloneNode(true);
    const button = $('.project', node);
    button.dataset.project = entry.project;
    button.classList.toggle('is-active', state.project === entry.project);
    $('.project-name', node).textContent = entry.project;
    $('.project-count', node).textContent = String(entry.facts);
    button.addEventListener('click', () => selectProject(entry.project));
    els.projectList.append(node);

    const option = document.createElement('option');
    option.value = entry.project;
    els.projectOptions.append(option);
  }
  syncProjectInput();
}

function selectProject(project) {
  state.project = project;
  renderProjects();
  loadFacts({ reset: true });
}

async function loadProjects() {
  try {
    const data = await api('/v1/projects');
    state.projects = data.projects;
    renderProjects();
  } catch (error) {
    toast(error.message, true);
  }
}

/* ---------- facts ---------- */

function currentFilters() {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (state.project) params.set('project', state.project);
  else params.set('all', '1');
  if (state.kind) params.set('kind', state.kind);
  if (state.tag) params.set('tag', state.tag);
  if (state.q) params.set('q', state.q);
  return params;
}

function renderEmpty() {
  const box = document.createElement('div');
  box.className = 'empty';
  const title = document.createElement('strong');
  const filtered = state.q || state.kind || state.tag;
  title.textContent = filtered ? '这层土还没翻到' : '这里还是空地';
  const hint = document.createElement('p');
  hint.textContent = filtered
    ? '换个词，或清掉左侧的筛选。'
    : '用上方输入框记录第一条决策、坑或约定。';
  box.append(title, hint);
  return box;
}

function buildFact(fact) {
  const node = els.factTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = fact.id;
  node.dataset.kind = fact.kind;
  $('.kind-label', node).textContent = KIND_LABEL[fact.kind] ?? fact.kind;
  $('.kind-dot', node).classList.add(fact.kind);
  const text = $('.fact-text', node);
  text.textContent = fact.text;
  if (Array.from(fact.text).length > 260) {
    text.classList.add('is-clamped');
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'fact-expand';
    expand.textContent = '展开全文';
    expand.addEventListener('click', () => {
      const clamped = text.classList.toggle('is-clamped');
      expand.textContent = clamped ? '展开全文' : '收起';
    });
    text.after(expand);
  }
  const tags = $('.fact-tags', node);
  for (const tag of fact.tags || []) {
    const item = document.createElement('li');
    item.textContent = `#${tag}`;
    tags.append(item);
  }
  if (!(fact.tags || []).length) tags.remove();
  $('.meta-harness', node).textContent = fact.harness || 'unknown';
  $('.meta-device', node).textContent = fact.deviceName || 'unknown';
  $('.meta-time', node).textContent = formatTime(fact.createdAt);
  $('.meta-id', node).textContent = shortId(fact.id);

  node.querySelector('[data-action="edit"]').addEventListener('click', () => openEdit(fact));
  node.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fact.id);
      toast(`已复制 ${shortId(fact.id)}`);
    } catch {
      toast('浏览器不允许写剪贴板', true);
    }
  });
  node.querySelector('[data-action="delete"]').addEventListener('click', (event) => onDelete(event.currentTarget, fact));
  return node;
}

async function onDelete(button, fact) {
  if (button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true';
    button.textContent = '确认删除';
    window.setTimeout(() => {
      button.dataset.confirm = 'false';
      button.textContent = '删除';
    }, 4000);
    return;
  }
  try {
    await api(`/v1/facts/${encodeURIComponent(fact.id)}`, { method: 'DELETE' });
    state.facts = state.facts.filter((entry) => entry.id !== fact.id);
    renderList();
    loadProjects();
    toast(`已删除 ${shortId(fact.id)}`);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderList() {
  els.list.replaceChildren();
  if (state.facts.length === 0) {
    els.list.append(renderEmpty());
  } else {
    const fragment = document.createDocumentFragment();
    for (const fact of state.facts) fragment.append(buildFact(fact));
    els.list.append(fragment);
  }
  els.more.hidden = !state.cursor;
  els.listFoot.textContent = state.facts.length
    ? `${state.facts.length} 条已加载${state.cursor ? ' · 还有更多' : ''}`
    : '';
}

async function loadFacts({ reset = false, append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  els.refresh.disabled = true;
  if (reset) {
    state.facts = [];
    state.cursor = null;
    renderList();
  }
  const params = currentFilters();
  if (append && state.cursor) params.set('cursor', state.cursor);
  try {
    const data = await api(`/v1/facts?${params.toString()}`);
    state.facts = append ? state.facts.concat(data.facts) : data.facts;
    state.cursor = data.next;
    renderList();
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.loading = false;
    els.refresh.disabled = false;
  }
}

async function addFact() {
  const text = els.newText.value.trim();
  if (!text) {
    toast('写点什么再记录', true);
    els.newText.focus();
    return;
  }
  const project = defaultProject();
  if (!project) {
    toast('先填 project 名称', true);
    els.newProject.focus();
    return;
  }
  const body = {
    project,
    kind: els.newKind.value,
    text,
    tags: splitTags(els.newTags.value),
    harness: 'web',
  };
  els.add.disabled = true;
  try {
    const data = await api('/v1/facts', { method: 'POST', body });
    els.newText.value = '';
    els.newTags.value = '';
    els.newProject.value = project;
    if (!state.project) state.project = project;
    toast(data.deduped ? `已存在 ${shortId(data.fact.id)}` : `已记录 ${shortId(data.fact.id)}`);
    await Promise.all([loadProjects(), loadFacts({ reset: true })]);
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.add.disabled = false;
  }
}

/* ---------- edit ---------- */

function openEdit(fact) {
  editingId = fact.id;
  els.editText.value = fact.text;
  els.editKind.value = fact.kind;
  els.editTags.value = (fact.tags || []).join(', ');
  els.editDialog.showModal();
  els.editText.focus();
}

async function saveEdit(event) {
  event.preventDefault();
  if (!editingId) return;
  const body = {
    text: els.editText.value.trim(),
    kind: els.editKind.value,
    tags: splitTags(els.editTags.value),
  };
  els.editSave.disabled = true;
  try {
    await api(`/v1/facts/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    els.editDialog.close();
    editingId = null;
    toast('已保存修订');
    await Promise.all([loadProjects(), loadFacts({ reset: true })]);
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.editSave.disabled = false;
  }
}

/* ---------- devices ---------- */

async function loadDevices() {
  els.devicesError.textContent = '';
  els.deviceRows.replaceChildren();
  try {
    const data = await api('/v1/devices');
    for (const device of data.devices) {
      const row = els.deviceTemplate.content.firstElementChild.cloneNode(true);
      $('.device-id', row).textContent = shortId(device.id);
      $('.device-name', row).textContent = device.name;
      $('.device-scopes', row).textContent = (device.scopes || []).join(',');
      const seen = device.lastSeenAt ? formatTime(device.lastSeenAt) : '从未';
      const seenCell = $('.device-seen', row);
      seenCell.textContent = device.revokedAt ? '已撤销' : seen;
      if (device.revokedAt) seenCell.classList.add('is-revoked');
      const button = row.querySelector('[data-action="revoke"]');
      if (device.revokedAt) {
        button.hidden = true;
      } else {
        button.addEventListener('click', (event) => revokeDevice(event.currentTarget, device));
      }
      els.deviceRows.append(row);
    }
    if (data.devices.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = '没有设备记录';
      row.append(cell);
      els.deviceRows.append(row);
    }
  } catch (error) {
    els.devicesError.textContent = error.message;
  }
}

async function revokeDevice(button, device) {
  if (button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true';
    button.textContent = '确认撤销';
    window.setTimeout(() => {
      button.dataset.confirm = 'false';
      button.textContent = '撤销';
    }, 4000);
    return;
  }
  try {
    await api(`/v1/devices/${encodeURIComponent(device.id)}/revoke`, { method: 'POST' });
    if (device.id === state.me.id) {
      els.devicesDialog.close();
      signOut('当前设备已被撤销，请重新登录');
      return;
    }
    toast(`已撤销 ${device.name}`);
    await loadDevices();
  } catch (error) {
    els.devicesError.textContent = error.message;
  }
}

/* ---------- export ---------- */

async function exportNdjson() {
  els.exportBtn.disabled = true;
  try {
    const lines = [];
    let cursor = null;
    do {
      const params = new URLSearchParams({ limit: '200' });
      if (state.project) params.set('project', state.project);
      else params.set('all', '1');
      if (state.kind) params.set('kind', state.kind);
      if (state.tag) params.set('tag', state.tag);
      if (state.q) params.set('q', state.q);
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
    link.download = `loam-${state.project || 'all'}-${new Date().toISOString().slice(0, 10)}.ndjson`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(`已导出 ${lines.length} 条`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.exportBtn.disabled = false;
  }
}

/* ---------- wiring ---------- */

async function refreshAll() {
  await loadProjects();
  await loadFacts({ reset: true });
}

function bind() {
  els.gateForm.addEventListener('submit', onConnect);
  els.add.addEventListener('click', addFact);
  els.refresh.addEventListener('click', refreshAll);
  els.more.addEventListener('click', () => loadFacts({ append: true }));
  els.exportBtn.addEventListener('click', exportNdjson);
  els.devicesBtn.addEventListener('click', () => {
    els.devicesDialog.showModal();
    loadDevices();
  });
  els.devicesClose.addEventListener('click', () => els.devicesDialog.close());
  els.logout.addEventListener('click', () => signOut());
  els.allProjects.addEventListener('click', () => selectProject(null));
  els.editForm.addEventListener('submit', saveEdit);
  els.editCancel.addEventListener('click', () => {
    editingId = null;
    els.editDialog.close();
  });

  els.q.addEventListener(
    'input',
    debounce(() => {
      state.q = els.q.value.trim();
      loadFacts({ reset: true });
    }, 260),
  );
  els.tag.addEventListener(
    'input',
    debounce(() => {
      state.tag = els.tag.value.trim().toLowerCase();
      loadFacts({ reset: true });
    }, 260),
  );
  els.kinds.addEventListener('click', (event) => {
    const button = event.target.closest('[data-kind]');
    if (!button) return;
    state.kind = button.dataset.kind || '';
    for (const chip of els.kinds.querySelectorAll('[data-kind]')) {
      chip.classList.toggle('is-active', chip === button);
    }
    loadFacts({ reset: true });
  });

  els.newText.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') addFact();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== els.q) {
      event.preventDefault();
      els.q.focus();
    }
  });
}

async function init() {
  bind();
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) await restoreSession(saved);
  else showGate();
}

init();