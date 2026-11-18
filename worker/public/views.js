/**
 * View renderers. Every function takes the app context (`ctx`) so this module
 * never imports app.js and there is no circular dependency.
 */

const KINDS = ['decision', 'pitfall', 'convention', 'fact'];
const DAY = 86_400_000;

export function kindLabel(t, kind) {
  return t(`kind.${kind}`);
}

function appendTags(t, container, tags, max = 3) {
  const list = tags ?? [];
  for (const tag of list.slice(0, max)) {
    const span = document.createElement('span');
    span.textContent = `#${tag}`;
    container.append(span);
  }
  if (list.length > max) {
    const more = document.createElement('span');
    more.className = 'is-more';
    more.textContent = `+${list.length - max}`;
    container.append(more);
  }
}

function buildCard(ctx, fact, { draggable = false } = {}) {
  const node = ctx.templates.card.content.firstElementChild.cloneNode(true);
  node.dataset.id = fact.id;
  node.dataset.kind = fact.kind;
  node.draggable = draggable;
  node.querySelector('.card-text').textContent = fact.text;
  node.querySelector('.pin-mark').hidden = !fact.pinned;
  appendTags(ctx.t, node.querySelector('.tags'), fact.tags);
  const importance = fact.importance ?? 3;
  const imp = node.querySelector('.imp');
  imp.dataset.level = String(importance);
  imp.setAttribute('aria-label', ctx.t('inspector.importance', { n: importance }));
  node.querySelector('.card-age').textContent = ctx.formatAge(fact.createdAt);
  node.addEventListener('click', () => ctx.openInspector(fact.id));
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ctx.openInspector(fact.id);
    }
  });
  if (draggable) {
    node.addEventListener('dragstart', (event) => {
      ctx.state.dragging = fact;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', fact.id);
    });
    node.addEventListener('dragend', () => {
      ctx.state.dragging = null;
    });
  }
  return node;
}

function laneElement(ctx, lane) {
  const node = ctx.templates.lane.content.firstElementChild.cloneNode(true);
  node.dataset.lane = lane.key;
  node.querySelector('.lane-name').textContent = lane.title;
  if (lane.kind) node.querySelector('.kind-dot').classList.add(lane.kind);
  else node.querySelector('.kind-dot').remove();
  node.querySelector('.lane-count').textContent =
    lane.total === undefined || lane.total === '' ? '' : String(lane.total);

  const list = node.querySelector('.lane-list');
  for (const fact of lane.items) list.append(buildCard(ctx, fact, { draggable: lane.droppable }));

  if (lane.error) {
    const box = document.createElement('div');
    box.className = 'lane-error';
    box.append(document.createTextNode(`${ctx.t('lane.error')} · ${lane.error}`));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-mini';
    retry.textContent = ctx.t('lane.retry');
    retry.addEventListener('click', () => ctx.reloadLane(lane.kind));
    box.append(retry);
    list.append(box);
  } else if (!lane.loading && lane.items.length === 0 && lane.empty !== false) {
    const empty = document.createElement('p');
    empty.className = 'lane-empty';
    empty.textContent = lane.emptyText ?? ctx.t('lane.empty');
    list.append(empty);
  }

  const more = node.querySelector('.lane-more');
  if (lane.cursor) {
    more.hidden = false;
    more.textContent = ctx.t('lane.more');
    more.addEventListener('click', () => ctx.loadMore(lane.key));
  }

  const add = node.querySelector('.lane-add');
  if (lane.droppable) {
    add.setAttribute('aria-label', ctx.t('lane.add'));
    add.addEventListener('click', () => ctx.startCapture(lane.kind));
    node.addEventListener('dragover', (event) => {
      if (!ctx.state.dragging) return;
      event.preventDefault();
      node.classList.add('is-dragover');
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-dragover'));
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      node.classList.remove('is-dragover');
      const id = event.dataTransfer.getData('text/plain');
      if (id) ctx.moveKind(id, lane.kind);
    });
  } else {
    add.remove();
  }
  return node;
}

export function renderBoard(ctx) {
  const nodes = KINDS.map((kind) => {
    const lane = ctx.state.lanes[kind] ?? { items: [], cursor: null, loading: false, error: null };
    return laneElement(ctx, {
      key: kind,
      kind,
      title: kindLabel(ctx.t, kind),
      items: lane.items,
      cursor: lane.cursor,
      loading: lane.loading,
      error: lane.error,
      total: lane.loading && lane.items.length === 0 ? '' : lane.cursor ? `${lane.items.length}+` : lane.items.length,
      droppable: true,
    });
  });
  ctx.els.lanes.replaceChildren(...nodes);
  const stats = ctx.state.stats;
  ctx.els.boardEmpty.hidden = !(stats && stats.facts === 0 && !ctx.state.loadingBoard);
}

