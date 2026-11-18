/**
 * Dialogs and transient UI: command search, devices, and their loading paths.
 * All state lives in the app context passed in by app.js.
 */

import { kindLabel } from './views.js';

let searchTimer = 0;
let searchSeq = 0;

/* ---------- search ---------- */

export function openSearch(ctx) {
  const { els } = ctx;
  if (!els.searchDialog.open) els.searchDialog.showModal();
  els.searchInput.value = '';
  els.searchResults.replaceChildren();
  els.searchEmpty.textContent = ctx.t('search.empty');
  els.searchEmpty.hidden = true;
  els.searchInput.focus();
  void runSearch(ctx, '');
}

async function runSearch(ctx, query) {
  const { els } = ctx;
  if (!ctx.state.project) {
    els.searchEmpty.hidden = false;
    return;
  }
  const seq = ++searchSeq;
  const params = new URLSearchParams({
    project: ctx.state.project,
    include_superseded: '1',
    sort: 'recent',
    limit: '20',
  });
  if (query) params.set('q', query);
  try {
    const data = await ctx.api(`/v1/facts?${params.toString()}`);
    if (seq !== searchSeq) return;
    renderResults(ctx, data.facts);
  } catch (error) {
    if (seq !== searchSeq) return;
    els.searchResults.replaceChildren();
    els.searchEmpty.hidden = false;
    els.searchEmpty.textContent = error.message;
  }
}

function renderResults(ctx, facts) {
  const { els, t } = ctx;
  els.searchResults.replaceChildren(
    ...facts.map((fact) => {
      const item = ctx.templates.result.content.firstElementChild.cloneNode(true);
      item.querySelector('.kind-dot').classList.add(fact.kind);
      item.querySelector('.result-text').textContent = fact.text;
      const meta = fact.supersededBy
        ? `${kindLabel(t, fact.kind)} · ${t('search.superseded')}`
        : `${kindLabel(t, fact.kind)} · ${ctx.formatAge(fact.createdAt)}`;
      item.querySelector('.result-meta').textContent = meta;
      item.querySelector('button').addEventListener('click', () => {
        els.searchDialog.close();
        ctx.openInspector(fact.id);
      });
      return item;
    }),
  );
  els.searchEmpty.hidden = facts.length > 0;
}

export function bindSearch(ctx) {
  const { els } = ctx;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = els.searchInput.value.trim();
    searchTimer = window.setTimeout(() => void runSearch(ctx, query), 180);
  });
  els.searchDialog.addEventListener('close', () => {
    searchSeq += 1;
    clearTimeout(searchTimer);
  });
}

/* ---------- devices ---------- */

export function openDevices(ctx) {
  const { els } = ctx;
  if (!els.devicesDialog.open) els.devicesDialog.showModal();
  els.devicesError.textContent = '';
  els.deviceRows.replaceChildren();
  void loadDevices(ctx);
}

async function loadDevices(ctx) {
  const { els, t } = ctx;
  try {
    const data = await ctx.api('/v1/devices');
    els.deviceRows.replaceChildren(
      ...data.devices.map((device) => {
        const row = ctx.templates.device.content.firstElementChild.cloneNode(true);
        row.querySelector('.device-id').textContent = device.id.slice(0, 8);
        row.querySelector('.device-name').textContent = device.name;
        row.querySelector('.device-scopes').textContent = (device.scopes || []).join(',');
        const seen = device.lastSeenAt ? ctx.formatDate(device.lastSeenAt) : t('devices.never');
        const seenCell = row.querySelector('.device-seen');
        seenCell.textContent = device.revokedAt ? t('devices.revoked') : seen;
        if (device.revokedAt) seenCell.classList.add('is-revoked');
        const button = row.querySelector('[data-action="revoke"]');
        if (device.revokedAt) {
          button.remove();
        } else {
          button.textContent = t('devices.revoke');
          button.addEventListener('click', (event) => revoke(ctx, event.currentTarget, device));
        }
        return row;
      }),
    );
    if (data.devices.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = t('devices.empty');
      row.append(cell);
      els.deviceRows.append(row);
    }
  } catch (error) {
    els.devicesError.textContent = `${t('devices.error')}: ${error.message}`;
  }
}

async function revoke(ctx, button, device) {
  const { els, t } = ctx;
  if (button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true';
    button.textContent = t('devices.revokeConfirm');
    window.setTimeout(() => {
      button.dataset.confirm = 'false';
      button.textContent = t('devices.revoke');
    }, 4000);
    return;
  }
  try {
    await ctx.api(`/v1/devices/${encodeURIComponent(device.id)}/revoke`, { method: 'POST' });
    if (device.id === ctx.state.me?.id) {
      els.devicesDialog.close();
      ctx.signOut(t('gate.errorInvalid'));
      return;
    }
    await loadDevices(ctx);
  } catch (error) {
    els.devicesError.textContent = error.message;
  }
}