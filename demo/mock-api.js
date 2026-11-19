/**
 * 静态演示的数据层。
 *
 * 这个脚本接管 window.fetch：工作台看到的每一条事实都来自下面的常量，
 * 改动只留在内存里，刷新即恢复。页面不会向任何地址发请求——即使本文件
 * 漏掉某个端点，_headers 里的 `connect-src 'none'` 也会让浏览器直接拦掉。
 *
 * 部署：`pnpm dlx wrangler pages deploy demo --project-name loam-demo`
 */
(function () {
  'use strict';

  var TOKEN = 'loam_demo_token';

  /* app.js 是 type="module"，执行晚于本脚本，所以这里写完它就能自动登录。 */
  try {
    localStorage.setItem('loam.token', TOKEN);
  } catch {
    /* 隐私模式禁写 localStorage 时，页面仍可用，只是停在 gate。 */
  }

  var NOW = Date.now();
  var DAY = 86400000;

  function makeId(seed) {
    var digits = '0123456789abcdef';
    var n = (seed * 2654435761) % 4294967296;
    var out = '';
    for (var i = 0; i < 32; i += 1) {
      n = (n * 1103515245 + 12345) % 2147483648;
      out += digits[n % 16];
    }
    return out;
  }

  var DEVICES = [
    { id: makeId(101), name: 'macbook-pro', scopes: ['read', 'write'], createdAt: NOW - 40 * DAY, lastSeenAt: NOW - 40 * 60000, revokedAt: null },
    { id: makeId(102), name: 'workstation', scopes: ['read', 'write'], createdAt: NOW - 12 * DAY, lastSeenAt: NOW - 3 * 60000, revokedAt: null },
    { id: makeId(103), name: 'ci-runner', scopes: ['read'], createdAt: NOW - 20 * DAY, lastSeenAt: NOW - 2 * DAY, revokedAt: null },
  ];

  var SUPERSEDED_ID = makeId(11);

  function evidence(paths, symbols, check) {
    return { paths: paths, symbols: symbols, check: check || '', commit: '9f2c41d', at: NOW - DAY };
  }

  var FACTS = [
    {
      id: makeId(1),
      project: 'loam',
      kind: 'decision',
      text: 'D1 是唯一事实源，不引入向量库、不装 MCP server',
      tags: ['架构', '存储'],
      harness: 'claude',
      pinned: true,
      importance: 5,
      evidence: evidence(['worker/src/index.ts', 'worker/schema.sql'], ['app']),
      ageDays: 3,
      device: 0,
    },
    {
      id: makeId(2),
      project: 'loam',
      kind: 'decision',
      text: '召回默认 5 条、注入只给前 3 条；排序在写入时定好，读路径不写库',
      tags: ['召回'],
      harness: 'dsh',
      pinned: true,
      importance: 4,
      evidence: evidence(['worker/src/facts.ts'], ['buildFilter', 'searchFacts']),
      ageDays: 2,
      device: 1,
    },
    {
      id: makeId(3),
      project: 'loam',
      kind: 'pitfall',
      text: 'Pages 没有 ratelimits 绑定：限流退化成 isolate 内兜底，真正的边界是 per-device token 与撤销',
      tags: ['限流', 'pages'],
      harness: 'codex',
      pinned: false,
      importance: 4,
      evidence: evidence(['pages/functions/[[path]].ts', 'worker/src/rate.ts'], ['rate.ts'], 'pnpm --filter @loam/worker test'),
      ageDays: 5,
      device: 0,
    },
    {
      id: makeId(4),
      project: 'loam',
      kind: 'pitfall',
      text: 'D1 行写配额很紧：last_seen 必须按 5 分钟节流，读路径不记账',
      tags: ['d1', '配额'],
      harness: 'claude',
      pinned: false,
      importance: 3,
      evidence: evidence(['worker/src/auth.ts'], ['LAST_SEEN_THROTTLE_MS']),
      ageDays: 6,
      device: 0,
    },
    {
      id: makeId(5),
      project: 'loam',
      kind: 'convention',
      text: '提交前跑 pnpm typecheck && pnpm -r test，CI 会再跑一遍同样的命令',
      tags: ['ci'],
      harness: 'codex',
      pinned: false,
      importance: 3,
      evidence: null,
      ageDays: 1,
      device: 0,
    },
    {
      id: makeId(6),
      project: 'loam',
      kind: 'convention',
      text: 'tag 去掉 v 必须等于 cli/package.json 的 version，且该版本还没在 npm 上',
      tags: ['发布'],
      harness: 'dsh',
      pinned: true,
      importance: 5,
      evidence: evidence(['.github/workflows/release.yml'], [], 'git push origin v*'),
      ageDays: 4,
      device: 1,
    },
    {
      id: makeId(7),
      project: 'loam',
      kind: 'fact',
      text: '后端跑 Cloudflare 免费层：Workers 100k 请求/天、D1 5M 行读/天',
      tags: ['cloudflare'],
      harness: 'claude',
      pinned: false,
      importance: 4,
      evidence: null,
      ageDays: 7,
      device: 0,
    },
    {
      id: makeId(8),
      project: 'loam',
      kind: 'fact',
      text: '一个项目一份记忆，四类：decision / pitfall / convention / fact，一行一条',
      tags: ['形态'],
      harness: 'codex',
      pinned: false,
      importance: 3,
      evidence: null,
      ageDays: 9,
      device: 0,
    },
    {
      id: makeId(9),
      project: 'loam',
      kind: 'decision',
      text: '发布走 Trusted Publishing（OIDC），不使用、不保存 NPM_TOKEN',
      tags: ['发布', '安全'],
      harness: 'dsh',
      pinned: false,
      importance: 4,
      evidence: evidence(['.github/workflows/release.yml'], [], 'npm publish --dry-run'),
      ageDays: 8,
      device: 1,
    },
    {
      id: makeId(10),
      project: 'loam',
      kind: 'convention',
      text: 'harness 开工前 loam search，收尾 loam add；接好之后不用记命令',
      tags: ['harness'],
      harness: 'claude',
      pinned: false,
      importance: 3,
      evidence: null,
      ageDays: 10,
      device: 0,
    },
    {
      id: SUPERSEDED_ID,
      project: 'loam',
      kind: 'fact',
      text: '召回默认 10 条',
      tags: ['召回'],
      harness: 'claude',
      pinned: false,
      importance: 2,
      evidence: null,
      ageDays: 12,
      device: 0,
      supersededBy: makeId(2),
      supersededAt: NOW - 2 * DAY,
    },
    {
      id: makeId(11),
      project: 'loam',
      kind: 'pitfall',
      text: '静态演示页必须把 CSP 的 connect-src 设成 none：否则一个 fetch 就会打回后端配额',
      tags: ['安全', 'demo'],
      harness: 'dsh',
      pinned: false,
      importance: 4,
      evidence: evidence(['demo/_headers'], []),
      ageDays: 0,
      device: 2,
    },
    {
      id: makeId(21),
      project: 'acme-gateway',
      kind: 'decision',
      text: '鉴权统一在 edge 做，业务服务不重复校验 token',
      tags: ['鉴权'],
      harness: 'claude',
      pinned: true,
      importance: 4,
      evidence: null,
      ageDays: 6,
      device: 0,
    },
    {
      id: makeId(22),
      project: 'acme-gateway',
      kind: 'pitfall',
      text: '上游 owned_by 常回占位值 system，展示前必须过滤，否则列表全是噪音',
      tags: ['上游'],
      harness: 'codex',
      pinned: false,
      importance: 3,
      evidence: null,
      ageDays: 4,
      device: 0,
    },
    {
      id: makeId(23),
      project: 'acme-gateway',
      kind: 'convention',
      text: '管理接口一律 /v2/admin 前缀，版本段不进路由参数',
      tags: ['路由'],
      harness: 'dsh',
      pinned: false,
      importance: 2,
      evidence: null,
      ageDays: 8,
      device: 1,
    },
  ];

  function hydrate(row) {
    var device = DEVICES[row.device] || DEVICES[0];
    return {
      id: row.id,
      project: row.project,
      kind: row.kind,
      text: row.text,
      tags: row.tags.slice(),
      harness: row.harness,
      pinned: row.pinned,
      importance: row.importance,
      evidence: row.evidence,
      supersededBy: row.supersededBy || null,
      supersededAt: row.supersededAt || null,
      deviceId: device.id,
      deviceName: device.name,
      createdAt: NOW - row.ageDays * DAY,
    };
  }

  var store = FACTS.map(hydrate);

  /* ---------- query ---------- */

  function filterFacts(params) {
    var project = params.get('project');
    var kind = params.get('kind');
    var tag = params.get('tag');
    var q = params.get('q');
    var pinnedOnly = params.get('pinned') === '1' || params.get('pinnedOnly') === '1';
    var includeSuperseded = params.get('includeSuperseded') === '1';
    var terms = q ? q.toLowerCase().split(/\s+/u).filter(Boolean).slice(0, 5) : [];

    return store.filter(function (f) {
      if (project && f.project !== project) return false;
      if (kind && f.kind !== kind) return false;
      if (tag && f.tags.indexOf(tag) === -1) return false;
      if (pinnedOnly && !f.pinned) return false;
      if (!includeSuperseded && f.supersededBy) return false;
      var haystack = f.text.toLowerCase();
      for (var i = 0; i < terms.length; i += 1) if (haystack.indexOf(terms[i]) === -1) return false;
      return true;
    });
  }

  function sortFacts(list, mode) {
    var copy = list.slice();
    if (mode === 'rank') {
      copy.sort(function (a, b) {
        return (
          Number(b.pinned) - Number(a.pinned) ||
          b.importance - a.importance ||
          b.createdAt - a.createdAt ||
          (a.id < b.id ? 1 : -1)
        );
      });
      return copy;
    }
    copy.sort(function (a, b) {
      return b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);
    });
    return copy;
  }

  function stats(project) {
    var rows = store.filter(function (f) {
      return f.project === project;
    });
    var byKind = { decision: 0, pitfall: 0, convention: 0, fact: 0 };
    var activeByKind = { decision: 0, pitfall: 0, convention: 0, fact: 0 };
    var pinned = 0;
    var superseded = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var f = rows[i];
      byKind[f.kind] = (byKind[f.kind] || 0) + 1;
      if (f.supersededBy) {
        superseded += 1;
        continue;
      }
      activeByKind[f.kind] = (activeByKind[f.kind] || 0) + 1;
      if (f.pinned) pinned += 1;
    }
    return { facts: rows.length, byKind: byKind, activeByKind: activeByKind, pinned: pinned, superseded: superseded };
  }

  /* ---------- responses ---------- */

  function send(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  function fail(message, status) {
    return send({ error: { code: 'demo', message: message } }, status || 400);
  }

  function publicDevice(d) {
    return { id: d.id, name: d.name, scopes: d.scopes };
  }

  function handle(method, path, params, body) {
    if (path === '/health') return send({ ok: true, version: '0.4.0-demo' });

    if (path === '/v1/me' && method === 'GET') {
      return send({ device: publicDevice(DEVICES[0]), version: '0.4.0-demo', serverTime: Date.now() });
    }

    if (path === '/v1/devices' && method === 'GET') {
      return send({
        devices: DEVICES.map(function (d) {
          return {
            id: d.id,
            name: d.name,
            scopes: d.scopes,
            createdAt: d.createdAt,
            lastSeenAt: d.lastSeenAt,
            revokedAt: d.revokedAt,
          };
        }),
      });
    }

    var revoke = /^\/v1\/devices\/([^/]+)\/revoke$/.exec(path);
    if (revoke && method === 'POST') {
      for (var d = 0; d < DEVICES.length; d += 1) {
        if (DEVICES[d].id === decodeURIComponent(revoke[1])) {
          DEVICES[d].revokedAt = Date.now();
          return send({ device: publicDevice(DEVICES[d]) });
        }
      }
      return fail('device not found', 404);
    }

    if (path === '/v1/projects' && method === 'GET') {
      var counts = {};
      for (var i = 0; i < store.length; i += 1) counts[store[i].project] = (counts[store[i].project] || 0) + 1;
      var projects = Object.keys(counts)
        .map(function (name) {
          return { project: name, facts: counts[name] };
        })
        .sort(function (a, b) {
          return b.facts - a.facts || (a.project < b.project ? -1 : 1);
        });
      return send({ projects: projects });
    }

    if (path === '/v1/stats' && method === 'GET') {
      var project = params.get('project') || '';
      return send(Object.assign({ project: project }, stats(project)));
    }

    if (path === '/v1/export' && method === 'GET') {
      return send({ facts: sortFacts(filterFacts(params), 'recent'), next: null });
    }

    if (path === '/v1/import' && method === 'POST') {
      return send({ inserted: 0, deduped: 0 });
    }

    if (path === '/v1/facts' && method === 'GET') {
      var limit = Math.min(Number(params.get('limit')) || 5, 50);
      var page = sortFacts(filterFacts(params), params.get('sort')).slice(0, limit);
      return send({ facts: page, next: null, limit: limit });
    }

    if (path === '/v1/facts' && method === 'POST') {
      var input = body || {};
      if (!input.text || !input.project) return fail('text and project are required', 400);
      var next = {
        id: makeId(Math.floor(Math.random() * 1e6) + 7),
        project: String(input.project),
        kind: ['decision', 'pitfall', 'convention', 'fact'].indexOf(input.kind) >= 0 ? input.kind : 'fact',
        text: String(input.text),
        tags: Array.isArray(input.tags) ? input.tags.slice(0, 8) : [],
        harness: input.harness || 'claude',
        pinned: Boolean(input.pinned),
        importance: Number(input.importance) || 3,
        evidence: input.evidence || null,
        supersededBy: null,
        supersededAt: null,
        deviceId: DEVICES[0].id,
        deviceName: DEVICES[0].name,
        createdAt: Date.now(),
      };
      store.unshift(next);
      return send({ created: true, deduped: false, fact: next }, 201);
    }

    if (path === '/v1/facts' && method === 'DELETE') {
      return send({ deleted: 0 });
    }

    var one = /^\/v1\/facts\/([^/]+)$/.exec(path);
    if (one) {
      var wanted = decodeURIComponent(one[1]);
      var found = null;
      for (var j = 0; j < store.length; j += 1) {
        if (store[j].id === wanted || store[j].id.indexOf(wanted) === 0) {
          found = store[j];
          break;
        }
      }
      if (!found) return fail('fact not found', 404);
      if (method === 'GET') return send({ fact: found });
      if (method === 'PATCH') {
        var patch = body || {};
        if (typeof patch.text === 'string' && patch.text.trim()) found.text = patch.text.trim();
        if (Array.isArray(patch.tags)) found.tags = patch.tags.slice(0, 8);
        if (typeof patch.pinned === 'boolean') found.pinned = patch.pinned;
        if (typeof patch.importance === 'number') found.importance = patch.importance;
        if (typeof patch.kind === 'string') found.kind = patch.kind;
        if (typeof patch.supersededBy === 'string') found.supersededBy = patch.supersededBy;
        return send({ fact: found });
      }
      if (method === 'DELETE') {
        store = store.filter(function (f) {
          return f !== found;
        });
        return send({ deleted: 1 });
      }
    }

    return fail('not found in the static demo', 404);
  }

  /* ---------- fetch takeover ---------- */

  window.fetch = function (input, init) {
    var options = init || {};
    var url;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, location.href);
    } catch {
      return Promise.reject(new TypeError('bad request'));
    }

    var method = String(options.method || 'GET').toUpperCase();
    var body = null;
    if (typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = null;
      }
    }

    if (url.pathname.indexOf('/v1/') === 0 || url.pathname === '/health') {
      try {
        return Promise.resolve(handle(method, url.pathname, url.searchParams, body));
      } catch (error) {
        return Promise.reject(error);
      }
    }

    /* 任何越界请求都不发出去：这是「演示页碰不到真后端」的第二道保证。 */
    return Promise.reject(new TypeError('demo mode: no network requests'));
  };

  /* 页面上显示一个「静态演示」标签，避免访客误以为这是真数据。 */
  window.addEventListener('DOMContentLoaded', function () {
    var app = document.getElementById('app');
    if (!app) return;
    var strip = document.createElement('div');
    strip.className = 'demo-strip';
    strip.setAttribute('role', 'note');
    strip.textContent = '静态演示 · 数据是假的，改动只在浏览器内存里，刷新即恢复；本页不发任何网络请求。 ';
    var link = document.createElement('a');
    link.href = 'https://github.com/yidasanqian/loam';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '源码';
    strip.appendChild(link);
    /* 放在 body 最前面：不参与 #app 的 grid 轨道，免得挤动底部捕获条。 */
    document.body.insertBefore(strip, document.body.firstChild);
    var logout = document.getElementById('logout');
    if (logout) logout.hidden = true;
  });
})();