const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createConnection } = require("node:net");
const { mkdtemp, readFile, rm, stat } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = join(__dirname, "..");
const { startServer, stopServer, connectCdp, waitFor, evaluate, findChromePath } = require("./browser-helpers");

test("offline server shutdown closes unfinished browser HTTP connections", { timeout: 2000 }, async (context) => {
  const server = await startServer();
  const accepted = once(server, "connection");
  const client = createConnection({ host: "127.0.0.1", port: server.address().port });
  context.after(async () => { client.destroy(); await stopServer(server); });
  await Promise.all([once(client, "connect"), accepted]);
  // Chrome can have a speculative connection or an unfinished request when
  // network emulation switches offline. It will not send the remaining bytes.
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  let connectionError;
  client.on("error", (error) => { connectionError = error; });
  const closed = new Promise((resolve) => client.once("close", resolve));
  await stopServer(server);
  await closed;
  assert.equal(server.listening, false);
  assert.ok(!connectionError || connectionError.code === "ECONNRESET");
});

test("CDP commands time out or reject on disconnect instead of hanging the test", async (context) => {
  const originalWebSocket = global.WebSocket;
  let transport;
  class BrowserTransport extends EventTarget {
    constructor() { super(); transport = this; queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    send(value) { this.lastCommand = JSON.parse(value); }
    close() { this.dispatchEvent(new Event("close")); }
    reply(id) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result: {} }) })); }
  }
  global.WebSocket = BrowserTransport;
  context.after(() => { global.WebSocket = originalWebSocket; });
  const browser = await connectCdp("ws://test.invalid", { timeoutMs: 40 });
  await assert.rejects(browser.send("Runtime.evaluate", { expression: "new Promise(() => {})" }), { code: "CDP_TIMEOUT" });
  assert.doesNotThrow(() => transport.reply(transport.lastCommand.id), "late responses to timed-out commands must be ignored");
  const pending = browser.send("Page.reload");
  browser.close();
  await assert.rejects(pending, /CDP connection closed/);
});

test("auth startup and foreground recovery cannot overwrite a newer session or active editor", async (context) => {
  const chromePath = await findChromePath();
  if (!chromePath) return context.skip("Set CHROME_PATH to run browser coverage");
  const server = await startServer();
  const appUrl = `http://127.0.0.1:${server.address().port}/`;
  const profile = await mkdtemp(join(tmpdir(), "ledgerly-auth-lifecycle-"));
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  context.after(async () => {
    chrome.kill();
    await stopServer(server);
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1500))]);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  });
  let logs = "";
  chrome.stderr.on("data", (chunk) => { logs += chunk; });
  const socket = await waitFor(() => logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 15000);
  const targets = await (await fetch(`http://127.0.0.1:${new URL(socket).port}/json/list`)).json();
  const page = await connectCdp(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  context.after(() => page.close());
  await page.send("Page.enable");
  const backendMock = await readFile(join(ROOT, "tests", "browser-backend-mock.js"), "utf8");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `${backendMock}
    window.__lifecycleDocument = location.search;
    const originalFactory = window.__INVOICE_STUDIO_BACKEND_FACTORY__;
    window.__INVOICE_STUDIO_BACKEND_FACTORY__ = () => {
      const backend = originalFactory();
      const getSession = backend.getSession;
      let initial = true;
      backend.getSession = () => {
        if (!initial) return getSession();
        initial = false;
        return new Promise((resolve, reject) => {
          window.__resolveStartup = resolve;
          window.__rejectStartup = () => reject(new Error('Stale startup failure'));
        });
      };
      return backend;
    };` });
  const read = (script) => evaluate(page, script);
  const until = (script) => waitFor(() => read(script));
  for (const outcome of ["null", "error", "stale-user"]) {
    await page.send("Page.navigate", { url: `${appUrl}?lifecycle=${outcome}` });
    await until(`window.__lifecycleDocument === '?lifecycle=${outcome}' && typeof window.__resolveStartup === 'function'`);
    await read("window.invoiceBackend.signIn('current-owner@example.test')");
    await until("document.body.dataset.page === 'history' && !document.querySelector('#invoiceListPage').hidden");
    if (outcome === "stale-user") await read("window.invoiceBackend.signOut()");
    const release = outcome === "error" ? "window.__rejectStartup()"
      : outcome === "null" ? "window.__resolveStartup(null)"
        : "window.__resolveStartup({ user: { id: 'obsolete-user', email: 'obsolete@example.test' } })";
    await read(`${release}; new Promise(resolve => setTimeout(resolve, 0))`);
    assert.equal(await read("document.body.dataset.page"), outcome === "stale-user" ? "auth" : "history", `${outcome} startup result must not override the later auth event`);
  }

  for (const event of ["pageshow", "visibilitychange"]) {
    await read("window.invoiceBackend.signOut()");
    await read(`window.invoiceBackend.getSession = async () => ({ user: { id: 'restored-user', email: 'restored@example.test' } });
      ${event === "pageshow" ? "window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))" : "document.dispatchEvent(new Event('visibilitychange'))"}; true`);
    await until("document.body.dataset.page === 'history'");
    assert.equal(await read("document.querySelector('#accountEmail').textContent"), "restored@example.test", `${event} must recover a positive persisted session`);
  }

  await read("document.querySelector('#historyNewInvoiceButton').click(); true");
  await until("document.body.dataset.page === 'editor'");
  const editorState = JSON.parse(await read(`(() => {
    const customer = document.querySelector('#billTo');
    customer.value = 'IN-PROGRESS EDIT';
    customer.dispatchEvent(new Event('input', { bubbles: true }));
    window.__resumeReads = 0;
    window.invoiceBackend.getSession = async () => { window.__resumeReads += 1; return null; };
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
    return JSON.stringify({ page: document.body.dataset.page, customer: customer.value, reads: window.__resumeReads });
  })()`));
  assert.deepEqual(editorState, { page: "editor", customer: "IN-PROGRESS EDIT", reads: 0 });

  for (const replacement of ["sign-out", "new-account"]) {
    await read("window.invoiceBackend.signOut()");
    await read("window.invoiceBackend.getSession = () => new Promise(resolve => { window.__resolveResume = resolve; }); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); true");
    await until("typeof window.__resolveResume === 'function'");
    if (replacement === "sign-out") await read("window.invoiceBackend.signOut()");
    else {
      await read("window.invoiceBackend.signIn('new-account@example.test')");
      await until("document.body.dataset.page === 'history'");
    }
    await read("window.__resolveResume({ user: { id: 'obsolete-user', email: 'obsolete@example.test' } }); delete window.__resolveResume; new Promise(resolve => setTimeout(resolve, 0))");
    assert.equal(await read("document.body.dataset.page"), replacement === "sign-out" ? "auth" : "history");
    assert.equal(await read("document.querySelector('#accountEmail').textContent"), replacement === "sign-out" ? "" : "new-account@example.test", `a pending foreground read must not undo ${replacement}`);
  }
  await read("window.invoiceBackend.signOut()");
  await until("document.body.dataset.page === 'auth'");
  await read(`window.__oauthAlive = true; window.__updateRequests = 0;
    offerServiceWorkerUpdate({ postMessage() { window.__updateRequests++; } });
    window.invoiceBackend.signInWithGoogle = () => new Promise(resolve => { window.__finishGoogle = () => resolve({session: null}); });
    document.querySelector('#googleSignInButton').click(); true`);
  assert.equal(await read("document.querySelector('#updateButton').disabled"), true, "updates must not interrupt Google sign-in");
  await read("document.querySelector('#updateButton').click(); navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); new Promise(resolve => setTimeout(resolve, 200))");
  assert.equal(await read("window.__oauthAlive === true && window.__updateRequests === 0"), true, "an update activated by another tab must not reload the OAuth opener");
  await read("window.__finishGoogle(); new Promise(resolve => setTimeout(resolve, 0))");
  assert.equal(await read("document.querySelector('#updateButton').disabled"), false);
});

test("Safari auth startup works with Firebase login helper domains blocked", async (context) => {
  const chromePath = await findChromePath();
  if (!chromePath) return context.skip("Set CHROME_PATH to run browser coverage");
  const server = await startServer({ firebaseConfig: {
    apiKey: "fake-bootstrap-key", projectId: "demo-ledgerly", appId: "bootstrap-test",
    authDomain: "demo-ledgerly.firebaseapp.com", googleClientId: "test-client",
  } });
  const profile = await mkdtemp(join(tmpdir(), "ledgerly-safari-bootstrap-"));
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  context.after(async () => {
    chrome.kill(); await stopServer(server);
    await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 1500))]);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  });
  let logs = "";
  chrome.stderr.on("data", chunk => { logs += chunk; });
  const socket = await waitFor(() => logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 15000);
  const targets = await (await fetch(`http://127.0.0.1:${new URL(socket).port}/json/list`)).json();
  const page = await connectCdp(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  context.after(() => page.close());
  await page.send("Network.enable");
  await page.send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  await page.send("Network.setBlockedURLs", { urls: ["*firebaseapp.com/*", "*apis.google.com/*", "*accounts.google.com/*"] });
  const helperRequests = [];
  page.on("Network.requestWillBeSent", event => {
    if (/firebaseapp\.com|apis\.google\.com/.test(event.request.url)) helperRequests.push(event.request.url);
  });
  await page.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  await waitFor(() => evaluate(page, "Boolean(window.invoiceBackend) && document.querySelector('#appLoadingScreen').hidden"));
  assert.equal(await evaluate(page, "window.invoiceBackend.getSession()"), null);
  assert.equal(await evaluate(page, "document.querySelector('#authPage').hidden"), false);
  assert.deepEqual(helperRequests, [], "direct Google sign-in must never bootstrap Firebase's popup helper");
  await evaluate(page, "document.querySelector('#googleSignInButton').click(); true");
  await waitFor(() => evaluate(page, "!document.querySelector('#googleSignInButton').disabled"));
  assert.match(await evaluate(page, "document.querySelector('#authMessage').textContent"), /Google sign-in could not load/);
});

