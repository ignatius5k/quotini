import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { createFirebaseInvoiceBackend } from "../firebase-backend.mjs";

const projectId = "demo-ledgerly";
function emulatorPort(name) {
  const match = process.env[name]?.match(/^(?:localhost|127[.]0[.]0[.]1):(\d+)$/);
  if (!match) throw new Error(`${name} must identify a local emulator. These tests must never contact production.`);
  return Number(match[1]);
}
const ports = {
  auth: emulatorPort("FIREBASE_AUTH_EMULATOR_HOST"),
  firestore: emulatorPort("FIRESTORE_EMULATOR_HOST"),
};
const invoice = (billTo = "TEST CUSTOMER") => ({
  invoiceNumber: "EHR-20260912-001", invoiceDate: "2026-09-12", dueDate: "2026-09-19",
  pdfFileName: "test-invoice", pdfFileNameCustomized: true, billTo,
  items: [{ id: "item-1", quantity: 1, description: "Emulator test only", price: 120 }],
});
let rules;
let alice;
let bob;
let otherDevice;
let aliceId;
let bobId;
const clients = [];
function client(name) {
  const selected = new Map();
  const backend = createFirebaseInvoiceBackend({ apiKey: "fake-emulator-key", projectId, appId: `test-${name}`, authDomain: `${projectId}.firebaseapp.com` }, null, {
    appName: name, memoryAuth: true, emulators: ports,
    environment: { sessionStorage: { getItem: key => selected.get(key), setItem: (key, value) => selected.set(key, value) } },
  });
  clients.push(backend);
  return backend;
}

