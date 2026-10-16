import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { getBytes, getMetadata, ref, uploadBytes, listAll } from "firebase/storage";
import { createFirebaseInvoiceBackend } from "../firebase-backend.mjs";
import browserHelpers from "./browser-helpers.js";

const { connectCdp, evaluate, findChromePath, waitFor } = browserHelpers;
const projectId = "demo-ledgerly";
const bucket = `${projectId}.appspot.com`;
function emulatorPort(name) {
  const match = process.env[name]?.match(/^(?:localhost|127[.]0[.]0[.]1):(\d+)$/);
  if (!match) throw new Error(`${name} must identify a local emulator. These tests must never contact production.`);
  return Number(match[1]);
}
const ports = {
  auth: emulatorPort("FIREBASE_AUTH_EMULATOR_HOST"),
  firestore: emulatorPort("FIRESTORE_EMULATOR_HOST"),
  storage: emulatorPort("FIREBASE_STORAGE_EMULATOR_HOST"),
};
const runId = randomUUID();
const password = "Pdf-emulator-test-123!";
const email = `pdf-${runId}@example.test`;
const config = { apiKey: "fake-emulator-key", projectId, appId: "pdf-storage-test", authDomain: `${projectId}.firebaseapp.com`, storageBucket: bucket };
const source = "%PDF-1.7\nQuotini emulator PDF bytes\n%%EOF\n";
const pdf = () => new Blob([source], { type: "application/pdf" });
const invoice = () => ({
  invoiceNumber: "PDF-STORAGE-TEST", invoiceDate: "2026-09-17", dueDate: "2026-09-24",
  pdfFileName: "test-pdf", pdfFileNameCustomized: true, billTo: "STORAGE EMULATOR CUSTOMER",
  items: [{ id: "line-1", quantity: 1, description: "Test only", price: 100 }],
});
const clients = [];
let rules;
let alice;
let bob;
let uid;
let bobUid;
function client(name, webConfig = config, environment) {
  const selected = new Map();
  environment = { ...environment, sessionStorage: { getItem: key => selected.get(key), setItem: (key, value) => selected.set(key, value) } };
  const backend = createFirebaseInvoiceBackend(webConfig, null, {
    appName: `pdf-${name}-${runId}`, memoryAuth: true, emulators: ports, environment,
  });
  clients.push(backend);
  return backend;
}
const savedInvoice = (id) => alice.saveInvoice(uid, { id: `pdf-${runId}-${id}`, invoice: invoice() });
const pathOf = (record) => `users/${uid}/invoices/${record.id}/revisions/${record.revision}.pdf`;
function uploadMetadata(record) {
  const canonical = JSON.stringify(record.invoice, function (key, value) {
    if (key === "historyRevision") return undefined;
    return value && !Array.isArray(value) && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, value[name]])) : value;
  });
  return { contentType: "application/pdf", customMetadata: {
    invoiceId: record.id, revision: String(record.revision), invoiceFingerprint: createHash("sha256").update(canonical).digest("hex"),
  } };
}

before(async () => {
  rules = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: ports.firestore, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") },
    storage: { host: "127.0.0.1", port: ports.storage, rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8") },
  });
  // Unique identities/paths avoid deleting other running tests' emulator data.
  alice = client("alice"); bob = client("bob");
  uid = (await alice.signUp(email, password)).session.user.id;
  bobUid = (await bob.signUp(`pdf-other-${runId}@example.test`, password)).session.user.id;
});
after(async () => {
  await Promise.all(clients.map((backend) => backend.close()));
  await rules?.cleanup();
});