test("guest entry, invoice editor, responsive layout, draft, print, and offline shell", async (context) => {
  const chromePath = await findChromePath();
  if (!chromePath) return context.skip("Set CHROME_PATH to run browser coverage");

  const server = await startServer();
  const address = server.address();
  const appUrl = `http://127.0.0.1:${address.port}/`;
  const profile = await mkdtemp(join(tmpdir(), "invoice-studio-test-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    appUrl,
  ], { stdio: ["ignore", "ignore", "pipe"] });

  context.after(async () => {
    chrome.kill();
    await stopServer(server);
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  });

  let debugOutput = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { debugOutput += chunk; });
  const browserSocket = await waitFor(
    () => debugOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],
    15000,
  );
  const browser = await connectCdp(browserSocket);
  context.after(() => browser.close());

  const targets = await browser.send("Target.getTargets");
  const target = await waitFor(() => targets.targetInfos.find((candidate) => candidate.type === "page" && candidate.url === appUrl));
  const response = await fetch(`http://127.0.0.1:${new URL(browserSocket).port}/json/list`);
  const pages = await response.json();
  const page = await connectCdp(pages.find((candidate) => candidate.id === target.targetId).webSocketDebuggerUrl);
  context.after(() => page.close());
  const runtimeExceptions = [];
  const browserErrors = [];
  page.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    runtimeExceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown runtime exception");
  });
  page.on("Log.entryAdded", ({ entry }) => {
    if (["error", "warning"].includes(entry?.level)) browserErrors.push(`${entry.source}: ${entry.text}`);
  });
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Page.enable");
  await waitFor(() => evaluate(page, "document.readyState === 'complete' && document.body.dataset.page === 'history'"), 8000);
  const guestState = JSON.parse(await evaluate(page, `JSON.stringify({
    guestMode: window.invoiceBackend.guestMode,
    authHidden: document.querySelector('#authPage').hidden,
    historyVisible: !document.querySelector('#invoiceListPage').hidden,
    accountLabel: document.querySelector('#accountEmail').textContent,
    signOutHidden: document.querySelector('#signOutButton').hidden,
    syncStatus: document.querySelector('#syncStatus').textContent,
    storageNote: document.querySelector('.history-storage-note').textContent,
    brandName: document.querySelector('.brand-name').textContent,
    headerLogo: document.querySelector('.brand-lockup img').getAttribute('src'),
    invoiceLogo: document.querySelector('.invoice-logo').getAttribute('src'),
    title: document.title
  })`));
  assert.deepEqual(guestState, {
    guestMode: true,
    authHidden: true,
    historyVisible: true,
    accountLabel: "This device",
    signOutHidden: true,
    syncStatus: "Saved locally",
    storageNote: "Invoices and drafts exist only in this browser profile. Clearing site data, using private browsing, or changing devices can remove access. Download a backup regularly.",
    brandName: "Quotini",
    headerLogo: "./ledgerly-mark.png?v=79",
    invoiceLogo: "./eng-hoon-residences-logo.png?v=79",
    title: "Invoices | Quotini",
  });

  await evaluate(page, "localStorage.setItem('invoice-studio-history-v1', '{broken-json'); location.reload(); true");
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'recovery' && !document.querySelector('#storageRecoveryPage').hidden"));
  const recoveryState = JSON.parse(await evaluate(page, `JSON.stringify({
    authHidden: document.querySelector('#authPage').hidden,
    historyHidden: document.querySelector('#invoiceListPage').hidden,
    title: document.querySelector('#storageRecoveryTitle').textContent,
    detail: document.querySelector('#storageRecoveryDetail').textContent,
    rawBackup: window.invoiceBackend.exportLocalData().history.unreadableRawValue,
    actions: document.querySelectorAll('.storage-recovery-actions button').length
  })`));
  assert.deepEqual(recoveryState, {
    authHidden: true,
    historyHidden: true,
    title: "Your invoices have not been changed",
    detail: "Affected storage area: invoice-studio-history-v1",
    rawBackup: "{broken-json",
    actions: 4,
  });
  await evaluate(page, "window.confirm = () => true; document.querySelector('#recoveryClearButton').click(); true");
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && !document.querySelector('#invoiceListPage').hidden"));

  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(page, "document.querySelector('#historyNewInvoiceButton').click(); true");
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'editor' && /^EHR-\\d{8}-001$/.test(document.querySelector('#invoiceNumber').value)"));
  const localSource = JSON.parse(await evaluate(page, `(() => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue('#billTo', 'Local Browser Customer');
    setValue('[data-item-field="description"]', 'MixedCase café 東京');
    setValue('[data-item-field="quantity"]', '2');
    setValue('[data-item-field="price"]', '19.95');
    return JSON.stringify({
      number: document.querySelector('#invoiceNumber').value,
      pdfFileName: document.querySelector('#pdfFileName').value
    });
  })()`));
  await evaluate(page, "document.querySelector('#printButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelector('#outputDialog').open"));
  await evaluate(page, "document.querySelector('#cancelOutputDialogButton').click(); document.querySelector('#invoiceListButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelectorAll('.invoice-record').length === 1"));
  const savedItemCase = await evaluate(page, "JSON.parse(localStorage.getItem('invoice-studio-history-v1'))[0].invoice.items[0].description");

  await evaluate(page, "document.querySelector('[data-duplicate-invoice]').click(); true");
  await waitFor(() => evaluate(page, "document.querySelector('#editorTitle').textContent === 'Review duplicated invoice'"));
  const duplicated = JSON.parse(await evaluate(page, `JSON.stringify({
      number: document.querySelector('#invoiceNumber').value,
      pdfFileName: document.querySelector('#pdfFileName').value,
      item: document.querySelector('[data-item-field="description"]').value
    })`));
  await evaluate(page, "document.querySelector('#printButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelector('#outputDialog').open"));
  await evaluate(page, "document.querySelector('#cancelOutputDialogButton').click(); document.querySelector('#invoiceListButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelectorAll('.invoice-record').length === 2"));

  await evaluate(page, "window.confirm = () => true; document.querySelector('[data-delete-invoice]').click(); true");
  await waitFor(() => evaluate(page, "document.querySelectorAll('.invoice-record').length === 1"));
  const localProductionFlow = JSON.parse(await evaluate(page, `(async () => {
    const backup = window.invoiceBackend.exportLocalData();
    window.invoiceBackend.clearLocalData();
    const clearedTotal = (await window.invoiceBackend.listInvoices('local-device')).total;
    window.invoiceBackend.restoreLocalData(backup);
    const restored = await window.invoiceBackend.listInvoices('local-device');
    return JSON.stringify({
      clearedTotal,
      restoredTotal: restored.total,
      restoredItemCase: restored.records[0].invoice.items[0].description,
      backupHasDraft: backup.draft !== null,
      nextNumberAfterDelete: document.querySelector('#invoiceNumber').value
    });
  })()`));
  assert.match(localSource.number, /^EHR-\d{8}-\d{3}$/);
  assert.equal(localSource.pdfFileName, localSource.number);
  assert.equal(savedItemCase, "MixedCase café 東京");
  assert.deepEqual(duplicated, {
    number: localSource.number,
    pdfFileName: localSource.number,
    item: "MixedCase café 東京",
  });
  assert.equal(localProductionFlow.clearedTotal, 0);
  assert.equal(localProductionFlow.restoredTotal, 1);
  assert.equal(localProductionFlow.restoredItemCase, "MixedCase café 東京");
  assert.equal(localProductionFlow.backupHasDraft, false);
  assert.match(localProductionFlow.nextNumberAfterDelete, /^EHR-\d{8}-002$/);
  await page.send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && document.querySelectorAll('.invoice-record').length === 1"));

  const backendMock = await readFile(join(ROOT, "tests", "browser-backend-mock.js"), "utf8");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: backendMock });
  await evaluate(page, "localStorage.clear(); true");
  await page.send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate(page, "document.readyState === 'complete' && document.body.dataset.page === 'history' && document.querySelectorAll('.item-row').length === 1"), 8000);

  await evaluate(page, "localStorage.clear(); location.reload(); true");
  await waitFor(() => evaluate(page, "document.readyState === 'complete' && document.body.dataset.page === 'history' && document.querySelectorAll('.item-row').length === 1"), 8000);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const landingState = JSON.parse(await evaluate(page, `JSON.stringify({
    page: document.body.dataset.page,
    historyVisible: !document.querySelector('#invoiceListPage').hidden,
    editorHidden: document.querySelector('#editorPage').hidden,
    emptyState: !document.querySelector('#historyEmptyState').hidden,
    count: document.querySelector('#invoiceCount').textContent,
    createActions: ['newInvoiceButton', 'historyNewInvoiceButton', 'emptyStateNewInvoiceButton']
      .filter(id => document.getElementById(id).getClientRects().length > 0).length
  })`));
  assert.deepEqual(landingState, { page: "history", historyVisible: true, editorHidden: true, emptyState: true, count: "0 invoices", createActions: 2 });
  for (const width of [320, 390, 700, 1000, 1440]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    const historyLayout = JSON.parse(await evaluate(page, `JSON.stringify({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      page: (() => { const rect = document.querySelector('#invoiceListPage').getBoundingClientRect(); return { left: rect.left, right: rect.right }; })(),
      empty: (() => { const rect = document.querySelector('#historyEmptyState').getBoundingClientRect(); return { left: rect.left, right: rect.right }; })()
    })`));
    assert.ok(historyLayout.documentWidth <= historyLayout.viewport, `${width}px history must not overflow`);
    assert.ok(historyLayout.page.left >= 0 && historyLayout.page.right <= historyLayout.viewport, `${width}px history page bounds`);
    assert.ok(historyLayout.empty.left >= 0 && historyLayout.empty.right <= historyLayout.viewport, `${width}px empty state bounds`);
  }
  await evaluate(page, "document.querySelector('#historyNewInvoiceButton').click(); true");
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'editor' && !document.querySelector('#editorPage').hidden"));
  const backNavigation = JSON.parse(await evaluate(page, `JSON.stringify({
    label: document.querySelector('#invoiceListButton').textContent,
    afterInstall: Boolean(document.querySelector('#installButton').compareDocumentPosition(document.querySelector('#invoiceListButton')) & Node.DOCUMENT_POSITION_FOLLOWING)
  })`));
  assert.deepEqual(backNavigation, { label: "Invoices", afterInstall: true });
  const cleanDraft = await evaluate(page, `JSON.stringify({
    invoiceNumber: document.querySelector('#invoiceNumber').value,
    pdfFileName: document.querySelector('#pdfFileName').value,
    invoiceDate: document.querySelector('#invoiceDate').value,
    dueDate: document.querySelector('#dueDate').value,
    today: (() => { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); })(),
    billTo: document.querySelector('#billTo').value,
    description: document.querySelector('[data-item-field="description"]').value,
    price: document.querySelector('[data-item-field="price"]').value
  })`);
  const initial = JSON.parse(cleanDraft);
  assert.match(initial.invoiceNumber, /^EHR-\d{8}-001$/);
  assert.equal(initial.pdfFileName, initial.invoiceNumber);
  assert.deepEqual(JSON.parse(await evaluate(page, `JSON.stringify({
    checked: document.querySelector('#customizePdfFileName').checked,
    readOnly: document.querySelector('#pdfFileName').readOnly,
    ariaReadOnly: document.querySelector('#pdfFileName').getAttribute('aria-readonly')
  })`)), { checked: false, readOnly: true, ariaReadOnly: "true" });
  assert.match(initial.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(initial.invoiceDate, initial.today);
  assert.match(initial.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual({ billTo: initial.billTo, description: initial.description, price: initial.price }, { billTo: "", description: "", price: "" });

  await evaluate(page, `(() => {
    localStorage.setItem('test-remote-draft', JSON.stringify({
      revision: 1,
      invoice: {
        draftDirty: false,
        invoiceNumber: 'EHR-20000101-001',
        pdfFileName: 'EHR-20000101-001',
        pdfFileNameCustomized: false,
        invoiceDate: '2000-01-01',
        dueDate: '2000-01-08',
        billTo: '',
        items: [{ id: 'stale-blank-item', quantity: 1, description: '', price: '' }]
      }
    }));
    location.reload();
  })()`);
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history'"));
  await evaluate(page, "document.querySelector('#historyNewInvoiceButton').click(); true");
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'editor' && document.querySelector('#invoiceDate').value !== '2000-01-01'"));
  const refreshedBlankDraft = JSON.parse(await evaluate(page, `JSON.stringify({
    invoiceNumber: document.querySelector('#invoiceNumber').value,
    invoiceDate: document.querySelector('#invoiceDate').value,
    today: (() => { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); })()
  })`));
  assert.equal(refreshedBlankDraft.invoiceDate, refreshedBlankDraft.today);
  assert.notEqual(refreshedBlankDraft.invoiceNumber, "EHR-20000101-001");

  const semantics = JSON.parse(await evaluate(page, `JSON.stringify({
    legends: [...document.querySelectorAll('fieldset')].map(fieldset => ({
      direct: [...fieldset.children].filter(child => child.tagName === 'LEGEND').length,
      first: fieldset.firstElementChild?.tagName,
      text: fieldset.querySelector(':scope > legend')?.textContent.trim(),
      plain: [...fieldset.querySelector(':scope > legend')?.childNodes || []].every(node => node.nodeType === Node.TEXT_NODE)
    })),
    productsName: document.querySelector('.items-section > legend')?.textContent,
    itemColumns: [...document.querySelectorAll('.item-column-labels span')].map(label => label.textContent),
    detachedCurrencyLabels: document.querySelectorAll('.currency-label').length,
    addHelp: document.querySelector('#addItemButton').getAttribute('aria-describedby'),
    addHelpText: document.querySelector('#itemLimitHelp').textContent,
    totalAtomic: document.querySelector('.editor-total').getAttribute('aria-atomic'),
    placeholders: document.querySelectorAll('[placeholder]').length
  })`));
  assert.ok(semantics.legends.every((legend) => legend.direct === 1 && legend.first === "LEGEND" && legend.plain));
  assert.equal(semantics.productsName, "Products / services");
  assert.deepEqual(semantics.itemColumns, ["Qty", "Item", "Unit price (SGD)", ""]);
  assert.equal(semantics.detachedCurrencyLabels, 0);
  assert.equal(semantics.addHelp, "itemLimitHelp");
  assert.match(semantics.addHelpText, /up to 5 items/i);
  assert.equal(semantics.totalAtomic, "true");
  assert.equal(semantics.placeholders, 0);

  const negativePriceTotals = JSON.parse(await evaluate(page, `(() => {
    const setValue = (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const firstRow = document.querySelector('.item-row');
    setValue(firstRow.querySelector('[data-item-field="quantity"]'), '2');
    setValue(firstRow.querySelector('[data-item-field="description"]'), 'Service');
    setValue(firstRow.querySelector('[data-item-field="price"]'), '100');
    document.querySelector('#addItemButton').click();
    const totalAfterAddingItem = document.querySelector('#editorTotal').textContent;
    const previewAfterAddingItem = document.querySelector('#previewTotal').textContent;
    const secondRow = document.querySelectorAll('.item-row')[1];
    setValue(secondRow.querySelector('[data-item-field="quantity"]'), '1');
    setValue(secondRow.querySelector('[data-item-field="description"]'), 'Discount');
    const negativePrice = secondRow.querySelector('[data-item-field="price"]');
    setValue(negativePrice, '-25.50');
    const result = {
      min: negativePrice.min,
      valid: negativePrice.validity.valid,
      help: document.querySelector('#itemPriceHelp').textContent,
      totalAfterAddingItem,
      previewAfterAddingItem,
      lineAmounts: [...document.querySelectorAll('#previewItems .amount-value')].map((amount) => amount.textContent),
      previewTotal: document.querySelector('#previewTotal').textContent,
      editorTotal: document.querySelector('#editorTotal').textContent,
    };
    document.querySelectorAll('.remove-item')[1].click();
    const resetRow = document.querySelector('.item-row');
    setValue(resetRow.querySelector('[data-item-field="quantity"]'), '1');
    setValue(resetRow.querySelector('[data-item-field="description"]'), '');
    setValue(resetRow.querySelector('[data-item-field="price"]'), '');
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(negativePriceTotals, {
    min: "-999999999.99",
    valid: true,
    help: "Use a negative unit price for a discount or credit. It will be subtracted from the total.",
    totalAfterAddingItem: "$200.00",
    previewAfterAddingItem: "200.00",
    lineAmounts: ["200.00", "-25.50"],
    previewTotal: "174.50",
    editorTotal: "$174.50",
  });

  const invoiceAlignment = JSON.parse(await evaluate(page, `(() => {
    const topSymbol = document.querySelector('#previewItems .amount-symbol').getBoundingClientRect();
    const totalSymbol = document.querySelector('.invoice-table tfoot td:first-of-type').getBoundingClientRect();
    const topValue = document.querySelector('#previewItems .amount-value').getBoundingClientRect();
    const totalValue = document.querySelector('#previewTotal').getBoundingClientRect();
    const totalLabel = document.querySelector('.invoice-table tfoot th').getBoundingClientRect();
    const logo = document.querySelector('.invoice-logo').getBoundingClientRect();
    const table = document.querySelector('.invoice-table').getBoundingClientRect();
    return JSON.stringify({
      symbolCenterDifference: Math.abs((topSymbol.left + topSymbol.width / 2) - (totalSymbol.left + totalSymbol.width / 2)),
      valueRightDifference: Math.abs(topValue.right - totalValue.right),
      totalLabelGap: totalSymbol.left - totalLabel.right,
      logoRightDifference: Math.abs(logo.right - table.right)
    });
  })()`));
  assert.ok(invoiceAlignment.symbolCenterDifference < 0.5);
  assert.ok(invoiceAlignment.valueRightDifference < 0.5);
  assert.ok(invoiceAlignment.totalLabelGap < 0.5);
  assert.ok(invoiceAlignment.logoRightDifference < 0.5);

  const filenameBehavior = JSON.parse(await evaluate(page, `(() => {
    const number = document.querySelector('#invoiceNumber');
    const filename = document.querySelector('#pdfFileName');
    const toggle = document.querySelector('#customizePdfFileName');
    const initiallyLocked = filename.readOnly;
    number.value = 'inv-sync-1'; number.dispatchEvent(new Event('input', { bubbles: true }));
    const synced = filename.value;
    toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const editable = !filename.readOnly;
    filename.value = 'Client custom'; filename.dispatchEvent(new Event('input', { bubbles: true }));
    number.value = 'inv-sync-2'; number.dispatchEvent(new Event('input', { bubbles: true }));
    const customized = filename.value;
    toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const lockedReset = filename.value;
    const locked = filename.readOnly;
    toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    filename.value = 'Client custom'; filename.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ number: number.value, synced, customized, initiallyLocked, editable, lockedReset, locked, checked: toggle.checked, help: document.querySelector('#pdfFileNameHelp').textContent, autocapitalize: number.autocapitalize, spellcheck: number.spellcheck });
  })()`));
  assert.deepEqual(filenameBehavior, {
    number: "INV-SYNC-2",
    synced: "INV-SYNC-1",
    customized: "Client custom",
    initiallyLocked: true,
    editable: true,
    lockedReset: "INV-SYNC-2",
    locked: true,
    checked: true,
    help: "Custom file name used when you choose Save as PDF. The .pdf extension is added automatically.",
    autocapitalize: "characters",
    spellcheck: false,
  });

  const uppercaseName = JSON.parse(await evaluate(page, `(() => {
    const customer = document.querySelector('#billTo');
    customer.value = 'Hanoa (@hanoa_sg)';
    customer.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({
      field: customer.value,
      preview: document.querySelector('#previewBillTo').textContent,
      autocapitalize: customer.autocapitalize,
      spellcheck: customer.spellcheck
    });
  })()`));
  assert.deepEqual(uppercaseName, {
    field: "HANOA (@HANOA_SG)",
    preview: "HANOA (@HANOA_SG)",
    autocapitalize: "characters",
    spellcheck: false,
  });

  for (const width of [320, 375, 390, 700, 701, 768, 844, 932, 960, 1024, 1080, 1081, 1200, 1201, 1280, 1440]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const layout = await evaluate(page, `JSON.stringify({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      button: (() => { const r = document.querySelector('.remove-item').getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; })(),
      label: document.querySelector('.remove-item').getAttribute('aria-label'),
      workspaceColumns: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ').length,
      editorWidth: document.querySelector('.editor-panel').getBoundingClientRect().width,
      headingDirection: getComputedStyle(document.querySelector('.panel-heading')).flexDirection,
      headingGap: parseFloat(getComputedStyle(document.querySelector('.panel-heading')).rowGap),
      previewJumpVisible: getComputedStyle(document.querySelector('#mobileViewPreviewButton')).display !== 'none',
      mobileActionsVisible: getComputedStyle(document.querySelector('.mobile-output-action')).display !== 'none',
      headerSaveVisible: document.querySelector('#printButton').getClientRects().length > 0,
      filenameControl: (() => {
        const section = document.querySelector('#pdfFileName').closest('.form-section').getBoundingClientRect();
        const field = document.querySelector('#pdfFileName').getBoundingClientRect();
        const toggleLabel = document.querySelector('.checkbox-control').getBoundingClientRect();
        return {
          fieldLeft: field.left,
          fieldRight: field.right,
          sectionLeft: section.left,
          sectionRight: section.right,
          toggleLeft: toggleLabel.left,
          toggleRight: toggleLabel.right,
          toggleHeight: toggleLabel.height
        };
      })(),
      mobileLabels: [...document.querySelectorAll('.mobile-field-label')].map(label => ({
        text: label.textContent,
        visible: getComputedStyle(label).display !== 'none',
        target: document.getElementById(label.htmlFor)?.dataset.itemField
      })),
      mobileItemGeometry: (() => {
        const fields = [...document.querySelectorAll('.item-row .mobile-field')].map(field => field.getBoundingClientRect());
        const removeButton = document.querySelector('.remove-item');
        const remove = removeButton.getBoundingClientRect();
        return { quantityTop: fields[0].top, descriptionTop: fields[1].top, priceTop: fields[2].top, removeTop: remove.top, removeVisible: removeButton.getClientRects().length > 0 };
      })(),
      columnLabelGeometry: (() => {
        const labels = document.querySelector('.item-column-labels');
        const rect = labels.getBoundingClientRect();
        const section = document.querySelector('.items-section').getBoundingClientRect();
        const labelLefts = [...labels.children].map(label => label.getBoundingClientRect().left);
        const fieldLefts = [...document.querySelectorAll('.item-row > *')].map(field => field.getBoundingClientRect().left);
        return { width: rect.width, left: rect.left, right: rect.right, sectionLeft: section.left, sectionRight: section.right, labelLefts, fieldLefts };
      })(),
      itemInside: (() => {
        const section = document.querySelector('.items-section').getBoundingClientRect();
        return [...document.querySelectorAll('.item-row')].every(row => {
          const rect = row.getBoundingClientRect();
          return rect.left >= section.left - 1 && rect.right <= section.right + 1;
        });
      })(),
      itemFieldsInside: (() => {
        const section = document.querySelector('.items-section').getBoundingClientRect();
        return [...document.querySelectorAll('.item-row .mobile-field, .item-row input, .item-row textarea')].every(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.left >= section.left - 1 && rect.right <= section.right + 1;
        });
      })()
    })`);
    const measured = JSON.parse(layout);
    assert.ok(measured.documentWidth <= measured.viewport, `${width}px layout must not overflow`);
    if (measured.button.width > 0) assert.ok(measured.button.left >= 0 && measured.button.right <= measured.viewport && measured.button.width <= 44.1);
    assert.equal(measured.label, "Remove item 1");
    assert.equal(measured.workspaceColumns, width <= 1359 ? 1 : 2, `${width}px workspace column count`);
    assert.equal(measured.previewJumpVisible, width <= 1359, `${width}px preview jump visibility`);
    assert.equal(measured.mobileActionsVisible, width <= 767, `${width}px mobile output visibility`);
    assert.equal(measured.headerSaveVisible, width > 767, `${width}px header save visibility`);
    assert.equal(measured.mobileActionsVisible || measured.headerSaveVisible, true, `${width}px must expose a visible Save invoice action`);
    assert.ok(measured.filenameControl.fieldLeft >= measured.filenameControl.sectionLeft - 1);
    assert.ok(measured.filenameControl.fieldRight <= measured.filenameControl.sectionRight + 1);
    assert.ok(measured.filenameControl.toggleLeft >= measured.filenameControl.sectionLeft - 1);
    assert.ok(measured.filenameControl.toggleRight <= measured.filenameControl.sectionRight + 1);
    assert.ok(measured.filenameControl.toggleHeight >= 44);
    if (width <= 1359) {
      assert.ok(measured.editorWidth <= 720.1, `${width}px editor should remain constrained`);
      assert.equal(measured.headingDirection, "column", `${width}px save status should group with heading`);
      assert.ok(measured.headingGap <= 8.1, `${width}px heading/save gap should remain close`);
    } else {
      assert.ok(measured.editorWidth >= 460, `${width}px split editor should remain usable`);
    }
    assert.equal(measured.itemInside, true, `${width}px item row must remain inside its section`);
    assert.equal(measured.itemFieldsInside, true, `${width}px quantity, description, and price fields must remain visible inside their section`);
    assert.deepEqual(measured.mobileLabels.map((label) => label.text), ["Quantity", "Item 1", "Unit price (SGD)"]);
    assert.ok(measured.mobileLabels.every((label) => label.target));
    assert.ok(measured.mobileLabels.every((label) => label.visible === (width <= 700)));
    if (width <= 700) {
      assert.ok(Math.abs(measured.mobileItemGeometry.quantityTop - measured.mobileItemGeometry.priceTop) < 1);
      assert.ok(measured.mobileItemGeometry.descriptionTop > measured.mobileItemGeometry.quantityTop);
      assert.equal(measured.mobileItemGeometry.removeVisible, false);
    } else {
      assert.ok(measured.columnLabelGeometry.width > 0, `${width}px item column labels need usable width`);
      assert.ok(measured.columnLabelGeometry.left >= measured.columnLabelGeometry.sectionLeft - 1);
      assert.ok(measured.columnLabelGeometry.right <= measured.columnLabelGeometry.sectionRight + 1);
      measured.columnLabelGeometry.labelLefts.forEach((left, index) => {
        assert.ok(Math.abs(left - measured.columnLabelGeometry.fieldLefts[index]) < 1, `${width}px item label ${index + 1} alignment`);
      });
    }
  }

  await evaluate(page, "window.scrollTo(0, 0); true");
  const desktopToolbarAlignment = JSON.parse(await evaluate(page, `(() => {
    const zoom = document.querySelector('.preview-zoom-controls').getBoundingClientRect();
    const save = document.querySelector('#printButton').getBoundingClientRect();
    return JSON.stringify({
      zoomCenter: zoom.top + zoom.height / 2,
      saveCenter: save.top + save.height / 2
    });
  })()`));
  assert.ok(
    Math.abs(desktopToolbarAlignment.zoomCenter - desktopToolbarAlignment.saveCenter) < 1,
    `desktop toolbar centers must align: ${JSON.stringify(desktopToolbarAlignment)}`,
  );

  await page.send("Emulation.setDeviceMetricsOverride", { width: 701, height: 900, deviceScaleFactor: 1, mobile: false });
  const narrowHeader = JSON.parse(await evaluate(page, `(() => {
    const install = document.querySelector('#installButton');
    install.hidden = false;
    const header = document.querySelector('.app-header');
    const mark = document.querySelector('.brand-lockup img').getBoundingClientRect();
    const name = document.querySelector('.brand-name').getBoundingClientRect();
    const result = {
      fits: header.scrollWidth <= header.clientWidth,
      height: header.getBoundingClientRect().height,
      subtitlePresent: Boolean(document.querySelector('.brand-subtitle')),
      wordCentered: Math.abs((mark.top + mark.height / 2) - (name.top + name.height / 2)) < 1,
      desktopSaveVisible: document.querySelector('#printButton').getClientRects().length > 0,
      mobileSaveVisible: document.querySelector('#mobilePrintButton').getClientRects().length > 0
    };
    install.hidden = true;
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(narrowHeader, { fits: true, height: 66, subtitlePresent: false, wordCentered: true, desktopSaveVisible: false, mobileSaveVisible: true });

  await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  const mobileDateFields = JSON.parse(await evaluate(page, `(() => {
    const section = document.querySelector('#invoiceDate').closest('.form-section').getBoundingClientRect();
    const fields = ['invoiceDate', 'dueDate'].map(id => {
      const input = document.querySelector('#' + id);
      const rect = input.getBoundingClientRect();
      return {
        minWidth: getComputedStyle(input).minWidth,
        insideSection: rect.left >= section.left && rect.right <= section.right
      };
    });
    return JSON.stringify({ fields, documentFits: document.documentElement.scrollWidth <= innerWidth });
  })()`));
  assert.deepEqual(mobileDateFields, {
    fields: [
      { minWidth: "0px", insideSection: true },
      { minWidth: "0px", insideSection: true },
    ],
    documentFits: true,
  });
  const previewClickStart = JSON.parse(await evaluate(page, `(() => {
    const button = document.querySelector('#mobileViewPreviewButton');
    button.scrollIntoView({ block: 'center' });
    window.__prints = 0;
    window.print = () => { window.__prints += 1; };
    const rect = button.getBoundingClientRect();
    return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, scrollY });
  })()`));
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: previewClickStart.x, y: previewClickStart.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: previewClickStart.x, y: previewClickStart.y, button: "left", clickCount: 1 });
  await waitFor(() => evaluate(page, `document.activeElement.id === 'preview-panel' && Math.abs(scrollY - ${previewClickStart.scrollY}) > 1 && document.querySelector('#preview-panel').getBoundingClientRect().top < innerHeight`));
  const previewNavigation = JSON.parse(await evaluate(page, `JSON.stringify({
    scrollY,
    prints: window.__prints,
    focused: document.activeElement.id,
    targetTop: document.querySelector('#preview-panel').getBoundingClientRect().top,
    targetVisible: (() => { const rect = document.querySelector('#preview-panel').getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 72; })(),
    outlineWidth: getComputedStyle(document.querySelector('#preview-panel')).outlineWidth,
    scrollMarginTop: getComputedStyle(document.querySelector('#preview-panel')).scrollMarginTop,
    editorNumber: document.querySelector('#invoiceNumber').value,
    previewNumber: document.querySelector('#previewInvoiceNumber').textContent
  })`));
  assert.equal(previewNavigation.prints, 0);
  assert.equal(previewNavigation.focused, "preview-panel");
  assert.equal(previewNavigation.targetVisible, true);
  assert.ok(Math.abs(previewNavigation.scrollY - previewClickStart.scrollY) > 1);
  assert.equal(previewNavigation.outlineWidth, "3px");
  assert.equal(previewNavigation.scrollMarginTop, "72px");
  assert.equal(previewNavigation.editorNumber, "INV-SYNC-2");
  assert.equal(previewNavigation.previewNumber, "INV-SYNC-2");

  const previewInspection = JSON.parse(await evaluate(page, `(() => {
    const actual = document.querySelector('#actualSizePreviewButton');
    actual.click();
    const actualState = {
      transform: document.querySelector('#invoiceSheet').style.transform,
      pressed: actual.getAttribute('aria-pressed'),
      overflows: document.querySelector('#previewStage').scrollWidth > document.querySelector('#previewStage').clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewport: innerWidth
    };
    document.querySelector('#fitPreviewButton').click();
    const fitState = {
      transform: document.querySelector('#invoiceSheet').style.transform,
      pressed: document.querySelector('#fitPreviewButton').getAttribute('aria-pressed')
    };
    document.querySelector('#backToEditorButton').click();
    return JSON.stringify({
      actualState,
      fitState,
      focused: document.activeElement.id,
      editorNumber: document.querySelector('#invoiceNumber').value,
      previewNumber: document.querySelector('#previewInvoiceNumber').textContent
    });
  })()`));
  assert.equal(previewInspection.actualState.transform, "scale(1)");
  assert.equal(previewInspection.actualState.pressed, "true");
  assert.equal(previewInspection.actualState.overflows, true);
  assert.ok(previewInspection.actualState.documentWidth <= previewInspection.actualState.viewport);
  assert.notEqual(previewInspection.fitState.transform, "scale(1)");
  assert.equal(previewInspection.fitState.pressed, "true");
  assert.equal(previewInspection.focused, "editorTitle");
  assert.equal(previewInspection.editorNumber, "INV-SYNC-2");
  assert.equal(previewInspection.previewNumber, "INV-SYNC-2");
  const editorTitleVisible = await waitFor(() => evaluate(page, `(() => {
    const title = document.querySelector('#editorTitle').getBoundingClientRect();
    const header = document.querySelector('.app-header').getBoundingClientRect();
    return title.top >= header.bottom && getComputedStyle(document.querySelector('#editorTitle')).outlineWidth === '3px';
  })()`));
  assert.equal(editorTitleVisible, true);
  const persistentMobileActions = JSON.parse(await evaluate(page, `(() => {
    const bar = document.querySelector('.mobile-output-action');
    const rect = bar.getBoundingClientRect();
    return JSON.stringify({
      position: getComputedStyle(bar).position,
      withinViewport: rect.top >= 0 && rect.bottom <= innerHeight + 1,
      buttonHeights: [...bar.querySelectorAll('button')].map(button => button.getBoundingClientRect().height)
    });
  })()`));
  assert.equal(persistentMobileActions.position, "fixed");
  assert.equal(persistentMobileActions.withinViewport, true);
  assert.ok(persistentMobileActions.buttonHeights.every((height) => height >= 44));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await evaluate(page, `(() => {
    for (let index = 0; index < 4; index += 1) document.querySelector('#addItemButton').click();
  })()`);
  assert.deepEqual(JSON.parse(await evaluate(page, `JSON.stringify({ rows: document.querySelectorAll('.item-row').length, disabled: document.querySelector('#addItemButton').disabled, describedBy: document.querySelector('#addItemButton').getAttribute('aria-describedby') })`)), { rows: 5, disabled: true, describedBy: "itemLimitHelp" });

  await evaluate(page, `(() => {
    document.querySelectorAll('.remove-item')[1].click();
    const quantity = document.querySelector('[data-item-field="quantity"]');
    const price = document.querySelector('[data-item-field="price"]');
    quantity.value = '2.8'; quantity.dispatchEvent(new Event('input', { bubbles: true }));
    price.value = '10.50'; price.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const itemState = JSON.parse(await evaluate(page, `JSON.stringify({
    rows: document.querySelectorAll('.item-row').length,
    quantity: document.querySelector('[data-item-field="quantity"]').value,
    quantityValid: document.querySelector('[data-item-field="quantity"]').validity.valid,
    total: document.querySelector('#editorTotal').textContent,
    focused: document.activeElement.dataset.itemField,
    toast: document.querySelector('#toast').textContent
  })`));
  assert.deepEqual(itemState, { rows: 4, quantity: "2.8", quantityValid: false, total: "$0.00", focused: "description", toast: "Item 2 removed. 4 items remaining." });

  const blankArrowQuantity = await evaluate(page, `(() => {
    const quantity = document.querySelector('[data-item-field="quantity"]');
    quantity.value = '';
    quantity.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    return quantity.value;
  })()`);
  assert.equal(blankArrowQuantity, "1");

  const blankQuantityRerender = JSON.parse(await evaluate(page, `(() => {
    const quantity = document.querySelector('[data-item-field="quantity"]');
    quantity.value = '';
    quantity.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#addItemButton').click();
    document.querySelectorAll('.remove-item')[document.querySelectorAll('.remove-item').length - 1].click();
    const rerendered = document.querySelector('[data-item-field="quantity"]');
    document.querySelector('#printButton').click();
    const result = {
      value: rerendered.value,
      valid: rerendered.validity.valid,
      invalid: rerendered.getAttribute('aria-invalid'),
      total: document.querySelector('#editorTotal').textContent,
      dialogOpen: document.querySelector('#outputDialog').open
    };
    rerendered.value = '1';
    rerendered.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(blankQuantityRerender, { value: "", valid: false, invalid: "true", total: "$0.00", dialogOpen: false });

  const blankPriceTotal = await evaluate(page, `(() => {
    const price = document.querySelector('[data-item-field="price"]');
    price.value = '';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    const total = document.querySelector('#editorTotal').textContent;
    price.value = '10.50';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    return total;
  })()`);
  assert.equal(blankPriceTotal, "$0.00");

  const longDescriptionFits = await evaluate(page, `(() => {
    const description = document.querySelector('[data-item-field="description"]');
    description.value = 'X'.repeat(500);
    description.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('#invoiceSheet').scrollWidth <= ${793.7 + 2};
  })()`);
  assert.equal(longDescriptionFits, true);

  const itemNameCasing = JSON.parse(await evaluate(page, `(() => {
    const description = document.querySelector('[data-item-field="description"]');
    description.value = 'Weekend Market Space';
    description.dispatchEvent(new Event('input', { bubbles: true }));
    const preview = document.querySelector('#previewItems td:nth-child(2)');
    return JSON.stringify({
      editorValue: description.value,
      previewValue: preview.textContent,
      editorTransform: getComputedStyle(description).textTransform,
      previewTransform: getComputedStyle(preview).textTransform,
      readOnly: description.readOnly,
      disabled: description.disabled
    });
  })()`));
  assert.deepEqual(itemNameCasing, {
    editorValue: "Weekend Market Space",
    previewValue: "Weekend Market Space",
    editorTransform: "none",
    previewTransform: "none",
    readOnly: false,
    disabled: false,
  });

  const multilineDescription = JSON.parse(await evaluate(page, `(() => {
    const description = document.querySelector('[data-item-field="description"]');
    description.value = 'First line\\nSecond line';
    description.dispatchEvent(new Event('input', { bubbles: true }));
    description.setSelectionRange(11, 22);
    description.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    const preview = document.querySelector('#previewItems td:nth-child(2)');
    return JSON.stringify({
      editorValue: description.value,
      text: preview.textContent,
      boldText: preview.querySelector('strong')?.textContent,
      shortcuts: description.getAttribute('aria-keyshortcuts'),
      whiteSpace: getComputedStyle(preview).whiteSpace,
      height: preview.scrollHeight
    });
  })()`));
  assert.equal(multilineDescription.editorValue, "First line\n**Second line**");
  assert.equal(multilineDescription.text, "First line\nSecond line");
  assert.equal(multilineDescription.boldText, "Second line");
  assert.equal(multilineDescription.shortcuts, "Control+B Meta+B");
  assert.equal(multilineDescription.whiteSpace, "pre-wrap");
  assert.ok(multilineDescription.height > 20, "two-line preview should be taller than one line");

  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 760, deviceScaleFactor: 1, mobile: true });
  const touchBoldFormatting = JSON.parse(await evaluate(page, `(() => {
    const description = document.querySelector('[data-item-field="description"]');
    description.value = 'Touch selected text';
    description.dispatchEvent(new Event('input', { bubbles: true }));
    description.setSelectionRange(6, 14);
    document.querySelector('.item-format-button').click();
    return JSON.stringify({
      value: description.value,
      boldText: document.querySelector('#previewItems td:nth-child(2) strong')?.textContent,
      buttonVisible: document.querySelector('.item-format-button').getClientRects().length > 0,
      desktopHelpVisible: document.querySelector('.desktop-formatting-help').getClientRects().length > 0,
      mobileHelpVisible: document.querySelector('.mobile-formatting-help').getClientRects().length > 0
    });
  })()`));
  assert.deepEqual(touchBoldFormatting, { value: "Touch **selected** text", boldText: "selected", buttonVisible: true, desktopHelpVisible: false, mobileHelpVisible: true });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const boldLimit = JSON.parse(await evaluate(page, `(() => {
    const description = document.querySelector('[data-item-field="description"]');
    description.value = 'X'.repeat(1000);
    description.dispatchEvent(new Event('input', { bubbles: true }));
    description.setSelectionRange(0, 10);
    document.querySelector('.item-format-button').click();
    const result = { length: description.value.length, toast: document.querySelector('#toast').textContent };
    description.value = 'Service';
    description.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(boldLimit, { length: 1000, toast: "Bold formatting would exceed the 1000-character item limit." });

  await evaluate(page, `(() => {
    const billTo = document.querySelector('#billTo');
    const quantity = document.querySelector('[data-item-field="quantity"]');
    const description = document.querySelector('[data-item-field="description"]');
    billTo.value = 'Immediate reload customer';
    billTo.dispatchEvent(new Event('input', { bubbles: true }));
    quantity.value = '3'; quantity.dispatchEvent(new Event('input', { bubbles: true }));
    description.value = 'Service'; description.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('[data-item-field="price"]')].slice(1).forEach(price => {
      price.value = '0';
      price.dispatchEvent(new Event('input', { bubbles: true }));
    });
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    location.reload();
  })()`);
  await waitFor(() => evaluate(page, "document.readyState === 'complete' && document.querySelector('#billTo').value === 'IMMEDIATE RELOAD CUSTOMER'"));

  await new Promise((resolve) => setTimeout(resolve, 300));
  await evaluate(page, "location.reload(); true");
  await waitFor(() => evaluate(page, "document.readyState === 'complete' && document.querySelectorAll('.item-row').length === 4"));
  await evaluate(page, "document.querySelector('#continueDraftButton').click(); true");
  assert.equal(await evaluate(page, "document.querySelector('#editorTotal').textContent"), "$31.50");
  const persistedCustomFilename = JSON.parse(await evaluate(page, `(() => {
    const filename = document.querySelector('#pdfFileName');
    const before = filename.value;
    const number = document.querySelector('#invoiceNumber');
    number.value = 'INV-AFTER-RELOAD'; number.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ before, after: filename.value, checked: document.querySelector('#customizePdfFileName').checked, editable: !filename.readOnly });
  })()`));
  assert.deepEqual(persistedCustomFilename, { before: "Client custom", after: "Client custom", checked: true, editable: true });
  await evaluate(page, "persistDraftImmediately()");
  await evaluate(page, `(() => {
    // Simulate earlier IndexedDB work still occupying the asynchronous queue.
    // The latest input must survive a reload before that work can complete.
    outboxWriteQueue = new Promise(() => {});
    window.__beforeFilenameReload = true;
    const toggle = document.querySelector('#customizePdfFileName');
    toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    location.reload();
  })()`);
  await waitFor(() => evaluate(page, "!window.__beforeFilenameReload && document.readyState === 'complete' && document.body.dataset.page === 'history'"));
  assert.equal(await evaluate(page, "document.querySelector('#pdfFileName').value === document.querySelector('#invoiceNumber').value && document.querySelector('#pdfFileName').readOnly"), true, "the latest filename toggle must survive reload while an earlier outbox write is queued");
  await evaluate(page, "document.querySelector('#continueDraftButton').click(); true");
  const clearedFilenameBehavior = JSON.parse(await evaluate(page, `(() => {
    const number = document.querySelector('#invoiceNumber');
    const filename = document.querySelector('#pdfFileName');
    const reset = filename.value;
    number.value = 'INV-CLEAR-SYNC'; number.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ reset, numberBefore: 'INV-AFTER-RELOAD', synced: filename.value, checked: document.querySelector('#customizePdfFileName').checked, readOnly: filename.readOnly });
  })()`));
  assert.deepEqual(clearedFilenameBehavior, { reset: "INV-AFTER-RELOAD", numberBefore: "INV-AFTER-RELOAD", synced: "INV-CLEAR-SYNC", checked: false, readOnly: true });

  await evaluate(page, "persistDraftImmediately()");
  await evaluate(page, `(() => {
    // Keep the previous save in flight while Clear saved draft queues its
    // deletion. Slow CI exposed this ordering; make it deterministic everywhere.
    window.__originalDraftSave = window.invoiceBackend.saveDraft;
    window.invoiceBackend.saveDraft = async (...args) => {
      const result = await window.__originalDraftSave(...args);
      await new Promise(resolve => { window.__releaseDraftBeforeClear = resolve; });
      return result;
    };
    const number = document.querySelector('#invoiceNumber');
    number.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(page, "typeof window.__releaseDraftBeforeClear === 'function'"));
  const numberBeforeClear = await evaluate(page, "document.querySelector('#invoiceNumber').value");
  await evaluate(page, "window.confirm = () => true; document.querySelector('#clearDraftButton').click(); true");
  await waitFor(() => evaluate(page, "window.invoiceDraftOutbox.get('test-user-1').then(operation => operation?.type === 'delete')"));
  await evaluate(page, "window.invoiceBackend.saveDraft = window.__originalDraftSave; window.__releaseDraftBeforeClear(); true");
  await waitFor(() => evaluate(page, `document.querySelector('#invoiceNumber').value !== ${JSON.stringify(numberBeforeClear)} || document.querySelector('#toast').textContent.includes('Draft deletion is waiting to sync')`));
  assert.notEqual(
    await evaluate(page, "document.querySelector('#invoiceNumber').value"),
    numberBeforeClear,
    "Clear saved draft must finish its queued deletion after an in-flight save before resetting the editor",
  );
  assert.equal(await evaluate(page, "localStorage.getItem('test-remote-draft')"), null);
  assert.match(await evaluate(page, "document.querySelector('#invoiceNumber').value"), /^EHR-\d{8}-\d{3,}$/);
  await evaluate(page, "window.dispatchEvent(new PageTransitionEvent('pagehide'))");
  assert.equal(await evaluate(page, "localStorage.getItem('test-remote-draft')"), null);

  const metadataOnlyProtection = JSON.parse(await evaluate(page, `(async () => {
    const number = document.querySelector('#invoiceNumber');
    number.value = 'metadata-only';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    let confirmations = 0;
    window.confirm = () => { confirmations += 1; return false; };
    document.querySelector('#newInvoiceButton').click();
    const result = { confirmations, number: number.value };
    window.confirm = () => true;
    document.querySelector('#newInvoiceButton').click();
    while (number.value === 'METADATA-ONLY') await new Promise(resolve => setTimeout(resolve, 0));
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(metadataOnlyProtection, { confirmations: 1, number: "METADATA-ONLY" });

  const newInvoiceProtection = JSON.parse(await evaluate(page, `(async () => {
    const billTo = document.querySelector('#billTo');
    billTo.value = 'Keep me'; billTo.dispatchEvent(new Event('input', { bubbles: true }));
    const before = document.querySelector('#invoiceNumber').value;
    window.confirm = () => false;
    document.querySelector('#newInvoiceButton').click();
    const cancelled = { number: document.querySelector('#invoiceNumber').value, billTo: billTo.value };
    window.confirm = () => true;
    document.querySelector('#newInvoiceButton').click();
    while (document.querySelector('#invoiceNumber').value === before) await new Promise(resolve => setTimeout(resolve, 0));
    return JSON.stringify({ before, cancelled, after: document.querySelector('#invoiceNumber').value, pdfAfter: document.querySelector('#pdfFileName').value, billToAfter: document.querySelector('#billTo').value });
  })()`));
  assert.deepEqual(newInvoiceProtection.cancelled, { number: newInvoiceProtection.before, billTo: "KEEP ME" });
  assert.notEqual(newInvoiceProtection.after, newInvoiceProtection.before);
  assert.equal(newInvoiceProtection.pdfAfter, newInvoiceProtection.after);
  assert.equal(newInvoiceProtection.billToAfter, "");
  const followingInvoiceNumber = await evaluate(page, `(async () => {
    const before = document.querySelector('#invoiceNumber').value;
    document.querySelector('#newInvoiceButton').click();
    while (document.querySelector('#invoiceNumber').value === before) await new Promise(resolve => setTimeout(resolve, 0));
    return document.querySelector('#invoiceNumber').value;
  })()`);
  assert.notEqual(followingInvoiceNumber, newInvoiceProtection.after);

  const validation = JSON.parse(await evaluate(page, `(() => {
    for (const id of ['invoiceNumber', 'invoiceDate', 'dueDate']) {
      const input = document.querySelector('#' + id); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#printButton').click();
    const invalid = [...document.querySelectorAll('[aria-invalid="true"]')];
    return JSON.stringify({ count: invalid.length, linked: invalid.every(input => input.getAttribute('aria-describedby').split(/\\s+/).some(id => document.getElementById(id)?.classList.contains('field-error'))) });
  })()`));
  assert.deepEqual(validation, { count: 6, linked: true });
  const requiredDateRecovery = JSON.parse(await evaluate(page, `(() => {
    const invoiceDate = document.querySelector('#invoiceDate');
    const dueDate = document.querySelector('#dueDate');
    invoiceDate.value = '2026-08-20'; invoiceDate.dispatchEvent(new Event('input', { bubbles: true }));
    const afterInvoiceDate = {
      invoiceInvalid: invoiceDate.hasAttribute('aria-invalid'),
      invoiceError: Boolean(document.querySelector('#error-invoiceDate')),
      dueInvalid: dueDate.hasAttribute('aria-invalid'),
      dueError: Boolean(document.querySelector('#error-dueDate'))
    };
    dueDate.value = '2026-08-27'; dueDate.dispatchEvent(new Event('input', { bubbles: true }));
    const afterDueDate = {
      invoiceInvalid: invoiceDate.hasAttribute('aria-invalid'),
      invoiceError: Boolean(document.querySelector('#error-invoiceDate')),
      dueInvalid: dueDate.hasAttribute('aria-invalid'),
      dueError: Boolean(document.querySelector('#error-dueDate'))
    };
    return JSON.stringify({ afterInvoiceDate, afterDueDate });
  })()`));
  assert.deepEqual(requiredDateRecovery, {
    afterInvoiceDate: { invoiceInvalid: false, invoiceError: false, dueInvalid: true, dueError: true },
    afterDueDate: { invoiceInvalid: false, invoiceError: false, dueInvalid: false, dueError: false },
  });
  const repeatedValidation = JSON.parse(await evaluate(page, `(() => {
    const invoiceNumber = document.querySelector('#invoiceNumber');
    invoiceNumber.value = 'INV-1'; invoiceNumber.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#printButton').click();
    document.querySelector('#printButton').click();
    const ids = [...document.querySelectorAll('.field-error')].map(error => error.id);
    return JSON.stringify({ total: ids.length, unique: new Set(ids).size });
  })()`));
  assert.equal(repeatedValidation.total, repeatedValidation.unique);

  const whitespaceValidation = JSON.parse(await evaluate(page, `(() => {
    const invoiceNumber = document.querySelector('#invoiceNumber');
    const billTo = document.querySelector('#billTo');
    const invoiceDate = document.querySelector('#invoiceDate');
    const dueDate = document.querySelector('#dueDate');
    invoiceNumber.value = '   '; invoiceNumber.dispatchEvent(new Event('input', { bubbles: true }));
    billTo.value = '   '; billTo.dispatchEvent(new Event('input', { bubbles: true }));
    invoiceDate.value = '2026-08-20'; invoiceDate.dispatchEvent(new Event('input', { bubbles: true }));
    dueDate.value = '2026-08-27'; dueDate.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#printButton').click();
    const result = {
      invoiceInvalid: invoiceNumber.getAttribute('aria-invalid'),
      billInvalid: billTo.getAttribute('aria-invalid'),
      dialogOpen: document.querySelector('#outputDialog').open,
      focused: document.activeElement.id
    };
    invoiceNumber.value = 'INV-1'; invoiceNumber.dispatchEvent(new Event('input', { bubbles: true }));
    billTo.value = 'Customer'; billTo.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(whitespaceValidation, { invoiceInvalid: "true", billInvalid: "true", dialogOpen: false, focused: "invoiceNumber" });

  const overflowBlocked = JSON.parse(await evaluate(page, `(() => {
    const quantity = document.querySelector('[data-item-field="quantity"]');
    const price = document.querySelector('[data-item-field="price"]');
    quantity.value = '2'; quantity.dispatchEvent(new Event('input', { bubbles: true }));
    price.value = '1e308'; price.dispatchEvent(new Event('input', { bubbles: true }));
    window.__prints = 0; window.print = () => { window.__prints += 1; };
    document.querySelector('#printButton').click();
    return JSON.stringify({ prints: window.__prints, total: document.querySelector('#editorTotal').textContent, invalid: price.getAttribute('aria-invalid') });
  })()`));
  assert.deepEqual(overflowBlocked, { prints: 0, total: "$0.00", invalid: "true" });

  const printCount = await evaluate(page, `(async () => {
    window.__prints = 0; window.__printedTitle = '';
    const titleBeforePrint = document.title;
    const values = { invoiceNumber: 'INV-1', pdfFileName: 'August / Brew Invoice.pdf', invoiceDate: '2026-08-20', dueDate: '2026-08-13', billTo: 'Customer' };
    for (const [id, value] of Object.entries(values)) { const input = document.querySelector('#' + id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    const description = document.querySelector('[data-item-field="description"]'); description.value = 'Service'; description.dispatchEvent(new Event('input', { bubbles: true }));
    const price = document.querySelector('[data-item-field="price"]'); price.value = '25'; price.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#printButton').click();
    const invoiceDate = document.querySelector('#invoiceDate');
    const dueDate = document.querySelector('#dueDate');
    const rejected = { prints: window.__prints, focused: document.activeElement.id, message: document.querySelector('#error-dueDate')?.textContent, describedBy: dueDate.getAttribute('aria-describedby') };
    invoiceDate.value = ''; invoiceDate.dispatchEvent(new Event('input', { bubbles: true }));
    const clearedInvoiceDate = { invalid: dueDate.hasAttribute('aria-invalid'), errorExists: Boolean(document.querySelector('#error-dueDate')), describedBy: dueDate.getAttribute('aria-describedby') };
    invoiceDate.value = '2026-08-20'; invoiceDate.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#printButton').click();
    dueDate.value = ''; dueDate.dispatchEvent(new Event('input', { bubbles: true }));
    const clearedDueDate = { invalid: dueDate.hasAttribute('aria-invalid'), errorExists: Boolean(document.querySelector('#error-dueDate')), describedBy: dueDate.getAttribute('aria-describedby') };
    dueDate.value = '2026-08-27'; dueDate.dispatchEvent(new Event('input', { bubbles: true }));
    const recovered = { invalid: dueDate.hasAttribute('aria-invalid'), errorExists: Boolean(document.querySelector('#error-dueDate')) };
    document.querySelector('#printButton').click();
    while (!document.querySelector('#outputDialog').open) await new Promise(resolve => setTimeout(resolve, 0));
    const dialog = {
      open: document.querySelector('#outputDialog').open,
      title: document.querySelector('#outputDialogTitle').textContent,
      closeLabel: document.querySelector('#cancelOutputDialogButton').textContent,
      fileName: document.querySelector('#outputFileName').textContent,
      printsBeforeChoice: window.__prints
    };
    const originalOpen = window.open;
    const capturedPrintPdf = {};
    const printTarget = {
      closed: false,
      document: { title: '', body: { textContent: '', style: { cssText: '' } } },
      location: {
        replace(url) {
          capturedPrintPdf.url = url;
          setTimeout(() => printTarget.loadHandler?.(), 0);
        }
      },
      addEventListener(type, handler) { if (type === 'load') this.loadHandler = handler; },
      focus() {},
      print() {
        window.__prints += 1;
        window.__printedTitle = capturedPrintPdf.title + '.pdf';
      },
      close() { this.closed = true; }
    };
    const printWorker = {
      set() { return this; },
      from() { return this; },
      toPdf() { return this; },
      get() { return this; },
      then(callback) {
        callback({
          setFont() {},
          setFontSize() {},
          setLanguage() {},
          text() {},
          setProperties(properties) { capturedPrintPdf.title = properties.title; }
        });
        return this;
      },
      outputPdf() { return Promise.resolve(new Blob(['%PDF-print-copy'], { type: 'application/pdf' })); }
    };
    window.open = () => printTarget;
    window.html2pdf = () => printWorker;
    document.querySelector('#printNowButton').click();
    while (window.__prints < 1) await new Promise(resolve => setTimeout(resolve, 10));
    const titleDuringPrint = window.__printedTitle;
    window.open = originalOpen;
    delete window.html2pdf;
    window.dispatchEvent(new Event('afterprint'));
    return JSON.stringify({
      rejected,
      clearedInvoiceDate,
      clearedDueDate,
      recovered,
      dialog,
      prints: window.__prints,
      printedTitle: window.__printedTitle,
      titleBeforePrint,
      titleDuringPrint,
      titleAfterPrint: document.title,
      focused: document.activeElement.id,
      invalid: document.querySelectorAll('[aria-invalid="true"]').length
    });
  })()`);
  const printBehavior = JSON.parse(printCount);
  assert.deepEqual({
    rejected: printBehavior.rejected,
    clearedInvoiceDate: printBehavior.clearedInvoiceDate,
    clearedDueDate: printBehavior.clearedDueDate,
    recovered: printBehavior.recovered,
    dialog: printBehavior.dialog,
    prints: printBehavior.prints,
    printedTitle: printBehavior.printedTitle,
    focused: printBehavior.focused,
    invalid: printBehavior.invalid,
  }, {
    rejected: { prints: 0, focused: "dueDate", message: "Due date cannot be earlier than the invoice date.", describedBy: "error-dueDate" },
    clearedInvoiceDate: { invalid: false, errorExists: false, describedBy: null },
    clearedDueDate: { invalid: false, errorExists: false, describedBy: null },
    recovered: { invalid: false, errorExists: false },
    dialog: { open: true, title: "Invoice saved", closeLabel: "Done", fileName: "August - Brew Invoice.pdf", printsBeforeChoice: 0 },
    prints: 1,
    printedTitle: "August - Brew Invoice.pdf",
    focused: "printButton",
    invalid: 0,
  });
  assert.equal(printBehavior.titleDuringPrint, "August - Brew Invoice.pdf");
  assert.equal(printBehavior.titleAfterPrint, printBehavior.titleBeforePrint);

  await page.send("Emulation.setEmulatedMedia", { media: "print" });
  const printVisibility = JSON.parse(await evaluate(page, `JSON.stringify({
    skipLink: getComputedStyle(document.querySelector('.skip-link')).display,
    invoiceTransform: getComputedStyle(document.querySelector('#invoiceSheet')).transform
  })`));
  assert.deepEqual(printVisibility, { skipLink: "none", invoiceTransform: "none" });
  await page.send("Emulation.setEmulatedMedia", { media: "" });

  const browserPrintResult = await page.send("Page.printToPDF", {
    displayHeaderFooter: false,
    printBackground: true,
    preferCSSPageSize: true,
  });
  const browserPrintPdf = Buffer.from(browserPrintResult.data, "base64");
  assert.equal(browserPrintPdf.subarray(0, 4).toString(), "%PDF");
  assert.equal((browserPrintPdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);

  assert.equal(await evaluate(page, "typeof window.html2pdf"), "undefined");
  assert.equal(await evaluate(page, "document.querySelector('script[data-pdf-library]') === null"), true);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  const mobileDialog = JSON.parse(await evaluate(page, `(async () => {
    document.querySelector('#mobilePrintButton').click();
    const dialog = document.querySelector('#outputDialog');
    while (!dialog.open) await new Promise(resolve => setTimeout(resolve, 0));
    const rect = dialog.getBoundingClientRect();
    const optionHeights = [...dialog.querySelectorAll('.output-option')].map(option => option.getBoundingClientRect().height);
    const result = {
      open: dialog.open,
      left: rect.left,
      right: rect.right,
      viewport: innerWidth,
      fileName: document.querySelector('#outputFileName').textContent,
      optionHeights
    };
    document.querySelector('#cancelOutputDialogButton').click();
    return JSON.stringify(result);
  })()`));
  assert.equal(mobileDialog.open, true);
  assert.ok(mobileDialog.left >= 0);
  assert.ok(mobileDialog.right <= mobileDialog.viewport);
  assert.equal(mobileDialog.fileName, "August - Brew Invoice.pdf");
  mobileDialog.optionHeights.forEach((height) => assert.ok(height >= 76));

  await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: profile, eventsEnabled: true });
  const downloadedPdfPath = join(profile, "August - Brew Invoice.pdf");
  await evaluate(page, `(() => {
    document.querySelector('#mobilePrintButton').click();
    return true;
  })()`);
  await waitFor(() => evaluate(page, "document.querySelector('#outputDialog').open"));
  await evaluate(page, "document.querySelector('#savePdfButton').click(); true");
  await waitFor(() => evaluate(page, "typeof window.html2pdf === 'function'"));
  assert.equal(
    await evaluate(page, "document.querySelector('script[data-pdf-library=\"html2pdf\"]')?.getAttribute('src')"),
    "./vendor/html2pdf.bundle.min.js?v=33",
  );
  await waitFor(async () => {
    try {
      return (await stat(downloadedPdfPath)).size > 20000;
    } catch {
      return false;
    }
  }, 20000);
  const generatedPdf = await readFile(downloadedPdfPath);
  assert.equal(generatedPdf.subarray(0, 4).toString(), "%PDF");
  assert.equal((generatedPdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
  await waitFor(() => evaluate(page, "document.querySelector('#outputDialog').open === false"));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const pdfDownload = JSON.parse(await evaluate(page, `(async () => {
    const captured = {};
    const worker = {
      set(options) { captured.options = options; return this; },
      from(element) {
        captured.element = {
          id: element.id,
          transform: element.style.transform,
          width: element.style.width,
          logoEmbedded: element.querySelector('.invoice-logo').src.startsWith('data:image/png;base64,'),
          typographyEmbedded: [
            element,
            element.querySelector('.invoice-heading-block h2'),
            element.querySelector('.invoice-party'),
            element.querySelector('.invoice-table'),
            element.querySelector('.invoice-notes'),
            element.querySelector('.payment-detail'),
            element.querySelector('.invoice-footer')
          ].every(node => Boolean(node.style.fontSize && node.style.lineHeight))
        };
        return this;
      },
      toPdf() { captured.toPdf = true; return this; },
      get(key) { captured.get = key; return this; },
      then(callback) {
        callback({
          setFont(family, style) { captured.font = [family, style]; },
          setFontSize(size) { captured.fontSize = size; },
          setLanguage(language) { captured.language = language; },
          text(lines, x, y, options) { captured.searchableText = { lines, x, y, options }; },
          setProperties(properties) { captured.properties = properties; }
        });
        return this;
      },
      save() { captured.saved = true; return Promise.resolve(); }
    };
    window.html2pdf = () => worker;
    document.querySelector('#printButton').click();
    while (!document.querySelector('#outputDialog').open) await new Promise(resolve => setTimeout(resolve, 0));
    const openBeforeSave = document.querySelector('#outputDialog').open;
    document.querySelector('#savePdfButton').click();
    while (!captured.saved) await new Promise(resolve => setTimeout(resolve, 0));
    return JSON.stringify({
      openBeforeSave,
      openAfterSave: document.querySelector('#outputDialog').open,
      fileName: captured.options.filename,
      format: captured.options.jsPDF.format,
      title: captured.properties.title,
      creator: captured.properties.creator,
      searchableInvoiceNumber: captured.searchableText.lines.includes('Invoice Number: INV-1'),
      searchableCustomer: captured.searchableText.lines.includes('BILL TO: CUSTOMER'),
      textMode: captured.searchableText.options.renderingMode,
      language: captured.language,
      element: captured.element,
      saved: captured.saved,
      busy: document.querySelector('#outputDialog').getAttribute('aria-busy'),
      focused: document.activeElement.id,
      toast: document.querySelector('#toast').textContent
    });
  })()`));
  assert.deepEqual(pdfDownload, {
    openBeforeSave: true,
    openAfterSave: false,
    fileName: "August - Brew Invoice.pdf",
    format: "a4",
    title: "August - Brew Invoice",
    creator: "Eng Hoon Residences",
    searchableInvoiceNumber: true,
    searchableCustomer: true,
    textMode: "invisible",
    language: "en-SG",
    element: { id: "", transform: "none", width: "793px", logoEmbedded: true, typographyEmbedded: true },
    saved: true,
    busy: "false",
    focused: "printButton",
    toast: "August - Brew Invoice.pdf saved.",
  });

  const historyBehavior = JSON.parse(await evaluate(page, `(async () => {
    document.querySelector('#invoiceListButton').click();
    const initial = {
      page: document.body.dataset.page,
      count: document.querySelectorAll('.invoice-record').length,
      number: document.querySelector('.invoice-number')?.textContent,
      customer: document.querySelector('.invoice-customer')?.textContent,
      total: document.querySelector('.invoice-record-meta div:last-child dd')?.textContent,
      semanticLabel: document.querySelector('.invoice-record')?.getAttribute('aria-labelledby'),
      titleTag: document.querySelector('.invoice-number')?.tagName,
      createActions: ['newInvoiceButton', 'historyNewInvoiceButton', 'emptyStateNewInvoiceButton']
        .filter(id => document.getElementById(id).getClientRects().length > 0).length
    };

    document.querySelector('[data-edit-invoice]').click();
    const editedCustomer = document.querySelector('#billTo');
    editedCustomer.value = 'Updated Customer';
    editedCustomer.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#printButton').click();
    while (!document.querySelector('#outputDialog').open) await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector('#cancelOutputDialogButton').click();
    document.querySelector('#invoiceListButton').click();
    const afterEdit = {
      count: document.querySelectorAll('.invoice-record').length,
      customer: document.querySelector('.invoice-customer')?.textContent
    };

    const sourceNumber = document.querySelector('.invoice-number').textContent;
    const sourcePdfFileName = document.querySelector('#pdfFileName').value;
    document.querySelector('[data-duplicate-invoice]').click();
    while (document.querySelector('#editorTitle').textContent !== 'Review duplicated invoice') await new Promise(resolve => setTimeout(resolve, 0));
    const duplicate = {
      number: document.querySelector('#invoiceNumber').value,
      pdfFileName: document.querySelector('#pdfFileName').value,
      customer: document.querySelector('#billTo').value,
      title: document.querySelector('#editorTitle').textContent,
      status: await (async () => {
        while (!document.querySelector('#saveStatus').textContent.includes('Not in history')) await new Promise(resolve => setTimeout(resolve, 0));
        return document.querySelector('#saveStatus').textContent;
      })()
    };
    document.querySelector('#printButton').click();
    while (!document.querySelector('#outputDialog').open) await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector('#cancelOutputDialogButton').click();
    document.querySelector('#invoiceListButton').click();
    const afterDuplicate = {
      count: document.querySelectorAll('.invoice-record').length,
      numbers: [...document.querySelectorAll('.invoice-number')].map(element => element.textContent)
    };
    return JSON.stringify({ initial, afterEdit, sourceNumber, sourcePdfFileName, duplicate, afterDuplicate });
  })()`));
  assert.equal(historyBehavior.initial.page, "history");
  assert.equal(historyBehavior.initial.count, 1);
  assert.equal(historyBehavior.initial.number, "INV-1");
  assert.equal(historyBehavior.initial.customer, "CUSTOMER");
  assert.equal(historyBehavior.initial.total, "$50.00");
  assert.equal(historyBehavior.initial.titleTag, "H3");
  assert.ok(historyBehavior.initial.semanticLabel);
  assert.equal(historyBehavior.initial.createActions, 2);
  assert.deepEqual(historyBehavior.afterEdit, { count: 1, customer: "UPDATED CUSTOMER" });
  assert.equal(historyBehavior.duplicate.number, historyBehavior.sourceNumber);
  assert.equal(historyBehavior.duplicate.pdfFileName, historyBehavior.sourcePdfFileName);
  assert.equal(historyBehavior.duplicate.customer, "UPDATED CUSTOMER");
  assert.equal(historyBehavior.duplicate.title, "Review duplicated invoice");
  assert.equal(historyBehavior.duplicate.status, "Duplicate draft saved locally. Not in history.");
  assert.equal(historyBehavior.afterDuplicate.count, 2);
  assert.equal(
    historyBehavior.afterDuplicate.numbers.filter((number) => number === historyBehavior.sourceNumber).length,
    2,
  );

  const savedInvoiceDeletion = JSON.parse(await evaluate(page, `(async () => {
    window.confirm = () => true;
    const before = document.querySelectorAll('.invoice-record').length;
    document.querySelector('[data-delete-invoice]').click();
    while (document.querySelectorAll('.invoice-record').length === before) await new Promise(resolve => setTimeout(resolve, 0));
    return JSON.stringify({
      before,
      after: document.querySelectorAll('.invoice-record').length,
      deleteButtons: document.querySelectorAll('[data-delete-invoice]').length,
      draftStored: localStorage.getItem('test-remote-draft') !== null,
      editorBillTo: document.querySelector('#billTo').value
    });
  })()`));
  assert.deepEqual(savedInvoiceDeletion, { before: 2, after: 1, deleteButtons: 1, draftStored: false, editorBillTo: "" });
  for (const width of [1440, 1000, 842, 375]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    const layout = JSON.parse(await evaluate(page, `(() => {
      window.scrollTo(0, 0);
      const record = document.querySelector('.invoice-record');
      const cells = [record.querySelector('.invoice-number'), record.querySelector('.invoice-customer'), ...record.querySelectorAll('.invoice-record-meta dd'), record.querySelector('.invoice-record-actions')];
      const headings = [...document.querySelectorAll('.invoice-table-head span')];
      const email = document.querySelector('#accountEmail');
      const button = document.querySelector('#signOutButton');
      const buttonRect = button.getBoundingClientRect();
      const x = buttonRect.left + buttonRect.width / 2;
      const y = buttonRect.top + buttonRect.height / 2;
      return JSON.stringify({
        fits: document.documentElement.scrollWidth <= innerWidth,
        emailVisible: email.getClientRects().length > 0 && email.getBoundingClientRect().width > 0 && Boolean(email.textContent.trim()),
        signOutVisible: buttonRect.width >= 44 && buttonRect.height >= 44 && buttonRect.left >= 0 && buttonRect.right <= innerWidth && buttonRect.top >= 0 && buttonRect.bottom <= innerHeight,
        signOutReceivesPointer: button.contains(document.elementFromPoint(x, y)),
        columnsAlign: cells.every((cell, index) => Math.abs(cell.getBoundingClientRect().left - headings[index].getBoundingClientRect().left) < 1),
        sameRow: cells.every(cell => Math.abs((cell.getBoundingClientRect().top + cell.getBoundingClientRect().height / 2) - (cells[0].getBoundingClientRect().top + cells[0].getBoundingClientRect().height / 2)) < 1),
        metadataBelowIdentity: record.querySelector('.invoice-record-meta').getBoundingClientRect().top >= record.firstElementChild.getBoundingClientRect().bottom,
        actionsBelowMetadata: record.querySelector('.invoice-record-actions').getBoundingClientRect().top >= record.querySelector('.invoice-record-meta').getBoundingClientRect().bottom
      });
    })()`));
    assert.equal(layout.fits, true, `${width}px populated history must fit the viewport`);
    assert.equal(layout.emailVisible, true, `${width}px account identity must remain visible`);
    assert.equal(layout.signOutVisible && layout.signOutReceivesPointer, true, `${width}px Sign out must be visible and receive pointer input`);
    if (width > 700) {
      assert.equal(layout.columnsAlign && layout.sameRow, true, `${width}px invoice cells must align with their own column headers`);
    } else {
      assert.equal(layout.metadataBelowIdentity && layout.actionsBelowMetadata, true, `${width}px invoice cards must keep identity, metadata and actions separate`);
    }
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  const mobileHistoryActions = JSON.parse(await evaluate(page, `(() => {
    const record = document.querySelector('.invoice-record').getBoundingClientRect();
    return JSON.stringify({
      documentWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      withinViewport: record.left >= 0 && record.right <= innerWidth,
      heights: [...document.querySelectorAll('.invoice-record-actions .button')].map(button => button.getBoundingClientRect().height)
    });
  })()`));
  assert.ok(mobileHistoryActions.documentWidth <= mobileHistoryActions.viewport);
  assert.equal(mobileHistoryActions.withinViewport, true);
  assert.ok(mobileHistoryActions.heights.every((height) => height >= 44));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const deleteDraftBehavior = JSON.parse(await evaluate(page, `(async () => {
    const savedCount = document.querySelectorAll('.invoice-record').length;
    document.querySelector('[data-edit-invoice]').click();
    const customer = document.querySelector('#billTo');
    customer.value = 'Unsaved customer change';
    customer.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#invoiceListButton').click();
    while (localStorage.getItem('test-remote-draft') === null) await new Promise(resolve => setTimeout(resolve, 0));
    const noticeBefore = !document.querySelector('#draftNotice').hidden;
    const actionsAdjacent = document.querySelector('#continueDraftButton').parentElement === document.querySelector('#deleteDraftButton').parentElement;
    let confirmations = 0;
    window.confirm = () => { confirmations += 1; return false; };
    document.querySelector('#deleteDraftButton').click();
    const afterCancel = {
      noticeVisible: !document.querySelector('#draftNotice').hidden,
      draftStored: localStorage.getItem('test-remote-draft') !== null
    };
    window.confirm = () => { confirmations += 1; return true; };
    document.querySelector('#deleteDraftButton').click();
    while (!document.querySelector('#draftNotice').hidden) await new Promise(resolve => setTimeout(resolve, 0));
    return JSON.stringify({
      savedCount,
      noticeBefore,
      actionsAdjacent,
      confirmations,
      afterCancel,
      noticeAfter: !document.querySelector('#draftNotice').hidden,
      draftStoredAfter: localStorage.getItem('test-remote-draft') !== null,
      historyCountAfter: document.querySelectorAll('.invoice-record').length,
      toast: document.querySelector('#toast').textContent
    });
  })()`));
  assert.deepEqual(deleteDraftBehavior, {
    savedCount: 1,
    noticeBefore: true,
    actionsAdjacent: true,
    confirmations: 2,
    afterCancel: { noticeVisible: true, draftStored: true },
    noticeAfter: false,
    draftStoredAfter: false,
    historyCountAfter: 1,
    toast: "Unsaved draft deleted."
  });

  await evaluate(page, `(() => {
    localStorage.setItem('test-original-invoices', localStorage.getItem('test-remote-invoices'));
    const records = Array.from({ length: 31 }, (_, index) => ({
      id: 'pagination-' + String(index).padStart(2, '0'),
      revision: 1,
      createdAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
      invoice: {
        invoiceNumber: 'EHR-PAGE-' + String(index + 1).padStart(3, '0'),
        pdfFileName: 'EHR-PAGE-' + String(index + 1).padStart(3, '0'),
        invoiceDate: '2026-07-01',
        dueDate: '2026-07-08',
        billTo: index === 7 ? 'Needle Customer' : 'Pagination Customer ' + index,
        items: [{ id: 'item-' + index, quantity: 1, description: 'Market space', price: '25' }]
      }
    }));
    localStorage.setItem('test-remote-invoices', JSON.stringify(records));
    location.reload();
  })()`);
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && document.querySelectorAll('.invoice-record').length === 25 && !document.querySelector('#loadMoreInvoicesButton').hidden"));
  await evaluate(page, "document.querySelector('#loadMoreInvoicesButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelectorAll('.invoice-record').length === 31 && document.querySelector('#loadMoreInvoicesButton').hidden"));
  await evaluate(page, `(() => {
    const search = document.querySelector('#invoiceSearch');
    search.value = 'Needle Customer';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(page, "document.querySelectorAll('.invoice-record').length === 1 && document.querySelector('#invoiceCount').textContent === '1 of 1 invoice'"));
  const paginationBehavior = JSON.parse(await evaluate(page, `JSON.stringify({
    onlyCustomer: document.querySelector('.invoice-customer').textContent,
    calls: window.__BROWSER_BACKEND_MOCK__.controls.listCalls,
    loadingHidden: document.querySelector('#historyLoadingState').hidden,
    errorHidden: document.querySelector('#historyErrorState').hidden
  })`));
  assert.equal(paginationBehavior.onlyCustomer, "NEEDLE CUSTOMER");
  assert.equal(paginationBehavior.loadingHidden, true);
  assert.equal(paginationBehavior.errorHidden, true);
  assert.ok(paginationBehavior.calls.some((call) => call.limit === 25 && call.cursor));
  assert.ok(paginationBehavior.calls.some((call) => call.query === "Needle Customer"));
  await evaluate(page, `(() => {
    localStorage.setItem('test-remote-invoices', localStorage.getItem('test-original-invoices'));
    localStorage.removeItem('test-original-invoices');
    location.reload();
  })()`);
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && document.querySelectorAll('.invoice-record').length === 1"));

  await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
  const mobileHistoryLayout = JSON.parse(await evaluate(page, `JSON.stringify({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    datesFit: [...document.querySelectorAll('.invoice-record-meta div:first-child dd')].every(date => date.scrollWidth <= date.clientWidth),
    records: [...document.querySelectorAll('.invoice-record')].map(record => {
      const rect = record.getBoundingClientRect();
      return { left: rect.left, right: rect.right, actionWidths: [...record.querySelectorAll('.button')].map(button => button.getBoundingClientRect().width) };
    })
  })`));
  assert.ok(mobileHistoryLayout.documentWidth <= mobileHistoryLayout.viewport);
  assert.equal(mobileHistoryLayout.datesFit, true);
  assert.ok(mobileHistoryLayout.records.every(record => record.left >= 0 && record.right <= mobileHistoryLayout.viewport));
  assert.ok(mobileHistoryLayout.records.every(record => record.actionWidths.every(width => width >= 44)));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  let signOutPoint;
  for (const width of [842, 375]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    signOutPoint = JSON.parse(await evaluate(page, `(async () => {
      window.scrollTo(0, 0);
      window.__signOutConfirmCalls = 0;
      window.confirm = () => { window.__signOutConfirmCalls += 1; return false; };
      window.__pendingSignOutOperation = await window.invoiceDraftOutbox.putSave('test-user-1', {
        invoiceNumber: 'EHR-RECOVERY-001',
        billTo: 'Recovered customer'
      });
      const button = document.querySelector('#signOutButton');
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return JSON.stringify({ x, y, hit: button.contains(document.elementFromPoint(x, y)) });
    })()`));
    assert.equal(signOutPoint.hit, true, `${width}px Sign out must be reachable without a scripted DOM click`);
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: signOutPoint.x, y: signOutPoint.y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: signOutPoint.x, y: signOutPoint.y, button: "left", clickCount: 1 });
    await waitFor(() => evaluate(page, "window.__signOutConfirmCalls === 1 && !document.querySelector('#signOutButton').disabled"));
    const blockedSignOut = JSON.parse(await evaluate(page, `(async () => {
      const result = {
        page: document.body.dataset.page,
        status: document.querySelector('#syncStatus').textContent,
        signOutCalls: window.__BROWSER_BACKEND_MOCK__.controls.signOutCalls,
        pending: await window.invoiceDraftOutbox.has('test-user-1')
      };
      await window.invoiceDraftOutbox.remove('test-user-1', window.__pendingSignOutOperation.operationId);
      return JSON.stringify(result);
    })()`));
    assert.deepEqual(blockedSignOut, {
      page: "history",
      status: "Sync this draft before signing out",
      signOutCalls: 0,
      pending: true,
    });
  }

  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: signOutPoint.x, y: signOutPoint.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: signOutPoint.x, y: signOutPoint.y, button: "left", clickCount: 1 });
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'auth' && !document.querySelector('#authPage').hidden"));
  for (const width of [375, 842, 1440]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    assert.equal(await evaluate(page, "document.querySelector('#accountControls').getClientRects().length"), 0, `${width}px signed-out account controls must respect hidden`);
  }
  const signedOutState = JSON.parse(await evaluate(page, `JSON.stringify({
    title: document.querySelector('#authTitle').textContent,
    historyHidden: document.querySelector('#invoiceListPage').hidden,
    accountHidden: document.querySelector('#accountControls').hidden,
    remoteInvoices: JSON.parse(localStorage.getItem('test-remote-invoices') || '[]').length,
    passwordMinimum: document.querySelector('#authPassword').minLength,
    emailValue: document.querySelector('#authEmail').value,
    passwordValue: document.querySelector('#authPassword').value,
    recoveryPasswordValue: document.querySelector('#recoveryPassword').value,
    recoveryConfirmValue: document.querySelector('#recoveryPasswordConfirm').value,
    billToValue: document.querySelector('#billTo').value,
    previewBillTo: document.querySelector('#previewBillTo').textContent,
    renderedHistoryRecords: document.querySelectorAll('.invoice-record').length
  })`));
  assert.deepEqual(signedOutState, {
    title: "Sign in",
    historyHidden: true,
    accountHidden: true,
    remoteInvoices: 1,
    passwordMinimum: 6,
    emailValue: "",
    passwordValue: "",
    recoveryPasswordValue: "",
    recoveryConfirmValue: "",
    billToValue: "",
    previewBillTo: "",
    renderedHistoryRecords: 0,
  });

  await evaluate(page, `(() => {
    document.querySelector('#authEmail').value = 'pending-owner@example.com';
    document.querySelector('#authPassword').value = 'secure-pass-123';
    window.__BROWSER_BACKEND_MOCK__.controls.nextSignInError = {
      code: 'email_not_confirmed',
      status: 400,
      message: 'Email not confirmed'
    };
    document.querySelector('#authForm').requestSubmit();
  })()`);
  await waitFor(() => evaluate(page, "document.querySelector('#authMessage').textContent.includes('Confirm your email before signing in')"));

  await evaluate(page, `(() => {
    document.querySelector('#authPassword').value = 'secure-pass-123';
    window.__BROWSER_BACKEND_MOCK__.controls.nextSignUpError = {
      code: 'over_email_send_rate_limit',
      status: 429,
      message: 'For security purposes, you can only request this after 42 seconds.'
    };
    document.querySelector('#createAccountButton').click();
  })()`);
  await waitFor(() => evaluate(page, "document.querySelector('#authMessage').textContent.includes('Wait 42 seconds')"));
  assert.deepEqual(JSON.parse(await evaluate(page, `JSON.stringify({
    createDisabled: document.querySelector('#createAccountButton').disabled,
    resetDisabled: document.querySelector('#forgotPasswordButton').disabled,
    signUpCalls: window.__BROWSER_BACKEND_MOCK__.controls.signUpCalls
  })`)), { createDisabled: true, resetDisabled: true, signUpCalls: 1 });

  await evaluate(page, `(() => {
    const email = document.querySelector('#authEmail');
    email.value = 'new-owner@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#authPassword').value = 'secure-pass-123';
    document.querySelector('#createAccountButton').click();
  })()`);
  await waitFor(() => evaluate(page, "document.querySelector('#authMessage').textContent.includes('Check your email')"));
  assert.deepEqual(JSON.parse(await evaluate(page, `JSON.stringify({
    createDisabled: document.querySelector('#createAccountButton').disabled,
    resetDisabled: document.querySelector('#forgotPasswordButton').disabled,
    signUpCalls: window.__BROWSER_BACKEND_MOCK__.controls.signUpCalls
  })`)), { createDisabled: true, resetDisabled: true, signUpCalls: 2 });

  await evaluate(page, `(() => {
    const email = document.querySelector('#authEmail');
    email.value = 'recovery-owner@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(page, "document.querySelector('#forgotPasswordButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelector('#authMessage').textContent.includes('reset link')"));

  await evaluate(page, `(() => {
    const email = document.querySelector('#authEmail');
    email.value = 'quota-test@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#authPassword').value = 'secure-pass-123';
    window.__BROWSER_BACKEND_MOCK__.controls.nextSignUpError = {
      code: 'over_email_send_rate_limit',
      status: 429,
      message: 'email rate limit exceeded'
    };
    document.querySelector('#createAccountButton').click();
  })()`);
  await waitFor(() => evaluate(page, "document.querySelector('#authMessage').textContent.includes('email service limit')"));
  const sharedQuotaState = JSON.parse(await evaluate(page, `(() => {
    const email = document.querySelector('#authEmail');
    email.value = 'another-address@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({
      createDisabled: document.querySelector('#createAccountButton').disabled,
      resetDisabled: document.querySelector('#forgotPasswordButton').disabled,
      signInDisabled: document.querySelector('#signInButton').disabled
    });
  })()`));
  assert.deepEqual(sharedQuotaState, { createDisabled: true, resetDisabled: true, signInDisabled: false });

  await evaluate(page, `(() => {
    const email = document.querySelector('#authEmail');
    email.value = 'new-owner@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#authPassword').value = 'secure-pass-123';
    document.querySelector('#authForm').requestSubmit();
  })()`);
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && document.querySelectorAll('.invoice-record').length === 1"));
  assert.equal(await evaluate(page, "document.querySelector('#accountEmail').textContent"), "new-owner@example.com");

  await evaluate(page, "window.__BROWSER_BACKEND_MOCK__.emitPasswordRecovery(); true");
  await waitFor(() => evaluate(page, "!document.querySelector('#passwordRecoveryForm').hidden"));
  await evaluate(page, `(() => {
    document.querySelector('#recoveryPassword').value = 'replacement-pass-123';
    document.querySelector('#recoveryPasswordConfirm').value = 'replacement-pass-123';
    document.querySelector('#passwordRecoveryForm').requestSubmit();
  })()`);
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && document.querySelector('#passwordRecoveryForm').hidden"));

  await evaluate(page, `(() => {
    const invoice = {
      draftDirty: false,
      invoiceNumber: 'EHR-20260819-099',
      pdfFileName: 'EHR-20260819-099',
      pdfFileNameCustomized: false,
      invoiceDate: '2026-08-19',
      dueDate: '2026-08-26',
      billTo: 'Migrated Customer',
      items: [{ id: 'legacy-item', quantity: 1, description: 'Migrated service', price: 88 }]
    };
    localStorage.setItem('invoice-studio-history-v1', JSON.stringify([{ id: 'legacy-record', createdAt: '2026-08-19T01:00:00.000Z', updatedAt: '2026-08-19T01:00:00.000Z', invoice }]));
    localStorage.setItem('invoice-studio-draft-v1', JSON.stringify({ ...invoice, historyId: undefined, draftDirty: true, invoiceNumber: 'EHR-20260819-100', billTo: 'Migrated Draft' }));
    localStorage.setItem('invoice-studio-sequence-v1', JSON.stringify({ date: '20260819', sequence: 100 }));
    location.reload();
  })()`);
  await waitFor(() => evaluate(page, "document.querySelector('#legacyMigrationDialog').open"));
  const migrationConsent = JSON.parse(await evaluate(page, `JSON.stringify({
    summary: document.querySelector('#legacyMigrationSummary').textContent,
    destination: document.querySelector('#legacyMigrationDestination').textContent,
    choices: [
      'moveLegacyDataButton', 'exportLegacyDataButton', 'discardLegacyDataButton', 'cancelLegacyMigrationButton'
    ].map(id => document.getElementById(id).textContent),
    legacyStillLocal: localStorage.getItem('invoice-studio-history-v1') !== null
      && localStorage.getItem('invoice-studio-draft-v1') !== null
  })`));
  assert.deepEqual(migrationConsent, {
    summary: "1 saved invoice and 1 draft",
    destination: "owner@example.com",
    choices: ["Move to this account", "Export a backup", "Discard local copy", "Cancel sign-in"],
    legacyStillLocal: true,
  });
  await evaluate(page, "document.querySelector('#exportLegacyDataButton').click(); true");
  await waitFor(() => evaluate(page, "document.querySelector('#legacyMigrationMessage').textContent.includes('Backup downloaded')"));
  assert.equal(await evaluate(page, "localStorage.getItem('invoice-studio-history-v1') !== null"), true);
  await evaluate(page, "document.querySelector('#moveLegacyDataButton').click(); true");
  await waitFor(() => evaluate(page, "document.body.dataset.page === 'history' && document.querySelectorAll('.invoice-record').length === 2 && !document.querySelector('#draftNotice').hidden"));
  const migrationState = JSON.parse(await evaluate(page, `JSON.stringify({
    legacyHistoryRemoved: localStorage.getItem('invoice-studio-history-v1') === null,
    legacyDraftRemoved: localStorage.getItem('invoice-studio-draft-v1') === null,
    legacySequenceRemoved: localStorage.getItem('invoice-studio-sequence-v1') === null,
    remoteCount: JSON.parse(localStorage.getItem('test-remote-invoices') || '[]').length,
    draftSummary: document.querySelector('#draftNoticeSummary').textContent,
    toast: document.querySelector('#toast').textContent
  })`));
  assert.deepEqual(migrationState, {
    legacyHistoryRemoved: true,
    legacyDraftRemoved: true,
    legacySequenceRemoved: true,
    remoteCount: 2,
    draftSummary: "EHR-20260819-100 for MIGRATED DRAFT, $88.00",
    toast: "Existing browser invoices were moved to your account."
  });

  const optimisticConflictCodes = JSON.parse(await evaluate(page, `(async () => {
    const { records } = await window.invoiceBackend.listInvoices('test-user-1');
    const staleInvoice = records[0];
    await window.invoiceBackend.saveInvoice('test-user-1', { ...staleInvoice, invoice: { ...staleInvoice.invoice, billTo: 'Other session' } });
    let invoiceCode = '';
    try {
      await window.invoiceBackend.saveInvoice('test-user-1', { ...staleInvoice, invoice: { ...staleInvoice.invoice, billTo: 'Stale session' } });
    } catch (error) {
      invoiceCode = error.code;
    }

    const staleDraft = await window.invoiceBackend.loadDraft('test-user-1');
    await window.invoiceBackend.saveDraft('test-user-1', staleDraft.invoice, undefined, staleDraft.revision);
    let draftCode = '';
    try {
      await window.invoiceBackend.saveDraft('test-user-1', staleDraft.invoice, undefined, staleDraft.revision);
    } catch (error) {
      draftCode = error.code;
    }
    return JSON.stringify({ invoiceCode, draftCode });
  })()`));
  assert.deepEqual(optimisticConflictCodes, {
    invoiceCode: "INVOICE_REVISION_CONFLICT",
    draftCode: "DRAFT_REVISION_CONFLICT",
  });

  const backendSource = await readFile(join(ROOT, "backend.js"), "utf8");
  assert.match(backendSource, /invoice-studio-history-v1/);
  assert.match(backendSource, /localMode: true/);
  assert.match(backendSource, /error\.code = "INVOICE_REVISION_CONFLICT"/);
  assert.deepEqual(runtimeExceptions, [], `Unexpected runtime exceptions:\n${runtimeExceptions.join("\n")}`);
  assert.deepEqual(browserErrors, [], `Unexpected browser errors:\n${browserErrors.join("\n")}`);

  const cacheReady = await waitFor(() => evaluate(page, "caches.keys().then(keys => keys.includes('invoice-studio-v79'))"));
  assert.equal(cacheReady, true);
  const workerSource = await readFile(join(ROOT, "sw.js"), "utf8");
  const handlers = {};
  const deletedCaches = [];
  const cacheKeys = ["invoice-studio-v1", "invoice-studio-v27", "invoice-studio-v28", "invoice-studio-v29", "invoice-studio-v30", "invoice-studio-v31", "invoice-studio-v32", "invoice-studio-v33", "invoice-studio-v34", "invoice-studio-v35", "invoice-studio-v36", "invoice-studio-v37", "invoice-studio-v38", "invoice-studio-v39", "invoice-studio-v40", "invoice-studio-v41", "invoice-studio-v42", "invoice-studio-v43", "invoice-studio-v44", "invoice-studio-v45", "invoice-studio-v46", "invoice-studio-v47", "invoice-studio-v48", "invoice-studio-v49", "invoice-studio-v79", "unrelated-app-cache"];
  const workerCache = { match: async () => undefined, put: async () => {} };
  const workerContext = {
    URL,
    Response,
    caches: {
      open: async () => workerCache,
      keys: async () => cacheKeys,
      delete: async (key) => { deletedCaches.push(key); return true; },
    },
    self: {
      location: new URL("https://example.test/invoice-studio/"),
      registration: { scope: "https://example.test/invoice-studio/", active: {} },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      clients: { claim: async () => {} },
      skipWaiting: () => {},
    },
  };
  vm.runInNewContext(workerSource, workerContext);
  let activation;
  handlers.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(deletedCaches, ["invoice-studio-v1", "invoice-studio-v27", "invoice-studio-v28", "invoice-studio-v29", "invoice-studio-v30", "invoice-studio-v31", "invoice-studio-v32", "invoice-studio-v33", "invoice-studio-v34", "invoice-studio-v35", "invoice-studio-v36", "invoice-studio-v37", "invoice-studio-v38", "invoice-studio-v39", "invoice-studio-v40", "invoice-studio-v41", "invoice-studio-v42", "invoice-studio-v43", "invoice-studio-v44", "invoice-studio-v45", "invoice-studio-v46", "invoice-studio-v47", "invoice-studio-v48", "invoice-studio-v49"]);

  if (!await evaluate(page, "Boolean(navigator.serviceWorker.controller)")) {
    await page.send("Page.reload", { ignoreCache: true });
    await waitFor(() => evaluate(page, "document.readyState === 'complete' && Boolean(navigator.serviceWorker.controller)"));
  }
  assert.equal(await evaluate(page, "Boolean(navigator.serviceWorker.controller)"), true);
  await page.send("Network.enable");
  await page.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: "none",
  });
  await evaluate(page, "window.__offlineReloadMarker = 'before'");
  await stopServer(server);
  // A hard reload bypasses the service worker; verify a normal offline reload.
  await page.send("Page.reload");
  await waitFor(() => evaluate(page, "document.readyState === 'complete' && document.querySelector('#invoiceForm') !== null && typeof window.__offlineReloadMarker === 'undefined'"), 8000);
  assert.equal(await evaluate(page, "typeof window.__offlineReloadMarker"), "undefined");
  assert.equal(await evaluate(page, "typeof window.html2pdf"), "undefined");
  assert.equal(await evaluate(page, "document.querySelector('script[data-pdf-library]') === null"), true);
  await page.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: "none",
  });
});
