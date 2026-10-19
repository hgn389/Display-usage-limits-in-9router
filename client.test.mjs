import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { nativeSource } from './native-ui.mjs';

const script = await readFile(new URL('./client.js', import.meta.url), 'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
const accountRow = (email, name, id = 'row') => `<div id="${id}" class="flex flex-col sm:flex-row"><div class="flex flex-1"><span>lock</span><div data-details><p>${name}</p><p>${email}</p><div>active OAuth</div></div></div><div data-actions><button id="edit"><span>edit</span><span>Edit</span></button></div></div>`;
const markup = `<section><div><h2>Connections</h2></div><div>${accountRow('a@example.test', 'Account')}</div></section>`;
async function setup(accounts = [{ id: 'c1', email: 'a@example.test', name: 'Account' }], quota = { quotas: { session: { used: 30, total: 100, remaining: 70 }, weekly: { used: 10, total: 100 } } }, html = markup, source = script, fetcher) {
  const dom = new JSDOM(html, { url: 'http://localhost:9090/dashboard/providers/codex', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.fetch = fetcher || (async url => ({ ok: true, json: async () => url === '/api/providers' ? { connections: accounts.map(c => ({ ...c, provider: 'codex' })) } : String(url).endsWith('/__codex_addon/expiry') ? {} : typeof quota === 'function' ? quota(url) : quota }));
  dom.window.eval(source);
  await pause();
  return dom;
}
test('Antigravity shows compact real quota percentages and resets below the email without note requests', async () => {
  const dom = new JSDOM(markup, { url: 'http://localhost:9090/dashboard/providers/antigravity', runScripts: 'outside-only', pretendToBeVisual: true });
  const now = Date.now();
  dom.window.Date.now = () => now;
  dom.window.fetch = async url => {
    assert.ok(url === '/api/providers' || url === '/api/usage/ag1');
    return { ok: true, json: async () => url === '/api/providers' ? { connections: [{ id: 'ag1', provider: 'antigravity', email: 'a@example.test', name: 'Account' }] } : { quotas: {
      gemini_weekly: { displayName: 'Gemini (Weekly)', remainingPercentage: 25.10632, used: 749, total: 1000, resetAt: new Date(now + 5 * 86400000 + 3 * 3600000).toISOString() },
      claude_gpt_weekly: { displayName: 'Claude & GPT (Weekly)', remainingPercentage: 0, used: 1000, total: 1000, resetAt: new Date(now + 2 * 3600000).toISOString() },
      gemini_session: { displayName: 'Gemini (5h)', used: 20, total: 80 },
      missing: { remainingPercentage: null, used: null, total: 1000 }
    } } };
  };
  try {
    dom.window.eval(nativeSource(script));
    await pause();
    const panel = dom.window.document.querySelector('[data-antigravity-quota]');
    assert.equal(panel.previousElementSibling.textContent, 'a@example.test');
    assert.match(panel.textContent, /Gemini tuần: 25% \(reset 5d 3h\)/);
    assert.match(panel.textContent, /Claude\/GPT tuần: 0% \(reset 2h 0m\)/);
    assert.match(panel.textContent, /Gemini 5h: 75%/);
    assert.match(panel.textContent, /missing: chưa có dữ liệu/);
    assert.match(panel.firstElementChild.title, /^Reset:/);
    assert.equal(dom.window.document.querySelectorAll('[role=progressbar], [data-codex-inline-expiry]').length, 0);
    await pause();
    assert.equal(dom.window.document.querySelectorAll('[data-antigravity-quota]').length, 1);
  } finally { dom.window.close(); }
});

test('switching between Codex and Antigravity immediately refreshes and isolates accounts with the same email', async () => {
  const accounts = [
    { id: 'cx1', provider: 'codex', email: 'a@example.test', name: 'Account' },
    { id: 'ag1', provider: 'antigravity', email: 'a@example.test', name: 'Account' }
  ];
  let noteReads = 0;
  const usageReads = [];
  const dom = await setup(undefined, undefined, markup, nativeSource(script), async url => {
    let data;
    if (url === '/api/providers') data = { connections: accounts };
    else if (String(url).endsWith('/__codex_addon/expiry')) { noteReads++; data = {}; }
    else {
      usageReads.push(url);
      data = url.endsWith('/ag1') ? { quotas: { gemini_weekly: { displayName: 'Gemini (Weekly)', remainingPercentage: 35 } } } : { quotas: { session: { remaining: 70 }, weekly: { remaining: 60 } } };
    }
    return { ok: true, json: async () => data };
  });
  try {
    const { document, history } = dom.window;
    assert.equal(document.querySelector('[data-codex-quota]').dataset.codexQuota, 'cx1');
    history.pushState({}, '', '/dashboard/providers/antigravity');
    document.body.append(document.createElement('div'));
    await pause();
    assert.equal(document.querySelector('[data-codex-quota]'), null);
    assert.equal(document.querySelector('[data-antigravity-quota]').dataset.antigravityQuota, 'ag1');
    assert.match(document.querySelector('[data-antigravity-quota]').textContent, /35%/);
    assert.equal(noteReads, 1);
    history.pushState({}, '', '/dashboard/providers/codex');
    document.body.append(document.createElement('div'));
    await pause();
    assert.equal(document.querySelector('[data-antigravity-quota]'), null);
    assert.equal(document.querySelector('[data-codex-quota]').dataset.codexQuota, 'cx1');
    assert.equal(noteReads, 2);
    assert.deepEqual(usageReads, ['/api/usage/cx1', '/api/usage/ag1', '/api/usage/cx1']);
  } finally { dom.window.close(); }
});
test('mounts quota once, adds expiry to native modal, saves after email', async () => {
  const dom = await setup();
  try {
    const { document } = dom.window;
    assert.match(document.querySelector('[data-codex-quota]').textContent, /5h: 70% remaining/);
    assert.match(document.querySelector('[data-codex-quota]').textContent, /Weekly: 90% remaining/);
    assert.equal(document.querySelector('[data-codex-quota]').parentElement, document.querySelector('[data-details]'));
    assert.equal(document.querySelectorAll('[role=progressbar]').length, 2);
    assert.equal(document.querySelector('[data-codex-window=session] [role=progressbar]').getAttribute('aria-valuenow'), '70');
    assert.equal(document.querySelector('[data-codex-window=weekly] .codex-addon-fill').style.width, '90%');
    document.querySelector('#edit').click();
    const modal = document.createElement('div');
    modal.innerHTML = '<div><h2>Edit Connection</h2><button aria-label="Close">Close</button></div><div><input placeholder="Account name"><div><button id="save">Save</button></div></div>';
    document.body.append(modal);
    await pause();
    assert.ok(document.querySelector('[data-codex-editor]'));
    const input = document.querySelector('input[type=date]'); input.value = '2026-12-31';
    let saved = 0;
    document.querySelector('#save').addEventListener('click', () => saved++);
    document.querySelector('#save').click();
    await pause();
    assert.equal(saved, 1);
    assert.match(document.querySelector('[data-codex-expiry]').textContent, /2026-12-31/);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('9router-codex-addon-expiry-v1')).c1, '2026-12-31');
    await pause();
    assert.equal(document.querySelectorAll('[data-codex-quota]').length, 1);
    assert.equal(document.querySelectorAll('[data-codex-editor]').length, 1);
  } finally { dom.window.close(); }
});

test('refreshes every 30 seconds despite request delays, pauses when hidden, and resumes on return', async () => {
  const dom = new JSDOM(markup, { url: 'http://localhost:9090/dashboard/providers/codex', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let now = 1000000, sequence = 0, hidden = false, calls = 0, active = 0, maxActive = 0;
  const timers = new Map();
  window.Date.now = () => now;
  window.setTimeout = (fn, delay = 0) => { const id = ++sequence; timers.set(id, { fn, due: now + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  Object.defineProperty(window.document, 'hidden', { get: () => hidden });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const advanceTo = async target => {
    for (let i = 0; i < 1000; i++) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) { now = target; await flush(); return; }
      now = next[1].due;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    throw new Error('Unexpected refresh loop');
  };
  const accounts = ['c1', 'c2', 'c3'].map(id => ({ id, provider: 'codex', name: 'Account', email: 'a@example.test' }));
  window.fetch = url => new Promise(resolve => {
    const usage = url.startsWith('/api/usage/');
    if (usage) { calls++; active++; maxActive = Math.max(maxActive, active); }
    window.setTimeout(() => {
      if (usage) active--;
      resolve({ ok: true, json: async () => url === '/api/providers' ? { connections: accounts } : usage ? { quotas: { session: { remaining: 70 } } } : {} });
    }, url === '/api/providers' ? 40 : 100);
  });
  try {
    window.eval(nativeSource(script));
    await advanceTo(1000500);
    assert.equal(calls, 3);
    await advanceTo(1029999);
    assert.equal(calls, 3);
    await advanceTo(1030500);
    assert.equal(calls, 6);
    await advanceTo(1060500);
    assert.equal(calls, 9);
    assert.equal(maxActive, 2);

    hidden = true;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await advanceTo(1180000);
    assert.equal(calls, 9);
    hidden = false;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await advanceTo(1180500);
    assert.equal(calls, 12);
    await advanceTo(1210500);
    assert.equal(calls, 15);

    window.history.pushState({}, '', '/dashboard/providers/other');
    await advanceTo(1240500);
    assert.equal(calls, 15);
    window.history.pushState({}, '', '/dashboard/providers/codex');
    window.document.body.append(window.document.createElement('div'));
    await flush();
    await advanceTo(1241000);
    assert.equal(calls, 18);
  } finally { timers.clear(); dom.window.close(); }
});

test('native mode orders weekly then 5h and adds an inline expiry field without browser storage', async () => {
  const dom = await setup(undefined, { quotas: { session: { remaining: 75 }, weekly: { remaining: 25 }, review_session: { remaining: 50 } } }, markup, nativeSource(script));
  try {
    const { document } = dom.window;
    assert.equal(document.querySelectorAll('[role=progressbar]').length, 2);
    assert.equal(document.querySelectorAll('.codex-addon-chip, [data-codex-expiry]').length, 0);
    assert.equal(document.querySelectorAll('[data-codex-inline-expiry]').length, 1);
    assert.equal(document.querySelector('.codex-addon-bars').firstElementChild.dataset.codexWindow, 'weekly');
    assert.equal(document.querySelector('.codex-addon-bars').lastElementChild.dataset.codexWindow, 'session');
    Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('Quota-only mode must not read storage'); } });
    document.querySelector('#edit').click();
    const modal = document.createElement('div');
    modal.innerHTML = '<h2>Edit Connection</h2><button>Save</button>';
    document.body.append(modal);
    await pause();
    assert.equal(document.querySelector('[data-codex-editor]'), null);
    assert.equal(document.querySelectorAll('[role=progressbar]').length, 2);
  } finally { dom.window.close(); }
});

test('native expiry keeps drafts through refresh, reports failed writes, saves, reloads and clears', async () => {
  const stored = { c1: '25/11/2026' };
  let fail = false, remaining = 70;
  const fetcher = async (url, options) => {
    assert.equal(options.credentials, 'include');
    if (String(url).endsWith('/__codex_addon/expiry')) {
      if (options.method === 'PUT') {
        if (fail) return { ok: false, status: 503 };
        const { id, expiry } = JSON.parse(options.body);
        if (expiry) stored[id] = expiry; else delete stored[id];
      }
      return { ok: true, json: async () => ({ ...stored }) };
    }
    return { ok: true, json: async () => url === '/api/providers' ? { connections: [{ id: 'c1', provider: 'codex', name: 'Account', email: 'a@example.test' }] } : { quotas: { session: { remaining }, weekly: { remaining: 50 } } } };
  };
  const dom = await setup(undefined, undefined, markup, nativeSource(script), fetcher);
  try {
    const { document } = dom.window;
    const input = document.querySelector('[data-codex-inline-expiry] input');
    const editor = document.querySelector('[data-codex-inline-expiry]');
    const save = [...editor.querySelectorAll('button')].find(button => button.textContent === 'Save');
    assert.equal(input.type, 'text');
    assert.equal(input.value, '25/11/2026');
    assert.equal(input.hidden, true);
    assert.equal(editor.querySelector('.codex-addon-note-text').textContent, '25/11/2026');
    assert.equal(document.querySelector('[data-codex-inline-expiry] label').textContent, 'End date:');
    editor.querySelector('[aria-label="Edit end date"]').click();
    assert.equal(input.hidden, false);
    assert.equal(save.hidden, false);
    input.value = 'Hết hạn cuối tháng — chờ gia hạn';
    input.dispatchEvent(new dom.window.Event('input'));
    remaining = 60;
    const later = dom.window.Date.now() + 31000;
    dom.window.Date.now = () => later;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await pause();
    assert.equal(document.querySelector('[data-codex-inline-expiry] input'), input);
    assert.equal(input.value, 'Hết hạn cuối tháng — chờ gia hạn');
    assert.equal(document.querySelector('[data-codex-window=session] [role=progressbar]').getAttribute('aria-valuenow'), '60');
    fail = true; save.click(); await pause();
    assert.match(document.querySelector('.codex-addon-inline-status').textContent, /Lưu thất bại/);
    assert.equal(stored.c1, '25/11/2026');
    assert.equal(input.value, 'Hết hạn cuối tháng — chờ gia hạn');
    assert.equal(save.disabled, false);
    fail = false; save.click(); await pause();
    assert.equal(stored.c1, 'Hết hạn cuối tháng — chờ gia hạn');
    assert.equal(input.hidden, true);
    assert.equal(editor.querySelector('.codex-addon-note-text').textContent, stored.c1);
    const second = await setup(undefined, undefined, markup, nativeSource(script), fetcher);
    try {
      assert.equal(second.window.document.querySelector('[data-codex-inline-expiry] input').value, 'Hết hạn cuối tháng — chờ gia hạn');
      const nextEditor = second.window.document.querySelector('[data-codex-inline-expiry]');
      nextEditor.querySelector('[aria-label="Edit end date"]').click();
      nextEditor.querySelector('input').value = '';
      nextEditor.querySelector('input').dispatchEvent(new second.window.Event('input'));
      [...nextEditor.querySelectorAll('button')].find(button => button.textContent === 'Save').click();
      await pause();
      assert.deepEqual(stored, {});
    } finally { second.window.close(); }
  } finally { dom.window.close(); }
});

test('note blur saves once, failed autosave preserves draft, and clicking Save retries', async () => {
  let writes = 0, fail = false;
  const stored = { c1: 'ngày 24 hết gói Plus' };
  const fetcher = async (url, options) => {
    if (String(url).endsWith('/__codex_addon/expiry')) {
      if (options.method === 'PUT') {
        writes++;
        if (fail) return { ok: false, status: 503 };
        stored.c1 = JSON.parse(options.body).expiry;
      }
      return { ok: true, json: async () => ({ ...stored }) };
    }
    return { ok: true, json: async () => url === '/api/providers' ? { connections: [{ id: 'c1', provider: 'codex', name: 'Account', email: 'a@example.test' }] } : { quotas: { session: { remaining: 70 } } } };
  };
  const dom = await setup(undefined, undefined, markup, nativeSource(script), fetcher);
  try {
    const { document } = dom.window;
    const editor = document.querySelector('[data-codex-inline-expiry]');
    const input = editor.querySelector('input');
    const edit = editor.querySelector('[aria-label="Edit end date"]');
    const save = [...editor.querySelectorAll('button')].find(button => button.textContent === 'Save');
    edit.click();
    input.value = 'ghi chú mới'; input.dispatchEvent(new dom.window.Event('input'));
    input.blur();
    await pause();
    assert.equal(stored.c1, 'ghi chú mới');
    assert.equal(writes, 1);
    assert.equal(input.hidden, true);
    edit.click();
    input.value = 'nội dung đang sửa'; input.dispatchEvent(new dom.window.Event('input'));
    fail = true; input.blur(); await pause();
    assert.equal(writes, 2);
    assert.equal(input.hidden, false);
    assert.equal(input.value, 'nội dung đang sửa');
    assert.equal(stored.c1, 'ghi chú mới');
    assert.match(editor.textContent, /Lưu thất bại/);
    fail = false; save.click(); await pause();
    assert.equal(writes, 3);
    assert.equal(stored.c1, 'nội dung đang sửa');
    edit.click(); input.blur(); await pause();
    assert.equal(writes, 3, 'unchanged note must not create another write');
    edit.click(); input.value = 'lưu bằng nút Save';
    input.dispatchEvent(new dom.window.Event('input'));
    save.focus(); save.click(); await pause();
    assert.equal(writes, 4, 'focus moving to Save must not submit twice');
    assert.equal(stored.c1, 'lưu bằng nút Save');
  } finally { dom.window.close(); }
});

test('unavailable expiry storage does not prevent quota display', async () => {
  const fetcher = async url => String(url).endsWith('/__codex_addon/expiry') ? { ok: false, status: 502 } : { ok: true, json: async () => url === '/api/providers' ? { connections: [{ id: 'c1', provider: 'codex', name: 'Account', email: 'a@example.test' }] } : { quotas: { session: { remaining: 70 }, weekly: { remaining: 50 } } } };
  const dom = await setup(undefined, undefined, markup, nativeSource(script), fetcher);
  try {
    assert.equal(dom.window.document.querySelector('[data-codex-window=session] [role=progressbar]').getAttribute('aria-valuenow'), '70');
    assert.match(dom.window.document.querySelector('.codex-addon-inline-status').textContent, /Không tải được/);
  } finally { dom.window.close(); }
});

test('Check Update shares release state, exposes Install only for a newer release, and installs on explicit click', async () => {
  let available = false, checks = 0, installs = 0;
  const fetcher = async (url, options) => {
    if (String(url).endsWith('/updates')) {
      if (options.method === 'POST') {
        installs++;
        assert.equal(options.headers['x-codex-addon'], '1');
        assert.deepEqual(JSON.parse(options.body), { version: '1.1.0', releaseId: 123 });
        return { ok: true, json: async () => ({ ok: true, version: '1.1.0' }) };
      }
      checks++;
      return { ok: true, json: async () => ({ current: '1.0.0', version: '1.1.0', releaseId: 123, available, installEnabled: true, message: available ? 'Update v1.1.0 available' : 'No published releases yet' }) };
    }
    return { ok: true, json: async () => url === '/api/providers' ? { connections: [{ id: 'c1', provider: 'codex', name: 'Account', email: 'a@example.test' }] } : String(url).endsWith('/expiry') ? {} : { quotas: { session: { remaining: 70 } } } };
  };
  const dom = await setup(undefined, undefined, markup, nativeSource(script), fetcher);
  try {
    const widget = dom.window.document.querySelector('.codex-addon-updates');
    const [check, install] = widget.querySelectorAll('button');
    assert.equal(check.textContent, 'Check Update');
    assert.equal(install.hidden, true);
    assert.equal(checks, 0, 'must not contact GitHub on each quota refresh');
    check.click(); await pause();
    assert.equal(install.hidden, true); assert.equal(installs, 0);
    assert.match(widget.textContent, /No published releases yet/);
    available = true; check.click(); await pause();
    assert.equal(install.hidden, false); assert.equal(install.textContent, 'Install update v1.1.0');
    assert.equal(installs, 0);
    install.click(); install.click(); await pause();
    assert.equal(installs, 1);
    assert.equal(install.hidden, true); assert.equal(check.textContent, 'Reload page');
    assert.match(widget.textContent, /Installed v1.1.0/);
  } finally { dom.window.close(); }
});
test('ambiguous accounts do not attach quota to the wrong connection', async () => {
  const dom = await setup([{ id: 'c1', email: 'a@example.test', name: 'Account' }, { id: 'c2', email: 'a@example.test', name: 'Account' }]);
  try { assert.equal(dom.window.document.querySelector('[data-codex-quota]'), null); }
  finally { dom.window.close(); }
});

test('keeps missing or null quota unknown instead of displaying full or empty quota', async () => {
  for (const value of [
    { message: 'Quota unavailable' },
    { quotas: { session: { used: null }, weekly: null } },
    { quotas: { session: { used: '' }, weekly: { used: false, remaining: 'invalid' } } }
  ]) {
    const dom = await setup(undefined, value);
    try {
      const bars = dom.window.document.querySelectorAll('[role=progressbar]');
      assert.equal(bars.length, 2);
      for (const bar of bars) {
        assert.equal(bar.hasAttribute('aria-valuenow'), false);
        assert.equal(bar.getAttribute('aria-valuetext'), 'Quota unavailable');
        assert.equal(bar.querySelector('.codex-addon-fill'), null);
      }
      assert.doesNotMatch(dom.window.document.querySelector('[data-codex-quota]').textContent, /\d+% remaining/);
    } finally { dom.window.close(); }
  }
});

test('shows remaining values, reset tooltips, low levels and optional quota windows', async () => {
  const dom = await setup(undefined, { quotas: {
    weekly: { used: 80, remaining: 20, resetAt: '2026-12-31T12:00:00Z' },
    session: { used: 30, remaining: 0, resetAt: '2026-12-30T12:00:00Z' },
    review_session: { used: 5 },
    spark_weekly: null
  } });
  try {
    const { document } = dom.window;
    const session = document.querySelector('[data-codex-window=session]');
    const weekly = document.querySelector('[data-codex-window=weekly]');
    assert.equal(document.querySelector('.codex-addon-bars').firstElementChild, weekly);
    assert.equal(session.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), '0');
    assert.equal(session.querySelector('.codex-addon-fill').style.width, '0%');
    assert.equal(session.querySelector('.codex-addon-fill').dataset.level, 'critical');
    assert.equal(weekly.querySelector('.codex-addon-fill').style.width, '20%');
    assert.equal(weekly.querySelector('.codex-addon-fill').dataset.level, 'low');
    assert.equal(session.title, `Reset: ${new Date('2026-12-30T12:00:00Z').toLocaleString()}`);
    assert.match(weekly.title, /^Reset: /);
    assert.match(document.querySelector('.codex-addon-extras').textContent, /Review 5h: 95% remaining/);
    assert.match(document.querySelector('.codex-addon-extras').textContent, /Spark weekly: unavailable/);
  } finally { dom.window.close(); }
});

test('inline reset countdown shows session clock, weekly duration, and updates without replacing the expiry draft', async () => {
  const now = Date.now();
  const value = { quotas: {
    session: { remaining: 17, resetAt: new Date(now + (60 + 52) * 60000).toISOString() },
    weekly: { remaining: 56, resetAt: new Date(now + (6 * 24 + 4) * 3600000).toISOString() }
  } };
  const dom = await setup(undefined, value, markup, nativeSource(script));
  try {
    const { document } = dom.window;
    const session = document.querySelector('[data-codex-window=session] .codex-addon-reset');
    const weekly = document.querySelector('[data-codex-window=weekly] .codex-addon-reset');
    assert.match(session.textContent, /Resets in 1h 52m · \d{2}:\d{2}/);
    assert.match(weekly.textContent, /Resets in 6d 4h/);
    assert.doesNotMatch(weekly.textContent, /·/);
    const input = document.querySelector('[data-codex-inline-expiry] input');
    document.querySelector('[data-codex-inline-expiry] [aria-label="Edit end date"]').click();
    input.value = '31/03/2027'; input.dispatchEvent(new dom.window.Event('input'));
    dom.window.Date.now = () => now + 31 * 60000;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await pause();
    assert.match(session.textContent, /Resets in 1h 21m/);
    assert.equal(document.querySelector('[data-codex-inline-expiry] input'), input);
    assert.equal(input.value, '31/03/2027');
    dom.window.Date.now = () => now + 3 * 3600000;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await pause();
    assert.match(session.textContent, /Reset due/);
    assert.doesNotMatch(session.textContent, /Resets in -/);
  } finally { dom.window.close(); }
});

test('refresh replaces quota and stale errors without duplicating bars', async () => {
  let value = { message: 'Temporarily unavailable' };
  const dom = await setup(undefined, () => value);
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector('[data-codex-quota]').title, value.message);
    value = { quotas: { session: { remaining: 150 }, weekly: { used: 120 } } };
    document.querySelector('[data-codex-quota] button').click();
    await pause();
    assert.equal(document.querySelector('[data-codex-quota]').title, '');
    assert.equal(document.querySelectorAll('[role=progressbar]').length, 2);
    assert.equal(document.querySelector('[data-codex-window=session] [role=progressbar]').getAttribute('aria-valuenow'), '100');
    assert.equal(document.querySelector('[data-codex-window=weekly] [role=progressbar]').getAttribute('aria-valuenow'), '0');
    assert.equal(document.querySelector('[data-codex-quota] button').disabled, false);
  } finally { dom.window.close(); }
});