test("PDF upload stores exact bytes in an immutable revision and retries reuse them", async () => {
  const record = await savedInvoice("bytes");
  assert.equal(alice.pdfStorageAvailable, true);
  const uploaded = await alice.saveInvoicePdf(uid, record, pdf());
  assert.deepEqual(uploaded, { path: pathOf(record), revision: 1, size: pdf().size, alreadySaved: false });
  const ownerFile = ref(rules.authenticatedContext(uid).storage(bucket), uploaded.path);
  assert.equal(Buffer.from(await getBytes(ownerFile)).toString(), source);
  const metadata = await getMetadata(ownerFile);
  assert.equal(metadata.contentType, "application/pdf");
  assert.equal(metadata.cacheControl, "private, no-store");
  assert.equal(metadata.customMetadata.invoiceId, record.id);
  assert.equal(metadata.customMetadata.revision, "1");
  assert.match(metadata.customMetadata.invoiceFingerprint, /^[a-f0-9]{64}$/);
  const repeated = await alice.saveInvoicePdf(uid, record, new Blob(["%PDF-different generation"], { type: "application/pdf" }));
  assert.equal(repeated.alreadySaved, true);
  assert.equal(Buffer.from(await getBytes(ownerFile)).toString(), source);
  await assertFails(uploadBytes(ownerFile, pdf(), uploadMetadata(record)));
});

test("anonymous users and other accounts cannot fetch, overwrite, list, or upload PDFs", async () => {
  const record = await savedInvoice("private");
  await alice.saveInvoicePdf(uid, record, pdf());
  await assert.rejects(bob.saveInvoicePdf(uid, record, pdf()), { code: "auth/user-token-expired" });
  for (const context of [rules.unauthenticatedContext(), rules.authenticatedContext(bobUid)]) {
    const file = ref(context.storage(bucket), pathOf(record));
    await assertFails(getBytes(file));
    await assertFails(getMetadata(file));
    await assertFails(uploadBytes(file, pdf(), uploadMetadata(record)));
    await assertFails(listAll(ref(context.storage(bucket), `users/${uid}/invoices`)));
  }
});

test("PDF saves reject missing, stale, malformed, oversized, and unconfigured inputs", async () => {
  const record = await savedInvoice("validation");
  await assert.rejects(alice.saveInvoicePdf(uid, { id: "missing", revision: 1 }, pdf()), { code: "INVOICE_NOT_FOUND" });
  await assert.rejects(alice.saveInvoicePdf(uid, { ...record, revision: 0 }, pdf()), { code: "PDF_INVALID_REVISION" });
  await assert.rejects(alice.saveInvoicePdf(uid, record, new Blob([source], { type: "text/plain" })), { code: "PDF_INVALID_FILE" });
  await assert.rejects(alice.saveInvoicePdf(uid, record, new Blob(["not a pdf"], { type: "application/pdf" })), { code: "PDF_INVALID_FILE" });
  await assert.rejects(alice.saveInvoicePdf(uid, record, new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "application/pdf" })), { code: "PDF_INVALID_FILE" });
  const current = await alice.saveInvoice(uid, { ...record, invoice: { ...record.invoice, billTo: "NEW REVISION" } });
  await assert.rejects(alice.saveInvoicePdf(uid, record, pdf()), { code: "INVOICE_REVISION_CONFLICT" });
  const ownStorage = rules.authenticatedContext(uid).storage(bucket);
  await assertFails(uploadBytes(ref(ownStorage, pathOf(record)), pdf(), uploadMetadata(record)));
  await assertFails(uploadBytes(ref(ownStorage, pathOf(current)), pdf(), { ...uploadMetadata(current), contentType: "text/plain" }));
  await assertFails(uploadBytes(ref(ownStorage, pathOf(current)), new Uint8Array(10 * 1024 * 1024 + 1), uploadMetadata(current)));
  await assertFails(uploadBytes(ref(ownStorage, `users/${uid}/invoices/missing/revisions/1.pdf`), pdf(), { contentType: "application/pdf", customMetadata: { invoiceId: "missing", revision: "1" } }));
  await assertSucceeds(uploadBytes(ref(ownStorage, pathOf(current)), pdf(), uploadMetadata(current)));
  const noBucket = client("no-bucket", { ...config, storageBucket: undefined });
  await noBucket.signIn(email, password);
  assert.equal(noBucket.pdfStorageAvailable, false);
  await assert.rejects(noBucket.saveInvoicePdf(uid, current, pdf()), { code: "PDF_STORAGE_UNAVAILABLE" });
  const offline = client("offline", config, { navigator: { onLine: false } });
  await offline.signIn(email, password);
  await assert.rejects(offline.saveInvoicePdf(uid, current, pdf()), { code: "unavailable" });
});

