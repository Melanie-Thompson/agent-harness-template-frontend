const API_BASE = 'http://localhost:8000';

const state = {
  screen: 'login',
  email: '',
  userId: null,
  messages: [],
  isStreaming: false,
  abortController: null,
  pendingActions: [],
  logPanelOpen: false,
  logEventSource: null,
  logLevelFilter: 'INFO',
  logUnreadCount: 0,
};

// --- DOM refs (cached after DOMContentLoaded) ---

let dom = {};

function cacheDOM() {
  dom = {
    loginScreen: document.getElementById('login-screen'),
    chatScreen: document.getElementById('chat-screen'),
    emailStep: document.getElementById('email-step'),
    otpStep: document.getElementById('otp-step'),
    emailInput: document.getElementById('email-input'),
    otpInput: document.getElementById('otp-input'),
    otpEmail: document.getElementById('otp-email'),
    sendCodeBtn: document.getElementById('send-code-btn'),
    verifyBtn: document.getElementById('verify-btn'),
    loginError: document.getElementById('login-error'),
    loginLoading: document.getElementById('login-loading'),
    userEmail: document.getElementById('user-email'),
    messageList: document.getElementById('message-list'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),
    confirmOverlay: document.getElementById('confirm-overlay'),
    confirmToolName: document.getElementById('confirm-tool-name'),
    confirmToolArgs: document.getElementById('confirm-tool-args'),
    logPanel: document.getElementById('log-panel'),
    logEntries: document.getElementById('log-entries'),
    logLevelFilter: document.getElementById('log-level-filter'),
    logToggle: document.getElementById('log-panel-toggle'),
    logBadge: document.getElementById('log-badge'),
  };
}

// --- API helpers ---

async function apiPost(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return resp.json();
}

async function apiGet(path) {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return resp.json();
}

// --- Screen rendering ---

function showScreen(name) {
  state.screen = name;
  dom.loginScreen.classList.toggle('active', name === 'login');
  dom.chatScreen.classList.toggle('active', name === 'chat');
}

function showLoginError(msg) {
  dom.loginError.textContent = msg;
  dom.loginError.classList.remove('hidden');
}

function hideLoginError() {
  dom.loginError.classList.add('hidden');
}

function setLoginLoading(loading) {
  dom.loginLoading.classList.toggle('hidden', !loading);
  dom.sendCodeBtn.disabled = loading;
  dom.verifyBtn.disabled = loading;
}

// --- Auth flow ---

async function handleSendCode() {
  const email = dom.emailInput.value.trim();
  if (!email) return;

  hideLoginError();
  setLoginLoading(true);

  try {
    await apiPost('/auth/otp/send', { email });
    state.email = email;
    dom.otpEmail.textContent = email;
    dom.emailStep.classList.add('hidden');
    dom.otpStep.classList.remove('hidden');
    dom.otpInput.value = '';
    dom.otpInput.focus();
  } catch (e) {
    showLoginError(e.message);
  } finally {
    setLoginLoading(false);
  }
}

async function handleVerify() {
  const code = dom.otpInput.value.trim();
  if (code.length !== 6) return;

  hideLoginError();
  setLoginLoading(true);

  try {
    const data = await apiPost('/auth/otp/verify', { email: state.email, code });
    state.userId = data.user_id;
    enterChat();
  } catch (e) {
    showLoginError(e.message);
  } finally {
    setLoginLoading(false);
  }
}

function handleBackToEmail() {
  dom.otpStep.classList.add('hidden');
  dom.emailStep.classList.remove('hidden');
  hideLoginError();
  dom.emailInput.focus();
}

async function handleLogout() {
  try {
    await apiPost('/sessions/logout', {});
  } catch (_) {
    // ignore — clear local state regardless
  }
  state.userId = null;
  state.email = '';
  state.messages = [];
  state.pendingActions = [];
  dom.messageList.innerHTML = '';
  dom.otpStep.classList.add('hidden');
  dom.emailStep.classList.remove('hidden');
  hideLoginError();
  showScreen('login');
}

function enterChat() {
  dom.userEmail.textContent = state.email || state.userId;
  showScreen('chat');
  dom.chatInput.focus();
}

// --- Message rendering ---