test('matches overlapping account identities exactly and only decorates Connections', async () => {
  const accounts = [
    { id: 'c1', email: 'a@example.test', name: 'Account' },
    { id: 'c2', email: 'ba@example.test', name: 'Account two' }
  ];
  const html = `<section><h2>Other settings</h2>${accountRow('a@example.test', 'Account', 'other')}</section>
    <section><div><h2>Connections</h2></div><div>${accounts.map((c, i) => accountRow(c.email, c.name, `row${i}`)).join('')}</div></section>`;
  const dom = await setup(accounts, url => ({ quotas: { session: { remaining: url.endsWith('c1') ? 70 : 15 }, weekly: { remaining: 60 } } }), html);
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector('#other [data-codex-quota]'), null);
    assert.equal(document.querySelector('#row0 [data-codex-quota]').dataset.codexQuota, 'c1');
    assert.equal(document.querySelector('#row1 [data-codex-quota]').dataset.codexQuota, 'c2');
    assert.equal(document.querySelector('#row1 [data-codex-window=session] [role=progressbar]').getAttribute('aria-valuenow'), '15');
  } finally { dom.window.close(); }
});

test('reused account row replaces old bars and refreshes the new account', async () => {
  const accounts = [
    { id: 'c1', email: 'a@example.test', name: 'Account' },
    { id: 'c2', email: 'b@example.test', name: 'Second' }
  ];
  const requests = [];
  const dom = await setup(accounts, url => { requests.push(url); return { quotas: { session: { remaining: 50 } } }; });
  try {
    const { document } = dom.window;
    const details = document.querySelector('[data-details]');
    const paragraphs = details.querySelectorAll('p');
    paragraphs[0].firstChild.textContent = 'Second';
    paragraphs[1].firstChild.textContent = 'b@example.test';
    await pause();
    assert.equal(document.querySelectorAll('[data-codex-quota]').length, 1);
    assert.equal(document.querySelector('[data-codex-quota]').dataset.codexQuota, 'c2');
    assert.equal(document.querySelector('[data-codex-expiry]').dataset.codexExpiry, 'c2');
    document.querySelector('[data-codex-quota] button').click();
    await pause();
    assert.equal(requests.at(-1), '/api/usage/c2');
    paragraphs[0].firstChild.textContent = 'Unknown';
    paragraphs[1].firstChild.textContent = 'unknown@example.test';
    await pause();
    assert.equal(document.querySelectorAll('[data-codex-quota], [data-codex-expiry]').length, 0);
  } finally { dom.window.close(); }
});