test("deleting the Firestore invoice revokes access to its retained PDF", async () => {
  const record = await savedInvoice("deleted");
  await alice.saveInvoicePdf(uid, record, pdf());
  await alice.deleteInvoice(uid, record.id, record.revision);
  await assertFails(getBytes(ref(rules.authenticatedContext(uid).storage(bucket), pathOf(record))));
  await assert.rejects(alice.saveInvoicePdf(uid, record, pdf()), { code: "INVOICE_NOT_FOUND" });
  await rules.withSecurityRulesDisabled(async (context) => {
    assert.equal((await getMetadata(ref(context.storage(bucket), pathOf(record)))).size, pdf().size);
  });
});

test("recreating an invoice ID never reuses a PDF for different invoice contents", async () => {
  const original = await savedInvoice("recreated");
  await alice.saveInvoicePdf(uid, original, pdf());
  await alice.deleteInvoice(uid, original.id, original.revision);
  const recreated = await alice.saveInvoice(uid, { id: original.id, invoice: { ...invoice(), billTo: "DIFFERENT CUSTOMER" } });
  assert.equal(recreated.revision, original.revision);
  await assert.rejects(alice.saveInvoicePdf(uid, recreated, pdf()), { code: "PDF_CONTENT_CONFLICT" });
  // The metadata check happens before the browser-only byte download API.
  await assert.rejects(alice.loadInvoicePdf(uid, recreated), { code: "PDF_CONTENT_CONFLICT" });
  const next = await alice.saveInvoice(uid, recreated);
  assert.equal((await alice.saveInvoicePdf(uid, next, pdf())).alreadySaved, false);
});

test("a fresh browser session downloads PDF bytes through authenticated getBlob", { timeout: 45000 }, async (context) => {
  const record = await savedInvoice("browser");
  const chromePath = await findChromePath();
  assert.ok(chromePath, "Chrome is required to verify the browser-only getBlob API.");
  const bundle = await readFile(new URL("../vendor/firebase-client.js", import.meta.url));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/client.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/client.js" ? bundle : '<!doctype html><title>PDF backend test</title><script src="/client.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const profile = await mkdtemp(join(tmpdir(), "ledgerly-pdf-test-"));
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", `http://127.0.0.1:${server.address().port}/`], { stdio: ["ignore", "ignore", "pipe"] });
  context.after(async () => {
    chrome.kill(); server.closeAllConnections(); server.close();
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  });
  let logs = "";
  chrome.stderr.on("data", (chunk) => { logs += chunk; });
  const socket = await waitFor(() => logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 15000);
  const targets = await (await fetch(`http://127.0.0.1:${new URL(socket).port}/json/list`)).json();
  const page = await connectCdp(targets.find((entry) => entry.type === "page").webSocketDebuggerUrl);
  context.after(() => page.close());
  await page.send("Runtime.enable");
  await waitFor(() => evaluate(page, "typeof window.createFirebaseInvoiceBackend === 'function'"), 10000);
  const result = await evaluate(page, `(async () => {
    const backend = window.createFirebaseInvoiceBackend(${JSON.stringify(config)}, null, { appName: 'pdf-browser', memoryAuth: true, emulators: ${JSON.stringify(ports)} });
    const session = (await backend.signIn(${JSON.stringify(email)}, ${JSON.stringify(password)})).session;
    const blob = new Blob([${JSON.stringify(source)}], { type: 'application/pdf' });
    const uploaded = await backend.saveInvoicePdf(session.user.id, ${JSON.stringify(record)}, blob);
    await backend.signOut();
    const resumed = (await backend.signIn(${JSON.stringify(email)}, ${JSON.stringify(password)})).session;
    const downloaded = await backend.loadInvoicePdf(resumed.user.id, ${JSON.stringify(record)});
    const result = { uploaded: uploaded.path, text: await downloaded.text(), size: downloaded.size, type: downloaded.type };
    await backend.signOut();
    try { await backend.loadInvoicePdf(resumed.user.id, ${JSON.stringify(record)}); }
    catch (error) { result.signedOutError = error.code; }
    await backend.close();
    return result;
  })()`);
  assert.deepEqual(result, { uploaded: pathOf(record), text: source, size: pdf().size, type: "application/pdf", signedOutError: "auth/user-token-expired" });
});

