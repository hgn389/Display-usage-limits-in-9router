// ==UserScript==
// @name         9router Codex Connections Addon
// @namespace    9router-codex-addon
// @version      1.0.0
// @description  Codex quota, compact Antigravity quota and administrator notes
// @match        http://localhost:9090/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  const nativeMode = false; // Native installer sets this to true.
  if (window.__codexAddonLoaded) return;
  window.__codexAddonLoaded = true;
  const serverStorage = nativeMode || !!document.querySelector('script[src="/__codex_addon/client.js"]');
  const expiryEndpoint = nativeMode ? (() => { const url = new URL('/__codex_addon/expiry', location.origin); url.port = '9092'; return url.href; })() : '/__codex_addon/expiry';
  const storageKey = '9router-codex-addon-expiry-v1';
  const refreshInterval = 30000;
  const updateState = { busy: false, selection: null, message: '', installed: false };
  const updateWidgets = new Set();
  let connections = [], dates = {}, selected = null, loading = false, lastLoad = null, refreshTimer;
  let expiryLoadError = false;
  let expiryInputSequence = 0;
  let datesRevision = 0;
  let loadedProvider = null;
  const currentProvider = () => /^\/dashboard\/providers\/(codex|antigravity)\/?$/.exec(location.pathname)?.[1] || null;
  const quotas = new Map();
  const watched = new WeakSet();
  const labels = { session: '5h', weekly: 'Weekly', review_session: 'Review 5h', review_weekly: 'Review weekly', spark_session: 'Spark 5h', spark_weekly: 'Spark weekly' };
  const style = document.createElement('style');
  style.textContent = `
    .codex-addon{font-size:12px;line-height:1.6;color:inherit}
    .codex-addon-date{margin-left:8px;color:#d69e36}
    .codex-addon-quota{display:flex;flex-direction:column;gap:7px;margin:8px 0 2px;width:100%;max-width:660px;min-width:0}
    .codex-addon-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
    .codex-addon-summary:has(.codex-addon-inline-expiry){grid-template-columns:minmax(60px,1fr) minmax(60px,1fr) minmax(160px,1.3fr)}
    .codex-addon-summary>.codex-addon-bars{display:contents}
    .codex-addon-bars{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .codex-addon-meter{min-width:0}
    .codex-addon-meter-label{display:block;font-size:11px;margin-bottom:3px;overflow-wrap:anywhere}
    .codex-addon-reset{display:block;font-size:10px;opacity:.75}
    @keyframes codex-addon-quota-colors{
      0%,100%{color:#facc15}
      20%{color:#3fd1ff}
      40%{color:#ff3fe9}
      60%{color:#ff6800}
      80%{color:#ff3c3c}
    }
    .codex-addon-percentage,.codex-addon-reset-clock{color:#facc15;animation:codex-addon-quota-colors 10s linear infinite}
    .codex-addon-duration{color:#22c55e}
    .codex-addon-track{height:7px;overflow:hidden;border-radius:999px;background:#71809633}
    .codex-addon-fill{display:block;height:100%;border-radius:inherit;background:#22a06b}
    .codex-addon-fill[data-level="low"]{background:#d69e36}
    .codex-addon-fill[data-level="critical"]{background:#e05252}
    .codex-addon-track[data-unavailable]{border:1px dashed #71809688;box-sizing:border-box}
    .codex-addon-extras{display:flex;flex-wrap:wrap;gap:6px}
    .codex-addon-chip{border:1px solid #71809666;border-radius:5px;padding:2px 7px}
    .codex-addon-quota-footer{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11px}
    .codex-addon-quota-footer>span{opacity:.75}
    .codex-addon-editor{margin:12px 0;padding:12px;border:1px solid #71809666;border-radius:8px}
    .codex-addon input{color:inherit;background:transparent;border:1px solid #718096;border-radius:4px;padding:6px}
    .codex-addon button{cursor:pointer;text-decoration:underline;margin-left:8px}
    .codex-addon button:disabled{cursor:wait;opacity:.6}
    .codex-addon [hidden]{display:none!important}
    .codex-addon-inline-expiry{min-width:0}
    .codex-addon-inline-expiry label{font-size:11px;white-space:nowrap}
    .codex-addon-inline-controls{display:flex;align-items:flex-start;gap:5px}
    .codex-addon-inline-field{display:flex;flex:0 1 auto;align-items:baseline;gap:4px;min-width:0;font-size:11px}
    .codex-addon-note-text{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
    .codex-addon-inline-controls input{flex:1;min-width:0;width:100%;box-sizing:border-box;font:inherit;border:0;border-radius:0;padding:0;background:transparent;outline:none;box-shadow:none}
    .codex-addon-inline-controls button{margin:0;font-size:11px}
    .codex-addon-inline-controls .codex-addon-note-edit{display:inline-flex;flex:none;align-items:center;justify-content:center;width:20px;height:20px;padding:2px;border:1px solid #71809688;border-radius:3px;color:inherit;background:transparent;text-decoration:none}
    .codex-addon-note-edit svg{width:14px;height:14px}
    .codex-addon-inline-status{display:block;font-size:10px}
    .codex-addon-updates{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:5px;font-size:10px}
    .codex-addon-updates button{margin:0;padding:1px 6px;border:1px solid #71809688;border-radius:5px;background:transparent;color:inherit;font-size:10px;text-decoration:none;line-height:1.7}
    .codex-addon-update-status{font-size:10px;opacity:.8}
    .codex-addon-error{color:#e97575}
    .codex-addon-antigravity{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:11px;line-height:1.7;margin-top:3px;color:inherit;opacity:.8}
    @media(max-width:640px){.codex-addon-summary:has(.codex-addon-inline-expiry){grid-template-columns:repeat(2,minmax(0,1fr))}.codex-addon-inline-expiry{grid-column:1/-1}}
  `;
  document.head.append(style);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  async function api(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    if (!response.ok) { let body; try { body = await response.json(); } catch { body = {}; } const error = new Error(body.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return response.json();
  }
  async function saveDate(id, expiry) {
    if (serverStorage) await api(expiryEndpoint, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-codex-addon': '1' }, body: JSON.stringify({ id, expiry }) });
    const next = { ...dates };
    if (expiry) next[id] = expiry; else delete next[id];
    if (!serverStorage) localStorage.setItem(storageKey, JSON.stringify(next));
    dates = next;
    datesRevision++;
    render();
  }
  function scheduleLoad() {
    clearTimeout(refreshTimer);
    const provider = currentProvider();
    if (document.hidden || !provider) return;
    refreshTimer = setTimeout(() => void load(), provider !== loadedProvider ? 0 : Math.max(0, lastLoad + refreshInterval - Date.now()));
  }
  async function load() {
    const provider = currentProvider();
    if (document.hidden || !provider) return;
    if (loading) return;
    if (provider === loadedProvider && lastLoad !== null && Date.now() - lastLoad < refreshInterval) { scheduleLoad(); return; }
    loading = true;
    loadedProvider = provider;
    lastLoad = Date.now();
    try {
      const result = await api('/api/providers');
      if (currentProvider() !== provider) return;
      connections = (result.connections || []).filter(c => c.provider === provider).map(c => ({ id: c.id, email: c.email, name: c.name, provider: c.provider }));
      if (provider === 'codex') try {
        const revision = datesRevision;
        const loaded = serverStorage ? await api(expiryEndpoint) : JSON.parse(localStorage.getItem(storageKey) || '{}');
        if (revision === datesRevision) dates = loaded;
        expiryLoadError = false;
      } catch { expiryLoadError = true; }
      render();
      // One clock controls refresh cadence; no second cache TTL can skip a cycle.
      // Bounded concurrency, one request per account per refresh window.
      const queue = [...connections];
      await Promise.all(Array.from({ length: 2 }, async () => {
        for (let c; currentProvider() === provider && (c = queue.shift());) await refresh(c);
      }));
    } catch (error) { console.warn('[Codex addon] Unable to load metadata:', error.message); }
    finally { loading = false; scheduleLoad(); }
  }
  async function refresh(c) {
    try { quotas.set(c.id, { value: await api(`/api/usage/${encodeURIComponent(c.id)}`) }); }
    catch (error) { quotas.set(c.id, { value: { message: `Quota unavailable (${error.message})` } }); }
    render();
  }
  function identityNodes(row) {
    const nodes = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let text; (text = walker.nextNode());) {
      if (!text.parentElement.closest('button, .codex-addon')) nodes.push(text);
    }
    return nodes;
  }
  function uniqueAccount(row) {
    const texts = new Set(identityNodes(row).map(text => text.textContent.trim()));
    const accounts = connections.filter(c => c.provider === currentProvider());
    const emails = accounts.filter(c => c.email && texts.has(c.email.trim()));
    if (emails.length === 1) return emails[0];
    if (new Set(emails.map(c => c.email.trim())).size > 1) return null;
    const names = (emails.length ? emails : accounts).filter(c => c.name && texts.has(c.name.trim()));
    return names.length === 1 ? names[0] : null;
  }
  const isEdit = button => !button.closest('.codex-addon') && (
    /\bedit\b/i.test(button.getAttribute('aria-label') || button.innerText || button.textContent) ||
    [...button.querySelectorAll('span')].some(span => span.textContent.trim().toLowerCase() === 'edit')
  );
  function connectionsRoot() {
    const heading = [...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Connections');
    let node = heading?.parentElement;
    while (node && node !== document.body) {
      if ([...node.querySelectorAll('button')].some(isEdit)) return node;
      node = node.parentElement;
    }
    return null;
  }
  function findRow(button) {
    let node = button.parentElement;
    while (node && node !== document.body) {
      const edits = [...node.querySelectorAll('button')].filter(isEdit);
      if (edits.length > 1) return null;
      const c = uniqueAccount(node);
      if (c) return { node, c };
      node = node.parentElement;
    }
    return null;
  }
  function remainingPercent(q) {
    const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : null;
    const remaining = number(q?.remaining);
    const used = number(q?.used);
    const value = remaining ?? (used === null ? null : 100 - used);
    return value === null ? null : Math.max(0, Math.min(100, value));
  }
  function resetTooltip(node, q) {
    if (!q?.resetAt) return;
    const reset = new Date(q.resetAt);
    if (Number.isFinite(reset.getTime())) node.title = `Reset: ${reset.toLocaleString()}`;
  }
  function updateResetLabels(panel) {
    for (const node of panel.querySelectorAll('[data-codex-reset-at]')) {
      const reset = new Date(node.dataset.codexResetAt);
      const minutes = Math.max(0, Math.ceil((reset.getTime() - Date.now()) / 60000));
      const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
      const duration = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${mins}m`;
      const clock = node.dataset.codexResetWindow === 'session' ? reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      const text = minutes > 0 ? ` (Resets in ${duration}${clock ? ` | ${clock}` : ''})` : ` (Reset due${clock ? ` | ${clock}` : ''})`;
      if (node.textContent !== text) {
        node.replaceChildren(minutes > 0 ? ' (Resets in ' : ' (Reset due');
        if (minutes > 0) node.append(el('span', duration, 'codex-addon-duration'));
        if (clock) node.append(' | ', el('span', clock, 'codex-addon-reset-clock'));
        node.append(')');
      }
    }
  }
  function quotaMeter(key, q, loading) {
    const remaining = remainingPercent(q);
    const meter = el('div', '', 'codex-addon-meter');
    meter.dataset.codexWindow = key;
    const label = el('span', `${labels[key]}: `, 'codex-addon-meter-label');
    if (remaining === null) label.append(loading ? 'Loading...' : 'unavailable');
    else label.append(el('span', `${remaining.toFixed(0)}%`, 'codex-addon-percentage'), ' remaining');
    if (q?.resetAt && Number.isFinite(new Date(q.resetAt).getTime())) {
      const reset = el('span', '', 'codex-addon-reset');
      reset.dataset.codexResetAt = new Date(q.resetAt).toISOString();
      reset.dataset.codexResetWindow = key;
      label.append(reset);
    }
    const track = el('div', '', 'codex-addon-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `${labels[key]} quota remaining`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    if (remaining === null) {
      track.dataset.unavailable = '';
      track.setAttribute('aria-valuetext', loading ? 'Loading quota' : 'Quota unavailable');
    } else {
      track.setAttribute('aria-valuenow', String(remaining));
      const fill = el('span', '', 'codex-addon-fill');
      fill.style.width = `${remaining}%`;
      fill.dataset.level = remaining <= 10 ? 'critical' : remaining <= 25 ? 'low' : 'normal';
      track.append(fill);
    }
    resetTooltip(meter, q);
    meter.append(label, track);
    return meter;
  }
  function antigravityQuota(panel, value) {
    const signature = JSON.stringify(value || null);
    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      panel.replaceChildren();
      const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
      for (const [key, quota] of Object.entries(value?.quotas || {})) {
        if (!quota || typeof quota !== 'object') continue;
        const percentage = number(quota.remainingPercentage);
        const fraction = number(quota.remainingFraction);
        const used = number(quota.used), total = number(quota.total);
        const remaining = percentage ?? (fraction === null ? (used !== null && total > 0 ? 100 * (1 - used / total) : null) : fraction * 100);
        const label = (typeof quota.displayName === 'string' ? quota.displayName : key.replaceAll('_', ' '))
          .replace(/\s*\(Weekly\)/i, ' tuần').replace(/\s*\(5h\)/i, ' 5h').replace(/Claude\s*&\s*GPT/i, 'Claude/GPT');
        const text = quota.unlimited === true ? 'không giới hạn' : remaining === null ? 'chưa có dữ liệu' : `${Math.max(0, Math.min(100, remaining)).toFixed(0)}%`;
        const item = el('span', `${label}: `);
        if (remaining !== null && quota.unlimited !== true) item.append(el('span', text, 'codex-addon-percentage'));
        else item.append(text);
        const reset = new Date(quota.resetAt || '');
        if (Number.isFinite(reset.getTime())) {
          const countdown = el('span'); countdown.dataset.antigravityResetAt = reset.toISOString();
          item.title = `Reset: ${reset.toLocaleString()}`;
          item.append(countdown);
        }
        panel.append(item);
      }
      if (!panel.childElementCount) panel.append(el('span', value ? 'Quota: chưa có dữ liệu' : 'Quota: đang tải…'));
    }
    for (const node of panel.querySelectorAll('[data-antigravity-reset-at]')) {
      const minutes = Math.max(0, Math.ceil((new Date(node.dataset.antigravityResetAt).getTime() - Date.now()) / 60000));
      const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
      const duration = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${mins}m`;
      const text = minutes > 0 ? ` (reset ${duration})` : ' (đến giờ reset)';
      if (node.textContent !== text) {
        if (minutes > 0) node.replaceChildren(' (reset ', el('span', duration, 'codex-addon-duration'), ')');
        else node.textContent = text;
      }
    }
  }
  function inlineExpiry(id) {
    const editor = el('div', '', 'codex-addon-inline-expiry');
    editor.dataset.codexInlineExpiry = id;
    const label = el('label', 'End date:');
    const text = el('span', dates[id] || '—', 'codex-addon-note-text');
    const input = el('input'); input.type = 'text'; input.value = dates[id] || '';
    input.id = `codex-addon-expiry-${++expiryInputSequence}`;
    label.htmlFor = input.id;
    input.setAttribute('aria-label', 'End date');
    input.placeholder = 'Ghi chú của admin';
    input.maxLength = 500;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.hidden = true;
    const controls = el('div', '', 'codex-addon-inline-controls');
    const edit = el('button', '', 'codex-addon-note-edit'); edit.type = 'button';
    edit.setAttribute('aria-label', 'Edit end date'); edit.title = 'Sửa ghi chú';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M16 3a2.1 2.1 0 0 1 3 3L7 18l-4 1 1-4Z M14.5 4.5l3 3');
    icon.append(path); edit.append(icon);
    const save = el('button', 'Save'); save.type = 'button'; save.hidden = true;
    const status = el('span', '', 'codex-addon-inline-status');
    status.setAttribute('role', 'status'); status.hidden = true;
    let editing = false, saving = false;
    const message = (value, error = false) => {
      if (status.textContent !== value) status.textContent = value;
      status.hidden = !value;
      status.classList.toggle('codex-addon-error', error);
    };
    const finish = () => {
      editing = false;
      text.textContent = dates[id] || '—'; text.title = dates[id] || '';
      input.hidden = save.hidden = true;
      text.hidden = edit.hidden = false;
    };
    const persist = async () => {
      if (!editing || saving) return;
      if (input.value === (dates[id] || '') && !expiryLoadError) { finish(); message(''); return; }
      const draft = input.value;
      saving = true;
      input.disabled = save.disabled = true;
      message('Đang lưu…');
      try {
        await saveDate(id, draft);
        expiryLoadError = false;
        finish(); message('');
      } catch (error) {
        const reason = error.status === 401 ? 'Phiên đăng nhập hết hạn. Đăng nhập lại để lưu.'
          : error.status === 403 ? 'Không được phép lưu từ trang hiện tại.'
          : error.status === 400 ? 'Không lưu được ghi chú. Nội dung tối đa 500 ký tự.'
          : error instanceof TypeError ? 'Không kết nối được dịch vụ lưu ghi chú. Bấm Save để thử lại.'
          : 'Lưu thất bại. Bấm Save để thử lại.';
        message(reason, true);
      } finally { saving = false; input.disabled = save.disabled = false; }
    };
    edit.addEventListener('click', () => {
      input.value = dates[id] || '';
      input.hidden = save.hidden = false;
      text.hidden = edit.hidden = true;
      editing = true; message('');
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    });
    input.addEventListener('input', () => message(''));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); void persist(); }
      if (event.key === 'Escape' && !saving) { event.preventDefault(); finish(); message(''); }
    });
    save.addEventListener('click', () => void persist());
    editor.addEventListener('focusout', () => queueMicrotask(() => {
      if (editing && !saving && !controls.contains(document.activeElement)) void persist();
    }));
    const field = el('div', '', 'codex-addon-inline-field'); field.append(label, text, input);
    controls.append(field, edit, save);
    editor.append(controls, status, updateControls());
    editor.sync = () => {
      if (editing || saving) return;
      const value = dates[id] || '';
      if (text.textContent !== (value || '—')) text.textContent = value || '—';
      if (text.title !== value) text.title = value;
      if (input.value !== value) input.value = value;
      if (expiryLoadError) message('Không tải được ghi chú đã lưu.', true);
      else if (status.classList.contains('codex-addon-error')) message('');
    };
    return editor;
  }
  function notifyUpdates() {
    for (const widget of updateWidgets) {
      if (!widget.isConnected) { updateWidgets.delete(widget); continue; }
      widget.sync();
    }
  }
  function updateControls() {
    const widget = el('div', '', 'codex-addon-updates');
    const check = el('button', 'Check Update'); check.type = 'button';
    const install = el('button'); install.type = 'button'; install.hidden = true;
    const status = el('span', '', 'codex-addon-update-status'); status.setAttribute('role', 'status');
    const endpoint = expiryEndpoint.replace(/\/expiry$/, '/updates');
    widget.sync = () => {
      check.disabled = install.disabled = updateState.busy;
      install.hidden = !updateState.selection;
      install.textContent = updateState.selection ? `Install update v${updateState.selection.version}` : '';
      status.textContent = updateState.message;
      check.textContent = updateState.installed ? 'Reload page' : 'Check Update';
    };
    check.addEventListener('click', async () => {
      if (updateState.installed) { location.reload(); return; }
      if (updateState.busy) return;
      updateState.busy = true; updateState.message = 'Checking…'; updateState.selection = null; notifyUpdates();
      try {
        const result = await api(endpoint);
        updateState.selection = result.available && result.installEnabled ? { version: result.version, releaseId: result.releaseId } : null;
        updateState.message = result.available && !result.installEnabled ? 'Start the addon service with service.mjs to install updates.' : result.message;
      } catch (error) { updateState.message = error.status ? error.message : 'Cannot connect to update service.'; }
      finally { updateState.busy = false; notifyUpdates(); }
    });
    install.addEventListener('click', async () => {
      if (updateState.busy || !updateState.selection) return;
      updateState.busy = true; updateState.message = 'Installing…'; notifyUpdates();
      try {
        const result = await api(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-codex-addon': '1' }, body: JSON.stringify(updateState.selection) });
        updateState.selection = null; updateState.installed = true;
        updateState.message = `Installed v${result.version}. Reload and clear browser cache if needed.`;
      } catch (error) { updateState.message = error.status ? error.message : 'Connection interrupted. Check Update again before retrying.'; }
      finally { updateState.busy = false; notifyUpdates(); }
    });
    widget.append(check, install, status);
    updateWidgets.add(widget); widget.sync();
    return widget;
  }
  function render() {
    const provider = currentProvider();
    if (!provider) return;
    const root = connectionsRoot();
    const mounted = new Set();
    for (const button of root?.querySelectorAll('button') || []) {
      if (!isEdit(button)) continue;
      const match = findRow(button);
      if (!match) continue;
      const { node: row, c } = match;
      if (provider === 'antigravity') {
        for (const node of row.querySelectorAll('[data-codex-quota], [data-codex-expiry]')) node.remove();
        for (const node of row.querySelectorAll('[data-antigravity-quota]')) if (node.dataset.antigravityQuota !== c.id) node.remove();
        let panel = row.querySelector('[data-antigravity-quota]');
        if (!panel) {
          const texts = identityNodes(row);
          const identity = (texts.find(text => text.textContent.trim() === c.email?.trim()) || texts.find(text => text.textContent.trim() === c.name?.trim()))?.parentElement;
          panel = el('div', '', 'codex-addon codex-addon-antigravity');
          panel.dataset.antigravityQuota = c.id;
          if (identity && identity !== row) identity.after(panel); else row.append(panel);
        }
        mounted.add(panel);
        antigravityQuota(panel, quotas.get(c.id)?.value);
        continue;
      }
      for (const node of row.querySelectorAll('[data-antigravity-quota]')) node.remove();
      if (!watched.has(button)) {
        watched.add(button);
        button.addEventListener('click', () => { selected = findRow(button)?.c.id || null; setTimeout(render, 0); }, true);
      }
      for (const node of row.querySelectorAll('[data-codex-quota], [data-codex-expiry]')) {
        if ((node.dataset.codexQuota || node.dataset.codexExpiry) !== c.id) node.remove();
      }
      const texts = identityNodes(row);
      const identity = (texts.find(text => text.textContent.trim() === c.email?.trim()) || texts.find(text => text.textContent.trim() === c.name?.trim()))?.parentElement;
      let badge = row.querySelector('[data-codex-expiry]');
      if (!nativeMode && !badge) {
        if (identity) {
          badge = el('span', '', 'codex-addon codex-addon-date');
          badge.dataset.codexExpiry = c.id;
          identity.append(badge);
        }
      }
      const dateText = dates[c.id] ? `Expiry: ${dates[c.id]}` : '';
      if (badge && badge.textContent !== dateText) badge.textContent = dateText;
      if (badge) mounted.add(badge);
      let panel = row.querySelector('[data-codex-quota]');
      if (!panel) {
        panel = el('div', '', 'codex-addon codex-addon-quota');
        panel.dataset.codexQuota = c.id;
        // Keep bars in the account details column, out of the native actions row.
        const host = identity && identity !== row ? identity.parentElement : row;
        host.append(panel);
        const summary = el('div', '', 'codex-addon-summary');
        summary.append(el('div', '', 'codex-addon-bars'));
        if (nativeMode) summary.append(inlineExpiry(c.id));
        panel.append(summary, el('div', '', 'codex-addon-details'));
      }
      mounted.add(panel);
      panel.querySelector('[data-codex-inline-expiry]')?.sync();
      const value = quotas.get(c.id)?.value;
      const signature = JSON.stringify(value || null);
      if (panel.dataset.signature !== signature) {
        panel.dataset.signature = signature;
        panel.title = typeof (value?.message || value?.error) === 'string' ? value.message || value.error : '';
        const bars = panel.querySelector('.codex-addon-bars');
        bars.replaceChildren();
        for (const key of ['weekly', 'session']) bars.append(quotaMeter(key, value?.quotas?.[key], !value));
        const details = panel.querySelector('.codex-addon-details'); details.replaceChildren();
        const windows = Object.entries(value?.quotas || {}).filter(([key]) => key !== 'session' && key !== 'weekly');
        const extras = el('div', '', 'codex-addon-extras');
        for (const [key, q] of windows) {
          const remaining = remainingPercent(q);
          const chip = el('span', `${labels[key] || key}: ${remaining === null ? 'unavailable' : `${remaining.toFixed(0)}% remaining`}`, 'codex-addon-chip');
          resetTooltip(chip, q);
          extras.append(chip);
        }
        if (!nativeMode && extras.childElementCount) details.append(extras);
        const footer = el('div', '', 'codex-addon-quota-footer');
        if (!value || !Object.keys(value.quotas || {}).length) footer.append(el('span', value ? 'Quota unavailable' : 'Loading quota...'));
        const reload = el('button', 'Refresh'); reload.type = 'button';
        reload.addEventListener('click', async () => { reload.disabled = true; await refresh(c); reload.disabled = false; });
        footer.append(reload);
        if (!nativeMode) details.append(footer);
      }
      updateResetLabels(panel);
    }
    for (const node of root?.querySelectorAll('[data-codex-quota], [data-codex-expiry], [data-antigravity-quota]') || []) {
      if (!mounted.has(node)) node.remove();
    }
    if (nativeMode) return;
    const title = [...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Edit Connection');
    if (!title || !selected || !connections.some(c => c.id === selected)) return;
    let modal = title.parentElement;
    while (modal && ![...modal.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save')) modal = modal.parentElement;
    if (!modal || modal.querySelector('[data-codex-editor]')) return;
    const id = selected;
    const editor = el('div', '', 'codex-addon codex-addon-editor'); editor.dataset.codexEditor = id;
    const label = el('label', 'Expiry date (manual) ');
    const input = el('input'); input.type = 'date'; input.value = dates[id] || ''; label.append(input);
    const note = el('div', serverStorage ? 'Stored separately on addon server.' : 'Stored in this browser only. Use addon proxy for shared server storage.');
    const save = el('button', 'Save expiry'); save.type = 'button';
    const status = el('span');
    const persist = async () => {
      try { await saveDate(id, input.value); status.textContent = ' Saved'; status.className = ''; return true; }
      catch { status.textContent = ' Save failed. Date was not saved.'; status.className = 'codex-addon-error'; return false; }
    };
    save.addEventListener('click', async () => { save.disabled = true; await persist(); save.disabled = false; });
    editor.append(label, save, status, note);
    const nativeSave = [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save');
    nativeSave.parentElement.before(editor);
    let bypass = false;
    nativeSave.addEventListener('click', async event => {
      if (bypass) return;
      event.preventDefault(); event.stopImmediatePropagation();
      nativeSave.disabled = true;
      const ok = await persist();
      nativeSave.disabled = false;
      if (ok) { bypass = true; nativeSave.click(); bypass = false; }
    }, true);
  }
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (currentProvider()) { render(); void load(); } }, 150);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('storage', () => { if (!nativeMode && !serverStorage) { try { dates = JSON.parse(localStorage.getItem(storageKey) || '{}'); render(); } catch {} } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(refreshTimer); else void load(); });
  void load();
})();