before(async () => {
  rules = await initializeTestEnvironment({ projectId, firestore: {
    host: "127.0.0.1", port: ports.firestore, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  } });
  await rules.clearFirestore();
  await fetch(`http://127.0.0.1:${ports.auth}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  alice = client("alice"); bob = client("bob"); otherDevice = client("alice-other-device");
});
after(async () => { await Promise.all(clients.map((backend) => backend.close())); await rules?.cleanup(); });

test("email sign-up, sign-in, sign-out, and private account sessions", async () => {
  assert.equal(await alice.getSession(), null);
  aliceId = (await alice.signUp("alice@example.test", "Test-password-123!")).session.user.id;
  bobId = (await bob.signUp("bob@example.test", "Test-password-123!")).session.user.id;
  assert.notEqual(aliceId, bobId);
  await otherDevice.signIn("alice@example.test", "Test-password-123!");
  assert.equal((await otherDevice.getSession()).user.id, aliceId);
  await assert.rejects(otherDevice.signIn("alice@example.test", "wrong-password"));
  await otherDevice.signOut();
  assert.equal(await otherDevice.getSession(), null);
  await otherDevice.signIn("alice@example.test", "Test-password-123!");
});

test("cloud invoice CRUD survives a new device and rejects concurrent/stale writes", async () => {
  const saved = await alice.saveInvoice(aliceId, { id: "invoice-1", invoice: invoice() });
  assert.equal(saved.revision, 1);
  const remote = (await otherDevice.listInvoices(aliceId)).records[0];
  assert.equal(remote.id, saved.id);
  assert.equal(remote.invoice.billTo, "TEST CUSTOMER");
  const writes = await Promise.allSettled([
    alice.saveInvoice(aliceId, { ...remote, invoice: invoice("DEVICE A") }),
    otherDevice.saveInvoice(aliceId, { ...remote, invoice: invoice("DEVICE B") }),
  ]);
  assert.equal(writes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(writes.find((entry) => entry.status === "rejected").reason.code, "INVOICE_REVISION_CONFLICT");
  const latest = (await alice.listInvoices(aliceId)).records[0];
  assert.equal(latest.revision, 2);
  await assert.rejects(alice.deleteInvoice(aliceId, latest.id, 1), { code: "INVOICE_REVISION_CONFLICT" });
  assert.equal(await alice.deleteInvoice(aliceId, latest.id, 2), true);
  await assert.rejects(otherDevice.saveInvoice(aliceId, latest), { code: "INVOICE_REVISION_CONFLICT" });
  assert.equal((await otherDevice.listInvoices(aliceId)).total, 0);
});

test("Firestore rules deny anonymous, cross-account, malformed, and revision-bypassing requests", async () => {
  await alice.saveInvoice(aliceId, { id: "private-invoice", invoice: invoice("ALICE PRIVATE") });
  assert.equal((await bob.listInvoices(bobId)).total, 0);
  await assert.rejects(bob.listInvoices(aliceId), { code: "auth/user-token-expired" });
  const outsider = rules.authenticatedContext(bobId).firestore();
  const anonymous = rules.unauthenticatedContext().firestore();
  const owner = rules.authenticatedContext(aliceId).firestore();
  for (const database of [outsider, anonymous]) {
    const path = doc(database, "users", aliceId, "invoices", "private-invoice");
    await assertFails(getDoc(path));
    await assertFails(getDocs(collection(database, "users", aliceId, "invoices")));
    await assertFails(setDoc(path, { id: "private-invoice" }));
    await assertFails(deleteDoc(path));
    await assertFails(getDoc(doc(database, "users", aliceId, "drafts", "current")));
    await assertFails(getDoc(doc(database, "users", aliceId, "sequences", "20260912")));
  }
  const ownInvoice = doc(owner, "users", aliceId, "invoices", "private-invoice");
  await assertSucceeds(getDoc(ownInvoice));
  await assertFails(updateDoc(ownInvoice, { revision: 8, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ownInvoice, { revision: 2, invoice: { ...invoice(), historyId: "private-invoice", draftDirty: false, billTo: "x".repeat(2001) }, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, "users", bobId), { administrator: true }));
  await assertFails(setDoc(doc(owner, "users", aliceId, "sequences", "20260912"), { sequence: 0 }));
});

test("draft revisions protect offline changes and stay monotonic after deletion", async () => {
  const draft = { ...invoice(), billTo: "", items: [{ id: "in-progress", quantity: "", description: "", price: "" }] };
  assert.equal((await alice.saveDraft(aliceId, draft)).revision, 1);
  assert.equal((await otherDevice.loadDraft(aliceId)).revision, 1);
  assert.equal((await alice.saveDraft(aliceId, invoice("NEW DRAFT"), undefined, 1)).revision, 2);
  await assert.rejects(otherDevice.saveDraft(aliceId, draft, undefined, 1), { code: "DRAFT_REVISION_CONFLICT" });
  await assert.rejects(otherDevice.deleteDraft(aliceId, undefined, 1), { code: "DRAFT_REVISION_CONFLICT" });
  await alice.deleteDraft(aliceId, undefined, 2);
  assert.equal(await alice.loadDraft(aliceId), null);
  assert.equal((await alice.saveDraft(aliceId, draft)).revision, 4);
  await assert.rejects(otherDevice.saveDraft(aliceId, draft, undefined, 2), { code: "DRAFT_REVISION_CONFLICT" });
  assert.equal(await bob.loadDraft(bobId), null);
  await alice.deleteDraft(aliceId, undefined, 4);
});

test("the rules accept full five-line invoices and their updates", async () => {
  const value = invoice("FIVE LINES");
  value.items = Array.from({ length: 5 }, (_, i) => ({ id: `five-${i}`, quantity: i + 1, description: "x".repeat(1000), price: i === 4 ? -10 : 100 }));
  const saved = await bob.saveInvoice(bobId, { id: "five-lines", invoice: value });
  const updated = await bob.saveInvoice(bobId, { ...saved, invoice: { ...saved.invoice, billTo: "UPDATED FIVE LINES" } });
  assert.equal(updated.revision, 2);
  await bob.deleteInvoice(bobId, updated.id, 2);
});

test("saving and updating a new invoice tolerates a computer clock five minutes ahead", async (t) => {
  const actualNow = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: actualNow + 5 * 60 * 1000 });
  try {
    const saved = await bob.saveInvoice(bobId, {
      id: "clock-ahead", createdAt: new Date().toISOString(), invoice: invoice("CLOCK AHEAD"),
    });
    const updated = await bob.saveInvoice(bobId, { ...saved, invoice: { ...saved.invoice, billTo: "CLOCK AHEAD UPDATED" } });
    assert.equal(updated.revision, 2);
    const stored = (await bob.listInvoices(bobId, { query: "CLOCK AHEAD UPDATED" })).records[0];
    assert.ok(new Date(stored.createdAt).getTime() < actualNow + 60 * 1000);
    await bob.deleteInvoice(bobId, stored.id, stored.revision);
  } finally {
    t.mock.timers.reset();
  }
});

test("number reservations are atomic across devices and survive invoice deletion", async () => {
  const numbers = await Promise.all([alice.reserveInvoiceNumber("2026-10-01"), otherDevice.reserveInvoiceNumber("2026-10-01")]);
  assert.deepEqual(numbers.sort(), ["EHR-20261001-001", "EHR-20261001-002"]);
  assert.equal(await alice.nextInvoiceNumber("2026-10-01"), "EHR-20261001-003");
  const manual = await alice.saveInvoice(aliceId, { id: "manual-number", invoice: { ...invoice(), invoiceNumber: "EHR-20261001-009" } });
  await alice.deleteInvoice(aliceId, manual.id, manual.revision);
  assert.equal(await otherDevice.reserveInvoiceNumber("2026-10-01"), "EHR-20261001-010");
  assert.equal(await bob.reserveInvoiceNumber("2026-10-01"), "EHR-20261001-001");
});

test("pagination, customer/number search, account backups and retryable local imports", async () => {
  const records = Array.from({ length: 6 }, (_, index) => ({ id: `import-${index}`, createdAt: "2026-08-01T00:00:00.000Z", invoice: invoice(`IMPORT CUSTOMER ${index}`) }));
  await alice.migrateLocalData(aliceId, records, null);
  await alice.migrateLocalData(aliceId, records, null);
  const first = await alice.listInvoices(aliceId, { limit: 3 });
  const second = await alice.listInvoices(aliceId, { limit: 3, cursor: first.nextCursor });
  assert.equal(first.total, 7);
  assert.equal(first.records.length, 3);
  assert.equal(second.records.length, 3);
  assert.equal(new Set([...first.records, ...second.records].map((record) => record.id)).size, 6);
  const match = await alice.listInvoices(aliceId, { query: "customer 3" });
  assert.equal(match.total, 1);
  assert.equal(match.records[0].createdAt, "2026-08-01T00:00:00.000Z");
  assert.equal((await alice.listInvoices(aliceId, { query: "20260912" })).total, 7);
  const backup = await alice.exportAccountData(aliceId);
  assert.equal(backup.history.length, 7);
  assert.ok(backup.sequences.some((entry) => entry.date === "20261001" && entry.sequence === 10));
  await bob.migrateLocalData(bobId, [], null, [{ date: "20261201", sequence: 42 }]);
  assert.equal(await bob.nextInvoiceNumber("2026-12-01"), "EHR-20261201-043");
  await assert.rejects(alice.migrateLocalData(aliceId, [{ ...records[0], invoice: invoice("COLLISION") }], null), /already belongs/);
  assert.equal((await alice.listInvoices(aliceId, { query: "COLLISION" })).total, 0);
  await alice.migrateLocalData(aliceId, [], invoice("LOCAL DRAFT"));
  await alice.migrateLocalData(aliceId, [], invoice("LOCAL DRAFT"));
  await assert.rejects(alice.migrateLocalData(aliceId, [], invoice("OTHER DRAFT")), /already has a draft/);
  assert.equal((await alice.loadDraft(aliceId)).invoice.billTo, "LOCAL DRAFT");
});

test("password reset uses Firebase action codes and permits login with the new password", async () => {
  await bob.sendPasswordReset("bob@example.test");
  const response = await fetch(`http://127.0.0.1:${ports.auth}/emulator/v1/projects/${projectId}/oobCodes`);
  const { oobCodes } = await response.json();
  const action = oobCodes.find((code) => code.email === "bob@example.test" && code.requestType === "PASSWORD_RESET");
  assert.ok(action);
  await bob.signOut();
  assert.equal(await bob.preparePasswordRecovery(`http://localhost/?mode=resetPassword&oobCode=${action.oobCode}`), true);
  await bob.updatePassword("Reset-password-123!");
  await bob.signIn("bob@example.test", "Reset-password-123!");
  assert.equal((await bob.getSession()).user.id, bobId);
  await assert.rejects(bob.signIn("bob@example.test", "Test-password-123!"));
});

test("payment evidence, remarks, filtering and concurrency are enforced", async () => {
  const record = await alice.saveInvoice(aliceId, { id: "payment-test", invoice: invoice("Payment customer") });
  const screenshot = "data:image/jpeg;base64,/9j/2Q==";
  assert.equal((await alice.loadPayment(aliceId, record.id)).status, "unpaid");
  await assert.rejects(alice.savePayment(aliceId, record.id, { status: "paid", remarks: "", confirmed: true, screenshot: "" }));
  await alice.savePayment(aliceId, record.id, { status: "unpaid", remarks: "Awaiting transfer" });
  await alice.savePayment(aliceId, record.id, { revision: 1, status: "paid", remarks: "Reference 123", confirmed: true, screenshot });
  const remote = await otherDevice.loadPayment(aliceId, record.id);
  assert.equal(remote.status, "paid"); assert.equal(remote.screenshot, screenshot); assert.equal(remote.remarks, "Reference 123");
  assert.ok((await alice.listInvoices(aliceId, { status: "paid" })).records.some((r) => r.id === record.id));
  assert.ok(!(await alice.listInvoices(aliceId, { status: "unpaid" })).records.some((r) => r.id === record.id));
  await assert.rejects(otherDevice.savePayment(aliceId, record.id, { revision: 1, status: "unpaid", remarks: "stale" }), { code: "PAYMENT_REVISION_CONFLICT" });
  const stranger = rules.authenticatedContext(bobId).firestore();
  await assertFails(getDoc(doc(stranger, "users", aliceId, "payments", record.id)));
  await assertFails(getDoc(doc(stranger, "users", aliceId, "payments", record.id, "evidence", "current")));
  const ownerDb = rules.authenticatedContext(aliceId).firestore();
  await assertFails(setDoc(doc(ownerDb, "users", aliceId, "payments", "invoice-1"), { status: "paid", remarks: "", revision: 1, verified: true, updatedAt: serverTimestamp() }));
  await alice.savePayment(aliceId, record.id, { revision: 2, status: "refunded", remarks: "Refund sent", confirmed: true, screenshot });
  await alice.savePayment(aliceId, record.id, { revision: 3, status: "unpaid", remarks: "Correction" });
  assert.equal((await alice.loadPayment(aliceId, record.id)).screenshot, "");
  await alice.deleteInvoice(aliceId, record.id, record.revision);
});

test("nested invoice folders persist across devices, filter pages, and restore from backup", async () => {
  const parent = await alice.createFolder(aliceId, "Properties");
  const child = await alice.createFolder(aliceId, "Eng Hoon", parent.id);
  await assert.rejects(alice.createFolder(aliceId, " "));
  await assert.rejects(alice.createFolder(aliceId, "Missing parent", "missing"));
  const a = await alice.saveInvoice(aliceId, { id: "folder-a", folderId: child.id, invoice: invoice("FOLDER CUSTOMER") });
  const b = await alice.saveInvoice(aliceId, { id: "folder-b", invoice: invoice("FOLDER CUSTOMER") });
  assert.equal((await alice.listInvoices(aliceId, { folderId: child.id })).records[0].id, a.id);
  await alice.moveInvoice(aliceId, b.id, child.id, "");
  const first = await otherDevice.listInvoices(aliceId, { folderId: child.id, limit: 1, query: "FOLDER", status: "unpaid" });
  const second = await otherDevice.listInvoices(aliceId, { folderId: child.id, limit: 1, query: "FOLDER", status: "unpaid", cursor: first.nextCursor });
  assert.equal(first.total, 2);
  assert.notEqual(first.records[0].id, second.records[0].id);
  assert.equal(first.records[0].folderId, child.id);
  assert.ok(first.folders.some(folder => folder.id === child.id && folder.parentId === parent.id));
  assert.equal((await alice.listInvoices(aliceId, { folderId: parent.id })).total, 0);
  await assert.rejects(alice.moveInvoice(aliceId, a.id, "", ""), /another device/);
  await assert.rejects(alice.moveInvoice(aliceId, a.id, "missing", child.id), /no longer exists/);
  const stranger = rules.authenticatedContext(bobId).firestore();
  await assertFails(getDoc(doc(stranger, "users", aliceId, "folders", child.id)));
  await assertFails(setDoc(doc(stranger, "users", aliceId, "invoiceFolders", a.id), { folderId: child.id }));
  const ownerDb = rules.authenticatedContext(aliceId).firestore();
  await assertFails(updateDoc(doc(ownerDb, "users", aliceId, "folders", parent.id), { parentId: child.id }));
  const backup = await alice.exportAccountData(aliceId);
  const restored = client("folder-restore");
  const restoredId = (await restored.signUp("folders-restored@example.test", "Test-password-123!")).session.user.id;
  await restored.migrateLocalData(restoredId, backup.history, backup.draft, backup.sequences, backup.payments, backup.organization);
  assert.equal((await restored.listInvoices(restoredId, { folderId: child.id })).total, 2);
  await alice.moveInvoice(aliceId, a.id, "", child.id);
  assert.ok((await alice.listInvoices(aliceId, { folderId: "" })).records.some(record => record.id === a.id));
  await alice.deleteInvoice(aliceId, b.id, b.revision);
  assert.equal((await alice.loadFolders(aliceId)).placements.some(entry => entry.id === b.id), false);
});

test("invoice customization and booking folders survive saving and account export", async () => {
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  const custom = { ...invoice('COFFEE COMPANY'), igHandle: '@coffee.sg', terms: 'Payment is due in two days.', logo };
  const folder = await alice.createBookingFolders(aliceId, 'weekend-market', '2026-10-17');
  assert.equal((await alice.createBookingFolders(aliceId, 'weekend-market', '2026-10-17')).id, folder.id);
  const organization = await alice.loadFolders(aliceId);
  assert.ok(organization.folders.some(entry => entry.parentId === folder.id && entry.name === 'Furniture rental'));
  await assert.rejects(alice.createBookingFolders(aliceId, 'events', '2026-02-30'));
  const saved = await alice.saveInvoice(aliceId, { id: 'custom-invoice', invoice: custom, folderId: folder.id });
  const loaded = (await otherDevice.listInvoices(aliceId, { query: 'coffee.sg' })).records[0];
  assert.equal(loaded.id, saved.id);
  for (const key of ['igHandle','terms','logo']) assert.equal(loaded.invoice[key], custom[key]);
  assert.equal(loaded.folderId, folder.id);
  const draft = await alice.loadDraft(aliceId);
  await alice.saveDraft(aliceId, custom, undefined, draft.revision);
  assert.equal((await otherDevice.loadDraft(aliceId)).invoice.logo, logo);
  assert.equal((await alice.exportAccountData(aliceId)).history.find(entry=>entry.id===saved.id).invoice.terms, custom.terms);
  await assert.rejects(alice.saveInvoice(aliceId, { id:'bad-handle', invoice:{...custom,igHandle:'bad handle'} }));
});


test("business profiles isolate invoices, drafts, folders and templates while retaining legacy data", async () => {
  const profiles = await alice.listProfiles();
  assert.ok(profiles.some(profile => profile.id === "default"));
  const legacy = await alice.listInvoices(aliceId);
  const profile = await alice.saveProfile({name:"Studio Two",terms:"Pay within two days.",logo:""});
  await alice.selectProfile(profile.id);
  const scopedId = (await alice.getSession()).user.id;
  assert.notEqual(scopedId, aliceId);
  assert.equal((await alice.listInvoices(scopedId)).total, 0);
  await assert.rejects(alice.listInvoices(aliceId));
  const saved = await alice.saveInvoice(scopedId, {id:"profile-invoice",invoice:invoice("Studio Two client")});
  const folder = await alice.createFolder(scopedId,"Client projects");
  await alice.moveInvoice(scopedId,saved.id,folder.id,"");
  await alice.saveDraft(scopedId,invoice("Studio Two draft"));
  assert.equal((await alice.loadDraft(scopedId)).invoice.billTo,"Studio Two draft");
  const backup = await alice.exportAccountData(scopedId);
  assert.equal(backup.history.length,1);
  assert.equal(backup.organization.folders.length,1);
  await assertFails(getDoc(doc(rules.authenticatedContext(bobId).firestore(),"users",aliceId,"profiles",profile.id,"invoices",saved.id)));
  await assertFails(setDoc(doc(rules.authenticatedContext(bobId).firestore(),"users",aliceId,"profiles",profile.id),{name:"Stolen",logo:"",terms:""}));
  await alice.selectProfile("default");
  assert.equal((await alice.getSession()).user.id,aliceId);
  assert.equal((await alice.listInvoices(aliceId)).total,legacy.total);
  assert.ok(!(await alice.listInvoices(aliceId)).records.some(record=>record.id===saved.id));
  await otherDevice.selectProfile(profile.id);
  const otherId=(await otherDevice.getSession()).user.id;
  assert.equal((await otherDevice.listInvoices(otherId)).records[0].invoice.billTo,"Studio Two client");
  assert.equal((await otherDevice.listProfiles()).find(value=>value.id===profile.id).terms,"Pay within two days.");
  await otherDevice.selectProfile("default");
});