test("private invoice attachments upload, list, download, delete and revoke on invoice deletion", async () => {
  const record = await savedInvoice('attachments');
  const file = new File(['Sample furniture list'], 'furniture.csv', {type:'text/csv'});
  const uploaded = await alice.uploadAttachment(uid, record.id, file);
  const listed = await alice.listAttachments(uid, record.id);
  assert.equal(listed[0].name, 'furniture.csv');
  const path = `users/${uid}/invoices/${record.id}/attachments/${uploaded.id}`;
  const ownerFile = ref(rules.authenticatedContext(uid).storage(bucket), path);
  assert.equal(new TextDecoder().decode(await getBytes(ownerFile)), 'Sample furniture list');
  await assertFails(getBytes(ref(rules.authenticatedContext(bobUid).storage(bucket), path)));
  await assertFails(listAll(ref(rules.authenticatedContext(bobUid).storage(bucket), `users/${uid}/invoices/${record.id}/attachments`)));
  await assert.rejects(alice.uploadAttachment(uid, record.id, new File([], 'empty.txt')));
  await alice.deleteAttachment(uid, record.id, uploaded.id);
  assert.equal((await alice.listAttachments(uid, record.id)).length, 0);
  const retained = await alice.uploadAttachment(uid, record.id, file);
  await alice.deleteInvoice(uid, record.id, record.revision);
  await assertFails(getBytes(ref(rules.authenticatedContext(uid).storage(bucket), `users/${uid}/invoices/${record.id}/attachments/${retained.id}`)));
});


test("profile PDF and attachments use isolated paths and deny other accounts", async () => {
  const profile=await alice.saveProfile({name:"Storage profile",terms:"",logo:""});
  await alice.selectProfile(profile.id);
  const profileUid=(await alice.getSession()).user.id;
  const record=await alice.saveInvoice(profileUid,{id:"scoped-storage",invoice:invoice()});
  const stored=await alice.saveInvoicePdf(profileUid,record,pdf());
  assert.ok(stored.path.startsWith(`users/${uid}/profiles/${profile.id}/`));
  const owned=ref(rules.authenticatedContext(uid).storage(bucket),stored.path);
  assert.equal(Buffer.from(await getBytes(owned)).toString(),source);
  await assertFails(getBytes(ref(rules.authenticatedContext(bobUid).storage(bucket),stored.path)));
  const file=await alice.uploadAttachment(profileUid,record.id,new File(["private"],"profile.txt",{type:"text/plain"}));
  assert.equal((await alice.listAttachments(profileUid,record.id)).length,1);
  await alice.selectProfile("default");
  await assert.rejects(alice.listAttachments(profileUid,record.id));
  assert.equal((await alice.listInvoices(uid)).records.some(entry=>entry.id===record.id),false);
  await alice.selectProfile(profile.id);
  await alice.deleteAttachment(profileUid,record.id,file.id);
  await alice.deleteInvoice(profileUid,record.id,record.revision);
  await assertFails(getBytes(owned));
  await alice.selectProfile("default");
});