function shouldAutoScroll() {
  const el = dom.messageList;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function scrollToBottom() {
  dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function appendMessage(role, content, extra) {
  const willScroll = shouldAutoScroll();

  const el = document.createElement('div');

  const ROLE_CLASS = {
    user: 'msg msg-user',
    assistant: 'msg msg-assistant',
    system: 'msg msg-system',
    tool_call: 'tool-card',
    tool_result: 'tool-card',
    tool_pending: 'tool-card',
    tool_error: 'tool-card tool-error',
    blocked: 'tool-card tool-blocked',
  };

  el.className = ROLE_CLASS[role] || 'msg msg-system';

  const RENDERERS = {
    user:        () => { el.textContent = content; },
    assistant:   () => { el.textContent = content; },
    system:      () => { el.textContent = content; },
    tool_call:   () => renderToolCall(el, content, extra),
    tool_result: () => renderToolResult(el, content, extra),
    tool_pending:() => renderToolPending(el, content, extra),
    tool_error:  () => renderToolError(el, content, extra),
    blocked:     () => renderBlocked(el, content, extra),
  };

  const renderer = RENDERERS[role];
  if (renderer) {
    renderer();
  } else {
    el.textContent = content;
  }

  if (extra && extra.id) el.id = extra.id;

  dom.messageList.appendChild(el);
  state.messages.push({ role, content, extra });

  if (willScroll) scrollToBottom();
  return el;
}

function renderToolCall(el, toolName, extra) {
  el.innerHTML = `
    <div class="tool-label">Tool Call</div>
    <div class="tool-name">${esc(toolName)}</div>
    <pre>${esc(JSON.stringify(extra.args, null, 2))}</pre>
  `;
}

function renderToolResult(el, toolName, extra) {
  el.innerHTML = `
    <div class="tool-label">Tool Result</div>
    <div class="tool-name">${esc(toolName)}</div>
    <pre>${esc(truncate(extra.result, 2000))}</pre>
  `;
}

function renderToolPending(el, toolName, extra) {
  el.innerHTML = `
    <div class="tool-label">Pending Approval</div>
    <div class="tool-name">${esc(toolName)}</div>
    <pre>${esc(JSON.stringify(extra.args, null, 2))}</pre>
    <div class="tool-status" id="status-${esc(extra.pendingId)}">Awaiting your approval...</div>
  `;
}

function renderToolError(el, content, extra) {
  el.innerHTML = `
    <div class="tool-label">Error</div>
    ${extra.tool ? `<div class="tool-name">${esc(extra.tool)}</div>` : ''}
    <pre>${esc(content)}</pre>
  `;
}

function renderBlocked(el, content, extra) {
  el.innerHTML = `
    <div class="tool-label">Blocked — ${esc(extra.stage)}</div>
    ${extra.tool ? `<div class="tool-name">${esc(extra.tool)}</div>` : ''}
    <pre>${esc(content)}</pre>
  `;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function truncate(s, max) {
  if (!s || s.length <= max) return s || '';
  return s.slice(0, max) + '\n... (truncated)';
}

// --- Thinking indicator ---

function showThinking(iteration) {
  let el = document.getElementById('thinking-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'thinking-indicator';
    el.className = 'thinking-indicator';
    dom.messageList.appendChild(el);
  }
  el.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    Thinking${iteration > 1 ? ` (step ${iteration})` : ''}...
  `;
  if (shouldAutoScroll()) scrollToBottom();
}

function hideThinking() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

// --- SSE stream parser ---

function parseSSEEvent(text) {
  let eventType = 'message';
  let data = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  try {
    return { type: eventType, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

async function streamChat(prompt) {
  state.isStreaming = true;
  setStreamingUI(true);

  const abortController = new AbortController();
  state.abortController = abortController;

  let response;
  try {
    response = await fetch(`${API_BASE}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt }),
      signal: abortController.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    appendMessage('system', `Connection error: ${e.message}`);
    state.isStreaming = false;
    setStreamingUI(false);
    return;
  }

  if (!response.ok) {
    if (response.status === 401) {
      appendMessage('system', 'Session expired. Redirecting to login...');
      setTimeout(() => handleLogout(), 1500);
      return;
    }
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    appendMessage('system', `Error: ${err.detail || response.statusText}`);
    state.isStreaming = false;
    setStreamingUI(false);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const eventText of events) {
        if (!eventText.trim()) continue;
        const parsed = parseSSEEvent(eventText);
        if (parsed) handleSSEEvent(parsed);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      appendMessage('system', `Stream error: ${e.message}`);
    }
  } finally {
    hideThinking();
    state.isStreaming = false;
    state.abortController = null;
    setStreamingUI(false);
  }
}

