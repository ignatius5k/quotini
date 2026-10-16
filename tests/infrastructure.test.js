"use strict";

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = join(__dirname, "..");
const SCOPE = "https://example.test/invoice-studio/";

function assertBackupContentsEqual(actual, expected, message) {
  assert.match(actual.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(expected.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const actualContents = { ...actual };
  const expectedContents = { ...expected };
  delete actualContents.exportedAt;
  delete expectedContents.exportedAt;
  assert.equal(JSON.stringify(actualContents), JSON.stringify(expectedContents), message);
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function pngColorType(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return buffer.readUInt8(25);
}

function jpegDimensions(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = buffer.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  throw new Error("JPEG dimensions were not found.");
}

async function loadWorker(initialFetch = async () => new Response("network")) {
  const source = await readFile(join(ROOT, "sw.js"), "utf8");
  const handlers = {};
  const stores = new Map();
  const deletedCaches = [];
  const cachePuts = [];
  const cacheAdditions = [];
  let skipWaitingCalls = 0;
  let clientsClaimed = 0;
  let fetchImplementation = initialFetch;

  function requestKey(request) {
    return typeof request === "string" ? new URL(request, SCOPE).href : request.url;
  }

  function cacheFor(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async addAll(entries) {
        cacheAdditions.push(...entries);
      },
      async match(request) {
        return store.get(requestKey(request));
      },
      async put(request, response) {
        const key = requestKey(request);
        cachePuts.push({ cacheName: name, key });
        store.set(key, response);
      },
    };
  }

  const context = {
    URL,
    Response,
    caches: {
      async open(name) {
        return cacheFor(name);
      },
      async keys() {
        return [...stores.keys()];
      },
      async delete(name) {
        deletedCaches.push(name);
        return stores.delete(name);
      },
    },
    fetch: (...args) => fetchImplementation(...args),
    self: {
      location: new URL(SCOPE),
      registration: { scope: SCOPE, active: {} },
      clients: { claim: async () => { clientsClaimed += 1; } },
      skipWaiting: () => { skipWaitingCalls += 1; },
      addEventListener(name, handler) {
        handlers[name] = handler;
      },
    },
  };
  vm.runInNewContext(source, context);

  return {
    handlers,
    stores,
    deletedCaches,
    cachePuts,
    cacheAdditions,
    setFetch(nextFetch) {
      fetchImplementation = nextFetch;
    },
    get skipWaitingCalls() {
      return skipWaitingCalls;
    },
    get clientsClaimed() {
      return clientsClaimed;
    },
  };
}

function dispatchFetch(handler, request) {
  const lifetime = [];
  let responsePromise;
  handler({
    request,
    respondWith(value) {
      responsePromise = Promise.resolve(value);
    },
    waitUntil(value) {
      lifetime.push(Promise.resolve(value));
    },
  });
  return {
    lifetime,
    response: () => responsePromise,
  };
}

test("logo assets retain their established dimensions", async () => {
  const [logoPng, logoJpeg, ledgerlyMark, icon192, icon512] = await Promise.all([
    readFile(join(ROOT, "eng-hoon-residences-logo.png")),
    readFile(join(ROOT, "eng-hoon-residences-logo.jpeg")),
    readFile(join(ROOT, "ledgerly-mark.png")),
    readFile(join(ROOT, "icon-192.png")),
    readFile(join(ROOT, "icon-512.png")),
  ]);
  assert.deepEqual(pngDimensions(logoPng), { width: 600, height: 530 });
  assert.deepEqual(jpegDimensions(logoJpeg), { width: 256, height: 260 });
  assert.deepEqual(pngDimensions(ledgerlyMark), { width: 500, height: 500 });
  assert.deepEqual(pngDimensions(icon192), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions(icon512), { width: 512, height: 512 });
  assert.equal(pngColorType(icon192), 2, "the small PWA icon must use an opaque RGB canvas");
  assert.equal(pngColorType(icon512), 2, "the large PWA icon must use an opaque RGB canvas");
});

test("service-worker updates wait for an explicit activation request", async () => {
  const worker = await loadWorker();
  let installation;
  worker.handlers.install({ waitUntil(value) { installation = value; } });
  await installation;
  assert.equal(worker.skipWaitingCalls, 0);
  assert.ok(worker.cacheAdditions.includes("./index.html"));
  assert.ok(worker.cacheAdditions.includes("./ledgerly-mark.png?v=79"));
  assert.ok(worker.cacheAdditions.includes("./eng-hoon-residences-logo.png?v=79"));
  assert.ok(worker.cacheAdditions.includes("./icon-192.png?v=79"));
  assert.ok(worker.cacheAdditions.includes("./icon-512.png?v=79"));
  assert.equal(worker.cacheAdditions.includes("./vendor/html2pdf.bundle.min.js?v=33"), false);

  worker.handlers.message({ data: { type: "SKIP_WAITING" } });
  assert.equal(worker.skipWaitingCalls, 1);
});

test("activation removes only previous Quotini shell caches", async () => {
  const worker = await loadWorker();
  worker.stores.set("invoice-studio-v1", new Map());
  worker.stores.set("invoice-studio-v27", new Map());
  worker.stores.set("invoice-studio-v28", new Map());
  worker.stores.set("invoice-studio-v29", new Map());
  worker.stores.set("invoice-studio-v30", new Map());
  worker.stores.set("invoice-studio-v31", new Map());
  worker.stores.set("invoice-studio-v32", new Map());
  worker.stores.set("invoice-studio-v33", new Map());
  worker.stores.set("invoice-studio-v34", new Map());
  const runtimeUrl = `${SCOPE}vendor/html2pdf.bundle.min.js?v=33`;
  worker.stores.set("invoice-studio-v35", new Map());
  worker.stores.set("invoice-studio-v36", new Map());
  worker.stores.set("invoice-studio-v37", new Map([[runtimeUrl, new Response("warmed PDF runtime")]]));
  worker.stores.set("invoice-studio-v38", new Map());
  worker.stores.set("invoice-studio-v39", new Map());
  worker.stores.set("invoice-studio-v40", new Map());
  worker.stores.set("invoice-studio-v41", new Map());
  worker.stores.set("invoice-studio-v42", new Map());
  worker.stores.set("invoice-studio-v43", new Map());
  worker.stores.set("invoice-studio-v44", new Map());
  worker.stores.set("invoice-studio-v45", new Map());
  worker.stores.set("invoice-studio-v46", new Map());
  worker.stores.set("invoice-studio-v47", new Map());
  worker.stores.set("invoice-studio-v48", new Map());
  worker.stores.set("invoice-studio-v49", new Map());
  worker.stores.set("unrelated-cache", new Map());
  let activation;
  worker.handlers.activate({ waitUntil(value) { activation = value; } });
  await activation;
  assert.deepEqual(worker.deletedCaches, ["invoice-studio-v1", "invoice-studio-v27", "invoice-studio-v28", "invoice-studio-v29", "invoice-studio-v30", "invoice-studio-v31", "invoice-studio-v32", "invoice-studio-v33", "invoice-studio-v34", "invoice-studio-v35", "invoice-studio-v36", "invoice-studio-v37", "invoice-studio-v38", "invoice-studio-v39", "invoice-studio-v40", "invoice-studio-v41", "invoice-studio-v42", "invoice-studio-v43", "invoice-studio-v44", "invoice-studio-v45", "invoice-studio-v46", "invoice-studio-v47", "invoice-studio-v48", "invoice-studio-v49"]);
  assert.equal(await (await worker.stores.get("invoice-studio-v79").get(runtimeUrl)).text(), "warmed PDF runtime");
  assert.equal(worker.clientsClaimed, 1);
  assert.equal(worker.stores.has("unrelated-cache"), true);
});

test("query-string navigations are network-only and never cached", async () => {
  const worker = await loadWorker(async () => new Response("callback"));
  const event = dispatchFetch(worker.handlers.fetch, {
    method: "GET",
    mode: "navigate",
    url: `${SCOPE}?code=authentication-code`,
  });
  assert.equal(await (await event.response()).text(), "callback");
  assert.equal(event.lifetime.length, 0);
  assert.deepEqual(worker.cachePuts, []);
});

test("only managed shell and runtime requests are cached and used offline", async () => {
  const shellUrl = `${SCOPE}app.js?v=79`;
  const worker = await loadWorker(async () => new Response("fresh shell"));
  const onlineEvent = dispatchFetch(worker.handlers.fetch, {
    method: "GET",
    mode: "same-origin",
    url: shellUrl,
  });
  assert.equal(await (await onlineEvent.response()).text(), "fresh shell");
  await Promise.all(onlineEvent.lifetime);
  assert.deepEqual(worker.cachePuts, [{ cacheName: "invoice-studio-v79", key: shellUrl }]);

  const runtimeUrl = `${SCOPE}vendor/html2pdf.bundle.min.js?v=33`;
  const runtimeEvent = dispatchFetch(worker.handlers.fetch, {
    method: "GET",
    mode: "same-origin",
    url: runtimeUrl,
  });
  assert.equal(await (await runtimeEvent.response()).text(), "fresh shell");
  await Promise.all(runtimeEvent.lifetime);
  assert.deepEqual(worker.cachePuts, [
    { cacheName: "invoice-studio-v79", key: shellUrl },
    { cacheName: "invoice-studio-v79", key: runtimeUrl },
  ]);

  worker.setFetch(async () => { throw new Error("offline"); });
  const offlineEvent = dispatchFetch(worker.handlers.fetch, {
    method: "GET",
    mode: "same-origin",
    url: shellUrl,
  });
  assert.equal(await (await offlineEvent.response()).text(), "fresh shell");

  const unknownEvent = dispatchFetch(worker.handlers.fetch, {
    method: "GET",
    mode: "same-origin",
    url: `${SCOPE}not-in-shell.json`,
  });
  assert.equal(unknownEvent.response(), undefined);
});

test("device-local backend persists revision-safe invoices and drafts", async () => {
  const source = await readFile(join(ROOT, "backend.js"), "utf8");
  const values = new Map();
  let restoreFailureMode = false;
  let restoreFailureTriggered = false;
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (restoreFailureMode && (restoreFailureTriggered || key === "invoice-studio-draft-v1")) {
        restoreFailureTriggered = true;
        throw new Error("Quota denied during restore");
      }
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const window = { localStorage };
  vm.runInNewContext(source, { window });
  const backend = window.invoiceBackend;

  assert.equal(backend.configured, true);
  assert.equal(backend.guestMode, true);
  assert.equal(backend.localMode, true);
  assert.equal((await backend.getSession()).user.id, "local-guest");

  const invoice = {
    invoiceNumber: "EHR-20260819-001",
    pdfFileName: "EHR-20260819-001",
    invoiceDate: "2026-08-19",
    dueDate: "2026-08-26",
    billTo: "Guest customer",
    items: [{ id: "item-1", quantity: 1, description: "Market space", price: 100 }],
  };
  const saved = await backend.saveInvoice("local-guest", {
    id: "invoice-1",
    createdAt: "2026-08-19T00:00:00.000Z",
    invoice,
  });
  assert.equal(saved.revision, 1);
  const updated = await backend.saveInvoice("local-guest", {
    ...saved,
    invoice: { ...saved.invoice, billTo: "Updated customer" },
  });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    backend.saveInvoice("local-guest", saved),
    (error) => error.code === "INVOICE_REVISION_CONFLICT",
  );
  const page = await backend.listInvoices("local-guest", { query: "updated" });
  assert.equal(page.total, 1);
  assert.equal(page.records[0].invoice.billTo, "Updated customer");
  const duplicate = await backend.saveInvoice("local-guest", {
    id: "invoice-2",
    createdAt: "2026-08-20T00:00:00.000Z",
    invoice: { ...updated.invoice },
  });
  assert.equal(duplicate.invoice.invoiceNumber, updated.invoice.invoiceNumber);
  assert.equal((await backend.listInvoices("local-guest")).total, 2);

  const firstDraft = await backend.saveDraft("local-guest", invoice);
  assert.equal(firstDraft.revision, 1);
  const loadedDraft = await backend.loadDraft("local-guest");
  assert.equal(loadedDraft.invoice.invoiceNumber, invoice.invoiceNumber);
  const secondDraft = await backend.saveDraft("local-guest", { ...invoice, billTo: "Draft update" }, undefined, 1);
  assert.equal(secondDraft.revision, 2);
  await assert.rejects(
    backend.saveDraft("local-guest", invoice, undefined, 1),
    (error) => error.code === "DRAFT_REVISION_CONFLICT",
  );
  await backend.deleteDraft("local-guest", undefined, 2);
  assert.equal(await backend.loadDraft("local-guest"), null);

  const invoiceNumber = await backend.nextInvoiceNumber("2026-08-19");
  assert.equal(invoiceNumber, "EHR-20260819-002");
  assert.equal(values.has("invoice-studio-sequence-v1"), false, "previewing the next number must not consume it");
  assert.equal(await backend.reserveInvoiceNumber("2026-08-19"), "EHR-20260819-002");
  assert.equal(JSON.parse(values.get("invoice-studio-sequence-v1")).sequence, 2, "opening a new invoice reserves its number");
  values.delete("invoice-studio-sequence-v1");

  const backup = backend.exportLocalData();
  await assert.rejects(
    backend.deleteInvoice("local-guest", duplicate.id, 99),
    (error) => error.code === "INVOICE_REVISION_CONFLICT",
  );
  assert.equal(await backend.deleteInvoice("local-guest", duplicate.id, duplicate.revision), true);
  assert.equal((await backend.listInvoices("local-guest")).total, 1);
  backend.restoreLocalData(backup);
  assert.equal((await backend.listInvoices("local-guest")).total, 2);

  const duplicateIds = JSON.parse(values.get("invoice-studio-history-v1"));
  duplicateIds[1].id = duplicateIds[0].id;
  values.set("invoice-studio-history-v1", JSON.stringify(duplicateIds));
  const repaired = await backend.listInvoices("local-guest");
  assert.equal(repaired.total, 2);
  assert.equal(new Set(repaired.records.map((record) => record.id)).size, 2);
  for (const record of repaired.records) {
    assert.equal(await backend.deleteInvoice("local-guest", record.id, record.revision), true);
  }
  assert.equal(values.has("invoice-studio-sequence-v1"), true, "deleting a committed invoice must preserve its sequence");
  assert.equal(await backend.nextInvoiceNumber("2026-08-19"), "EHR-20260819-002");

  await backend.saveInvoice("local-guest", { id: "protected-invoice", invoice });
  await backend.saveDraft("local-guest", { ...invoice, billTo: "Protected draft" });
  const protectedBackup = backend.exportLocalData();
  const replacementBackup = {
    ...protectedBackup,
    history: [{ id: "replacement-invoice", invoice: { ...invoice, billTo: "Replacement" } }],
    draft: { ...invoice, billTo: "Replacement draft" },
  };
  restoreFailureMode = true;
  await assert.rejects(
    Promise.resolve().then(() => backend.restoreLocalData(replacementBackup)),
    (error) => error.code === "LOCAL_STORAGE_UNAVAILABLE",
  );
  assertBackupContentsEqual(backend.exportLocalData(), protectedBackup, "a failed restore must expose the complete earlier dataset");
  restoreFailureMode = false;
  await backend.getSession();
  assert.equal(values.has("invoice-studio-restore-journal-v1"), false);
  assertBackupContentsEqual(backend.exportLocalData(), protectedBackup);

  values.set("invoice-studio-history-v1", "{broken-json");
  await assert.rejects(
    backend.listInvoices("local-guest"),
    (error) => error.code === "LOCAL_DATA_CORRUPT" && error.storageKey === "invoice-studio-history-v1",
  );
  const recoveryBackup = backend.exportLocalData();
  assert.equal(recoveryBackup.history.unreadableRawValue, "{broken-json");
  backend.clearLocalData();
  assert.equal((await backend.listInvoices("local-guest")).total, 0);
});