function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function renderTimeline(ctx) {
  const now = Date.now();
  const items = ctx.state.timeline?.items ?? [];
  const today = startOfDay(now);
  const buckets = [
    { key: 'today', title: ctx.t('timeline.today'), items: [] },
    { key: 'week', title: ctx.t('timeline.week'), items: [] },
    { key: 'month', title: ctx.t('timeline.month'), items: [] },
    { key: 'older', title: ctx.t('timeline.older'), items: [] },
  ];
  for (const fact of items) {
    if (fact.createdAt >= today) buckets[0].items.push(fact);
    else if (fact.createdAt >= now - 7 * DAY) buckets[1].items.push(fact);
    else if (fact.createdAt >= now - 30 * DAY) buckets[2].items.push(fact);
    else buckets[3].items.push(fact);
  }
  ctx.els.buckets.replaceChildren(
    ...buckets.map((bucket) =>
      laneElement(ctx, {
        key: bucket.key,
        kind: null,
        title: bucket.title,
        items: bucket.items,
        cursor: null,
        loading: false,
        error: null,
        total: bucket.items.length,
        droppable: false,
        emptyText: ctx.t('timeline.empty'),
      }),
    ),
  );
  ctx.els.timelineEmpty.hidden = items.length > 0;
}

function triageFact(ctx) {
  const { queue, index } = ctx.state.triage;
  return index < queue.length ? queue[index] : null;
}

export function renderTriage(ctx) {
  const { els, t, state } = ctx;
  const fact = triageFact(ctx);
  const queue = state.triage.queue;
  const done = state.triage.index >= queue.length;
  els.triageProgress.textContent = t('triage.progress', { done: Math.min(state.triage.index, queue.length), total: queue.length });
  els.triageCard.hidden = !fact;
  els.triageEmpty.hidden = !done;
  els.triageEmpty.textContent = queue.length === 0 ? t('triage.empty') : t('triage.done');
  if (fact) {
    els.triageMeta.textContent = `${kindLabel(t, fact.kind)} · ${ctx.formatDate(fact.createdAt)} · ${fact.harness || 'unknown'}`;
    els.triageText.textContent = fact.text;
    els.triageTags.replaceChildren();
    appendTags(t, els.triageTags, fact.tags);
  }
  els.triageKinds.replaceChildren(
    ...KINDS.map((kind) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = kindLabel(t, kind);
      button.setAttribute('aria-pressed', String(Boolean(fact && fact.kind === kind)));
      button.disabled = !fact;
      button.addEventListener('click', () => fact && ctx.moveKind(fact.id, kind));
      return button;
    }),
  );
  els.triagePin.textContent = fact?.pinned ? t('triage.unpin') : t('triage.pin');
  for (const button of [els.triagePrev, els.triageNext, els.triagePin, els.triageEdit, els.triageDelete, els.triageSkip]) {
    button.disabled = !fact && button !== els.triagePrev;
  }
  els.triagePrev.disabled = state.triage.index === 0;
  els.triageNext.disabled = done;
}

export function renderPinned(ctx) {
  const { els, t, state } = ctx;
  els.pinned.hidden = state.pinned.length === 0;
  els.pinnedCount.textContent = state.pinned.length ? `(${state.pinned.length})` : '';
  els.pinnedList.replaceChildren(
    ...state.pinned.map((fact) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = fact.text;
      button.title = fact.text;
      button.addEventListener('click', () => ctx.openInspector(fact.id));
      item.append(button);
      return item;
    }),
  );
}

export function fillInspector(ctx, fact) {
  const { els, t } = ctx;
  els.inspectorKind.textContent = kindLabel(t, fact.kind);
  els.inspectorDot.className = `kind-dot ${fact.kind}`;
  els.inspectorAge.textContent = ctx.formatAge(fact.createdAt);
  els.inspectorText.textContent = fact.text;
  els.inspectorTags.replaceChildren();
  appendTags(t, els.inspectorTags, fact.tags, 8);
  els.inspectorMeta.textContent = t('inspector.meta', {
    harness: fact.harness || 'unknown',
    device: fact.deviceName || 'unknown',
    time: ctx.formatDate(fact.createdAt),
  });
  els.inspectorChain.hidden = !fact.supersededBy;
  if (fact.supersededBy) {
    els.inspectorChainBody.textContent = t('inspector.chainSuperseded', { id: fact.supersededBy.slice(0, 8) });
  }
  els.pinToggle.textContent = fact.pinned ? t('inspector.unpin') : t('inspector.pin');
  for (const button of els.importance.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.n) === (fact.importance ?? 3)));
  }
  els.editPanel.hidden = true;
}

export function renderModel(ctx) {
  const stats = ctx.state.stats;
  if (!stats) {
    ctx.els.modelLive.textContent = '';
    return;
  }
  const active = stats.activeByKind ?? stats.byKind;
  ctx.els.modelLive.textContent = ctx.t('model.live', {
    d: active.decision,
    p: active.pitfall,
    c: active.convention,
    f: active.fact,
    pin: stats.pinned,
    s: stats.superseded,
  });
}