// --- SSE event dispatch ---

const EVENT_HANDLERS = {
  thinking:       (d) => showThinking(d.iteration),
  tool_call:      (d) => { hideThinking(); appendMessage('tool_call', d.tool, { args: d.args }); },
  tool_pending:   (d) => { hideThinking(); handleToolPending(d); },
  tool_result:    (d) => appendMessage('tool_result', d.tool, { result: d.result }),
  tool_confirmed: (d) => handleToolConfirmed(d),
  tool_denied:    (d) => handleToolDenied(d),
  response:       (d) => { hideThinking(); appendMessage('assistant', d.content); },
  error:          (d) => { hideThinking(); appendMessage('tool_error', d.error, { tool: d.tool }); },
  blocked:        (d) => { hideThinking(); appendMessage('blocked', d.reason, { stage: d.stage, tool: d.tool }); },
  eval_retry:     (d) => appendMessage('system', `Retrying ${d.tool}: ${d.reason}`),
};

function handleSSEEvent({ type, data }) {
  const handler = EVENT_HANDLERS[type];
  if (handler) {
    handler(data);
  } else {
    console.warn('Unknown SSE event:', type, data);
  }
}

// --- Gated tool confirmation ---

function handleToolPending(data) {
  const pending = {
    pendingId: data.pending_id,
    tool: data.tool,
    args: data.args,
  };

  state.pendingActions.push(pending);
  appendMessage('tool_pending', data.tool, { args: data.args, pendingId: data.pending_id, id: `pending-${data.pending_id}` });
  showConfirmOverlay(pending);
}

function showConfirmOverlay(pending) {
  dom.confirmToolName.textContent = pending.tool;
  dom.confirmToolArgs.textContent = JSON.stringify(pending.args, null, 2);
  dom.confirmOverlay.classList.remove('hidden');
  dom.confirmOverlay.dataset.pendingId = pending.pendingId;

  const approveBtn = dom.confirmOverlay.querySelector('.btn-approve');
  const denyBtn = dom.confirmOverlay.querySelector('.btn-deny');
  approveBtn.disabled = false;
  denyBtn.disabled = false;
}

function hideConfirmOverlay() {
  dom.confirmOverlay.classList.add('hidden');
}

async function handleApprove() {
  const pendingId = dom.confirmOverlay.dataset.pendingId;
  if (!pendingId) return;

  const btns = dom.confirmOverlay.querySelectorAll('button');
  btns.forEach(b => b.disabled = true);

  try {
    await apiPost(`/agent/confirm/${pendingId}`, { approved: true });
  } catch (e) {
    appendMessage('system', `Confirm error: ${e.message}`);
  }
}

async function handleDeny() {
  const pendingId = dom.confirmOverlay.dataset.pendingId;
  if (!pendingId) return;

  const btns = dom.confirmOverlay.querySelectorAll('button');
  btns.forEach(b => b.disabled = true);

  try {
    await apiPost(`/agent/confirm/${pendingId}`, { approved: false });
  } catch (e) {
    appendMessage('system', `Confirm error: ${e.message}`);
  }
}

function handleToolConfirmed(data) {
  state.pendingActions = state.pendingActions.filter(p => p.pendingId !== data.pending_id);
  hideConfirmOverlay();

  const statusEl = document.getElementById(`status-${data.pending_id}`);
  if (statusEl) {
    statusEl.textContent = 'Approved';
    statusEl.className = 'tool-status approved';
  }

  if (state.pendingActions.length > 0) {
    showConfirmOverlay(state.pendingActions[0]);
  }
}

function handleToolDenied(data) {
  state.pendingActions = state.pendingActions.filter(p => p.pendingId !== data.pending_id);
  hideConfirmOverlay();

  const statusEl = document.getElementById(`status-${data.pending_id}`);
  if (statusEl) {
    statusEl.textContent = 'Denied';
    statusEl.className = 'tool-status denied';
  }

  if (state.pendingActions.length > 0) {
    showConfirmOverlay(state.pendingActions[0]);
  }
}

// --- Chat input handling ---

function setStreamingUI(streaming) {
  dom.sendBtn.disabled = streaming;
  dom.chatInput.disabled = streaming;
  if (!streaming) dom.chatInput.focus();
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleSend() {
  const text = dom.chatInput.value.trim();
  if (!text || state.isStreaming) return;

  dom.chatInput.value = '';
  dom.chatInput.style.height = 'auto';
  appendMessage('user', text);
  streamChat(text);
}

// Auto-resize textarea
function initTextareaResize() {
  dom.chatInput.addEventListener('input', () => {
    dom.chatInput.style.height = 'auto';
    dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 120) + 'px';
  });
}

// --- Log panel ---

const LEVEL_BADGE = {
  DEBUG: 'log-badge-debug',
  INFO:  'log-badge-info',
  WARNING: 'log-badge-warn',
  ERROR: 'log-badge-error',
};

function toggleLogPanel() {
  state.logPanelOpen = !state.logPanelOpen;
  dom.logPanel.classList.toggle('collapsed', !state.logPanelOpen);
  dom.logToggle.classList.toggle('active', state.logPanelOpen);

  if (state.logPanelOpen) {
    state.logUnreadCount = 0;
    dom.logBadge.classList.add('hidden');
    connectLogStream();
  } else {
    disconnectLogStream();
  }
}

function connectLogStream() {
  disconnectLogStream();
  const level = state.logLevelFilter || '';
  const url = `${API_BASE}/logs/stream${level ? '?level=' + level : ''}`;
  const es = new EventSource(url, { withCredentials: true });

  es.addEventListener('log', (e) => {
    try {
      const entry = JSON.parse(e.data);
      appendLogEntry(entry);
    } catch (_) {}
  });

  es.onerror = () => {
    // silent reconnect — EventSource handles it automatically
  };

  state.logEventSource = es;
}

function disconnectLogStream() {
  if (state.logEventSource) {
    state.logEventSource.close();
    state.logEventSource = null;
  }
}

function appendLogEntry(entry) {
  const willScroll = logShouldAutoScroll();

  const row = document.createElement('div');
  row.className = 'log-entry';
  row.onclick = () => row.classList.toggle('expanded');

  const ts = (entry.timestamp || '').split('T')[1] || entry.timestamp || '';
  const timeStr = ts.replace(/\+.*$/, '').slice(0, 12);
  const level = (entry.level || 'INFO').toUpperCase();
  const badgeClass = LEVEL_BADGE[level] || 'log-badge-debug';
  const event = entry.event || '';

  const details = {};
  for (const [k, v] of Object.entries(entry)) {
    if (!['timestamp', 'level', 'logger', 'event', 'log_level'].includes(k) && v !== undefined && v !== null) {
      details[k] = v;
    }
  }

  const hasDetails = Object.keys(details).length > 0;

  row.innerHTML = `
    <span class="log-time">${esc(timeStr)}</span>
    <span class="log-level-badge ${badgeClass}">${esc(level)}</span>
    <span class="log-event">${esc(event)}${hasDetails ? ' ...' : ''}</span>
    ${hasDetails ? `<div class="log-details">${esc(JSON.stringify(details, null, 2))}</div>` : ''}
  `;

  dom.logEntries.appendChild(row);

  // Keep max 500 entries in DOM
  while (dom.logEntries.children.length > 500) {
    dom.logEntries.removeChild(dom.logEntries.firstChild);
  }

  if (!state.logPanelOpen) {
    state.logUnreadCount++;
    dom.logBadge.textContent = state.logUnreadCount > 99 ? '99+' : state.logUnreadCount;
    dom.logBadge.classList.remove('hidden');
  }

  if (willScroll) dom.logEntries.scrollTop = dom.logEntries.scrollHeight;
}

function logShouldAutoScroll() {
  const el = dom.logEntries;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function handleLogLevelChange() {
  state.logLevelFilter = dom.logLevelFilter.value;
  if (state.logPanelOpen) {
    connectLogStream();
  }
}

function clearLogPanel() {
  dom.logEntries.innerHTML = '';
}

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  cacheDOM();
  initTextareaResize();

  try {
    const me = await apiGet('/sessions/me');
    state.userId = me.user_id;
    state.email = me.user_id;
    enterChat();
  } catch {
    showScreen('login');
    dom.emailInput.focus();
  }
});
