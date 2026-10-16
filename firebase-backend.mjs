import { initializeApp } from "firebase/app";
import { createGoogleTokenSignIn } from "./google-sign-in.mjs";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
  updatePassword, verifyPasswordResetCode, confirmPasswordReset,
  connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithCredential, browserPopupRedirectResolver,
} from "firebase/auth";
import {
  initializeFirestore, memoryLocalCache, collection, doc, getDocFromServer,
  getDocsFromServer, getCountFromServer, setDoc, query, orderBy, documentId,
  limit, startAfter, runTransaction, serverTimestamp, Timestamp,
  connectFirestoreEmulator, terminate,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getBlob, getMetadata, connectStorageEmulator, listAll, deleteObject } from "firebase/storage";

const copy = (value) => JSON.parse(JSON.stringify(value));
const failure = (code, message) => Object.assign(new Error(message), { code });
const conflict = (kind) => failure(`${kind.toUpperCase()}_REVISION_CONFLICT`, `This ${kind} changed on another device. Reload the saved copy before trying again.`);
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function validId(value) {
  if (typeof value !== "string" || !value || value.length > 160 || value.includes("/") || value === "." || value === "..") {
    throw new Error("This invoice has an invalid identifier.");
  }
  return value;
}

function cleanInvoice(invoice) {
  if (!invoice || !Array.isArray(invoice.items) || invoice.items.length < 1 || invoice.items.length > 5) {
    throw new Error("An invoice must contain between one and five items.");
  }
  const value = copy(invoice);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 180000) throw new Error("This invoice is too large to save.");
  return value;
}

function asRecord(data) {
  return {
    ...data,
    createdAt: data.createdAt?.toDate().toISOString(),
    updatedAt: data.updatedAt?.toDate().toISOString(),
  };
}

function numberParts(number) {
  const match = String(number || "").match(/^EHR-(\d{8})-(\d{1,6})$/);
  return match && Number(match[2]) > 0 ? { date: match[1], sequence: Number(match[2]) } : null;
}

function canonicalInvoice(value) {
  return JSON.stringify(value, function (key, val) {
    if (key === "historyRevision") return undefined;
    return val && !Array.isArray(val) && typeof val === "object"
      ? Object.fromEntries(Object.keys(val).sort().map((name) => [name, val[name]])) : val;
  });
}

export function createFirebaseInvoiceBackend(config, localBackend, options = {}) {
  const environment = options.environment || (typeof window !== "undefined" ? window : null);
  const userAgent = environment?.navigator?.userAgent || "";
  const webKit = /AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg|OPR)\//i.test(userAgent);
  const googleClientId = config.googleClientId || (config.projectId === "ledgerly-e0c95"
    ? "245799445908-rbu5tip6b78cb3l0jef49nt1mcaf27rh.apps.googleusercontent.com" : null);
  const useDirectGoogle = webKit && !options.emulators && googleClientId && environment?.document;
  const app = initializeApp(config, options.appName || "ledgerly");
  const auth = initializeAuth(app, {
    persistence: options.memoryAuth ? inMemoryPersistence
      : [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
    // Direct Google credentials do not need Firebase's cross-site auth iframe.
    // Keeping the resolver here would still initialize that iframe on Safari.
    ...(options.memoryAuth || useDirectGoogle ? {} : { popupRedirectResolver: browserPopupRedirectResolver }),
  });
  // Cloud invoices are kept in memory. Only unsynced drafts use the existing,
  // account-keyed outbox, so another login cannot read a previous user's cache.
  const directGoogleSignIn = useDirectGoogle
    ? createGoogleTokenSignIn(environment, googleClientId) : null;
  const db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    // WebKit can stall the streaming connection when returning from OAuth or
    // restoring a page. Short-lived polls also work in iOS home-screen apps.
    ...(webKit ? { experimentalForceLongPolling: true } : {}),
  });
  const pdfStorageAvailable = typeof config.storageBucket === "string" && Boolean(config.storageBucket.trim());
  const storage = pdfStorageAvailable ? getStorage(app) : null;
  if (storage) {
    storage.maxUploadRetryTime = 15000;
    storage.maxOperationRetryTime = 15000;
  }
  if (options.emulators) {
    const hostname = environment?.location?.hostname;
    if (!options.memoryAuth && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
      throw new Error("Firebase emulators may only be used on localhost.");
    }
    connectAuthEmulator(auth, `http://127.0.0.1:${options.emulators.auth || 9099}`, { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", options.emulators.firestore || 8080);
    if (storage) connectStorageEmulator(storage, "127.0.0.1", options.emulators.storage || 9199);
  }

  const listeners = new Set();
  const selectedProfile = () => {
    try { return environment?.sessionStorage?.getItem(`quotini-profile:${auth.currentUser?.uid}`) || "default"; } catch { return "default"; }
  };
  const workspaceId = () => selectedProfile() === "default" ? auth.currentUser?.uid : `${auth.currentUser?.uid}::${selectedProfile()}`;
  const scope = (uid) => {
    owner(uid);
    return selectedProfile() === "default" ? ["users", auth.currentUser.uid] : ["users", auth.currentUser.uid, "profiles", validId(selectedProfile())];
  };
  const session = () => auth.currentUser ? { user: { id: workspaceId(), email: auth.currentUser.email } } : null;
  let lastUid;
  let initial = true;
  let resetCode;
  onAuthStateChanged(auth, (user) => {
    const event = initial ? "INITIAL_SESSION" : user ? "SIGNED_IN" : "SIGNED_OUT";
    const changed = initial || lastUid !== user?.uid;
    initial = false;
    lastUid = user?.uid;
    if (changed) for (const listener of listeners) listener(event, session());
  });

  function owner(userId = workspaceId()) {
    if (!userId || workspaceId() !== userId) throw failure("auth/user-token-expired", "Sign in again to access your invoices.");
    return userId;
  }

  function online(userId) {
    owner(userId);
    if (environment?.navigator?.onLine === false) throw failure("unavailable", "Reconnect to save invoices to your account. Your draft remains on this device.");
  }

  const invoices = (uid) => collection(db, ...scope(uid), "invoices");
  const invoiceRef = (uid, id) => doc(invoices(uid), validId(id));
  const draftRef = (uid) => doc(db, ...scope(uid), "drafts", "current");
  const sequenceRef = (uid, date) => doc(db, ...scope(uid), "sequences", date);
  function checkRevision(existing, expected, kind) {
    const current = existing && !existing.deleted ? existing.revision : undefined;
    if (current !== expected && !(current === undefined && (expected === undefined || expected === 0))) throw conflict(kind);
  }

  async function revisionTransaction(uid, ref, expectedRevision, kind, action) {
    try { return await runTransaction(db, action); }
    catch (error) {
      if (error.code === "permission-denied") {
        // Rules can reject a stale revision before the transaction retry. Read
        // the latest authorized copy to distinguish contention from bad rules.
        const latest = (await getDocFromServer(ref)).data();
        owner(uid);
        checkRevision(latest, expectedRevision, kind);
      }
      throw error;
    }
  }

  const paymentRef = (uid, id) => doc(db, ...scope(uid), "payments", validId(id));
  const evidenceRef = (uid, id) => doc(paymentRef(uid, id), "evidence", "current");
  async function loadPayment(uid, id) {
    online(uid);
    const [payment, evidence] = await Promise.all([getDocFromServer(paymentRef(uid, id)), getDocFromServer(evidenceRef(uid, id))]);
    owner(uid);
    return { status: "unpaid", remarks: "", ...payment.data(), screenshot: evidence.data()?.screenshot || "" };
  }
  async function savePayment(uid, id, value) {
    online(uid);
    if (!["unpaid", "paid", "refunded"].includes(value.status) || typeof value.remarks !== "string" || value.remarks.length > 2000) throw new Error("Choose a valid status and keep remarks within 2,000 characters.");
    if (value.status !== "unpaid" && (!value.confirmed || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.screenshot) || value.screenshot.length > 700000)) throw new Error("Upload a payment screenshot and confirm you have checked it.");
    return runTransaction(db, async (transaction) => {
      online(uid);
      const invoice = await transaction.get(invoiceRef(uid, id));
      const previous = (await transaction.get(paymentRef(uid, id))).data();
      if (!invoice.exists()) throw new Error("This invoice no longer exists.");
      checkRevision(previous, value.revision, "payment");
      const revision = (previous?.revision || 0) + 1;
      const payment = { status: value.status, remarks: value.remarks, revision, updatedAt: serverTimestamp(), verified: value.status !== "unpaid" };
      transaction.set(paymentRef(uid, id), payment);
      if (payment.verified) transaction.set(evidenceRef(uid, id), { screenshot: value.screenshot, revision, status: value.status });
      else transaction.delete(evidenceRef(uid, id));
      return { ...payment, updatedAt: null };
    });
  }

  const folderRef = (uid, id) => doc(db, ...scope(uid), "folders", validId(id));
  const placementRef = (uid, id) => doc(db, ...scope(uid), "invoiceFolders", validId(id));
  async function loadFolders(uid) {
    online(uid);
    const [folders, placements] = await Promise.all([
      getDocsFromServer(collection(db, ...scope(uid), "folders")),
      getDocsFromServer(collection(db, ...scope(uid), "invoiceFolders")),
    ]);
    owner(uid);
    return { folders: folders.docs.map(entry => ({ id: entry.id, ...entry.data() })), placements: placements.docs.map(entry => ({ id: entry.id, ...entry.data() })) };
  }
  async function createFolder(uid, name, parentId = "", id = crypto.randomUUID()) {
    online(uid);
    name = String(name).trim();
    if (!name || name.length > 80) throw new Error("Enter a folder name between 1 and 80 characters.");
    if (parentId) validId(parentId);
    return runTransaction(db, async transaction => {
      online(uid);
      const ref = folderRef(uid, id);
      const existing = await transaction.get(ref);
      const parent = parentId ? await transaction.get(folderRef(uid, parentId)) : null;
      if (parent && !parent.exists()) throw new Error("The parent folder no longer exists.");
      if (existing.exists()) {
        if (existing.data().name !== name || existing.data().parentId !== parentId) throw new Error("A different folder already uses this identifier.");
        return { id, name, parentId };
      }
      if (id === parentId) throw new Error("A folder cannot contain itself.");
      transaction.set(ref, { name, parentId });
      return { id, name, parentId };
    });
  }
  async function moveInvoice(uid, id, folderId, expectedFolderId) {
    online(uid);
    if (folderId) validId(folderId);
    return runTransaction(db, async transaction => {
      online(uid);
      const invoice = await transaction.get(invoiceRef(uid, id));
      const previous = await transaction.get(placementRef(uid, id));
      const folder = folderId ? await transaction.get(folderRef(uid, folderId)) : null;
      if (!invoice.exists()) throw new Error("This invoice no longer exists.");
      if (folder && !folder.exists()) throw new Error("This folder no longer exists.");
      if (expectedFolderId !== undefined && (previous.data()?.folderId || "") !== expectedFolderId) throw new Error("This invoice was moved on another device. Refresh and try again.");
      if (folderId) transaction.set(placementRef(uid, id), { folderId });
      else transaction.delete(placementRef(uid, id));
    });
  }

  async function ensureBookingFolders(uid) {
    const root = await createFolder(uid, "Eng Hoon Residences", "", "eng-hoon-residences");
    await createFolder(uid, "Weekend Market", root.id, "eng-hoon-weekend-market");
    await createFolder(uid, "Events", root.id, "eng-hoon-events");
    return root;
  }
  async function createBookingFolders(uid, category, date) {
    if (!["weekend-market", "events"].includes(category) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Choose a category and a valid date.");
    await ensureBookingFolders(uid);
    const parentId = `eng-hoon-${category}`;
    const folder = await createFolder(uid, date, parentId, `${parentId}-${date}`);
    await createFolder(uid, "Furniture rental", folder.id, `${folder.id}-furniture`);
    return folder;
  }
  function attachmentRoot(uid, invoiceId) {
    if (!storage) throw new Error("File storage is unavailable.");
    return storageRef(storage, `${scope(uid).join("/")}/invoices/${validId(invoiceId)}/attachments`);
  }
  async function listAttachments(uid, invoiceId) {
    online(uid);
    const result = await listAll(attachmentRoot(uid, invoiceId));
    const files = await Promise.all(result.items.map(async ref => {
      const metadata = await getMetadata(ref);
      return { id: ref.name, name: metadata.customMetadata?.fileName || ref.name, size: metadata.size };
    }));
    owner(uid);
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function uploadAttachment(uid, invoiceId, file) {
    online(uid);
    if (!file || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error("Choose a non-empty file up to 20 MB.");
    const ref = storageRef(attachmentRoot(uid, invoiceId), crypto.randomUUID());
    const fileName = String(file.name || "attachment").replace(/[\/\\\x00-\x1f]/g, "_").slice(0, 180);
    await uploadBytes(ref, file, { contentType: "application/octet-stream", customMetadata: { fileName } });
    owner(uid);
    return { id: ref.name, name: fileName, size: file.size };
  }
  async function downloadAttachment(uid, invoiceId, id) {
    online(uid);
    const blob = await getBlob(storageRef(attachmentRoot(uid, invoiceId), validId(id)), 20 * 1024 * 1024);
    owner(uid);
    return blob;
  }
  async function deleteAttachment(uid, invoiceId, id) {
    online(uid);
    await deleteObject(storageRef(attachmentRoot(uid, invoiceId), validId(id)));
    owner(uid);
  }

  async function listInvoices(userId, options = {}) {
    online(userId);
    const pageSize = Math.min(50, Math.max(1, Number(options.limit) || 25));
    const search = String(options.query || "").trim().toLocaleLowerCase("en-SG").slice(0, 120);
    const source = invoices(userId);
    const ordering = [orderBy("updatedAt", "desc"), orderBy(documentId(), "desc")];
    const cursor = options.cursor;
    const after = cursor?.id && cursor?.timestamp
      ? [startAfter(new Timestamp(cursor.timestamp.seconds, cursor.timestamp.nanoseconds), validId(cursor.id))] : [];
    let documents;
    let total;
    const status = options.status || "all";
    const [payments, organization] = await Promise.all([
      getDocsFromServer(collection(db, ...scope(userId), "payments")), loadFolders(userId),
    ]);
    const folderMap = new Map(organization.placements.map(entry => [entry.id, entry.folderId]));
    const folderFilter = typeof options.folderId === "string";
    const paymentMap = new Map(payments.docs.map((entry) => [entry.id, entry.data()]));
    if (search || status !== "all" || folderFilter) {
      // Preserve the editor's substring search semantics. Firestore has no native
      // substring index; only this user's collection is scanned for a search.
      const snapshot = await getDocsFromServer(query(source, ...ordering));
      owner(userId);
      const matching = snapshot.docs.filter((entry) => {
        const invoice = entry.data().invoice;
        return `${invoice.invoiceNumber || ""} ${invoice.billTo || ""} ${invoice.igHandle || ""}`.toLocaleLowerCase("en-SG").includes(search) && (status === "all" || (paymentMap.get(entry.id)?.status || "unpaid") === status) && (!folderFilter || (folderMap.get(entry.id) || "") === options.folderId);
      });
      total = matching.length;
      const position = cursor?.id ? matching.findIndex((entry) => entry.id === cursor.id) : -1;
      documents = matching.slice(position + 1, position + pageSize + 2);
    } else {
      const [snapshot, count] = await Promise.all([
        getDocsFromServer(query(source, ...ordering, ...after, limit(pageSize + 1))),
        getCountFromServer(source),
      ]);
      owner(userId);
      documents = snapshot.docs;
      total = count.data().count;
    }
    const page = documents.slice(0, pageSize);
    const last = page.at(-1);
    const timestamp = last?.data().updatedAt;
    return {
      folders: organization.folders,
      records: page.map((entry) => ({ ...asRecord(entry.data()), folderId: folderMap.get(entry.id) || "", payment: paymentMap.get(entry.id) || { status: "unpaid", remarks: "" } })), total,
      nextCursor: documents.length > pageSize && last ? {
        id: last.id, timestamp: { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds },
      } : null,
    };
  }

  async function saveInvoice(userId, record, { preserveCreatedAt = false } = {}) {
    online(userId);
    const ref = invoiceRef(userId, record.id);
    const invoice = { ...cleanInvoice(record.invoice), historyId: record.id, draftDirty: false };
    const numbering = numberParts(invoice.invoiceNumber);
    return revisionTransaction(userId, ref, record.revision, "invoice", async (transaction) => {
      online(userId);
      const existing = (await transaction.get(ref)).data();
      const sequence = numbering ? await transaction.get(sequenceRef(userId, numbering.date)) : null;
      const destinationId = !existing && record.folderId ? validId(record.folderId) : "";
      const destination = destinationId ? await transaction.get(folderRef(userId, destinationId)) : null;
      if (destination && !destination.exists()) throw new Error("This folder no longer exists.");
      checkRevision(existing, record.revision, "invoice");
      const now = Timestamp.now();
      const revision = (existing?.revision || 0) + 1;
      // Normal saves must use server time: a fast device clock otherwise fails
      // the createdAt <= request.time rule. Only imports carry historical dates.
      const originalDate = preserveCreatedAt && record.createdAt && new Date(record.createdAt);
      const importedCreatedAt = originalDate && Number.isFinite(originalDate.getTime()) && originalDate <= new Date()
        ? Timestamp.fromDate(originalDate) : null;
      const saved = {
        id: record.id, revision,
        createdAt: existing?.createdAt || importedCreatedAt || now, updatedAt: now,
        invoice: { ...invoice, historyRevision: revision },
      };
      transaction.set(ref, { ...saved, createdAt: existing?.createdAt || importedCreatedAt || serverTimestamp(), updatedAt: serverTimestamp() });
      if (destinationId) transaction.set(placementRef(userId, record.id), { folderId: destinationId });
      if (numbering && numbering.sequence > (sequence?.data()?.sequence || 0)) {
        transaction.set(sequenceRef(userId, numbering.date), { sequence: numbering.sequence });
      }
      return asRecord(saved);
    });
  }

  async function deleteInvoice(userId, id, expectedRevision) {
    online(userId);
    const ref = invoiceRef(userId, id);
    return runTransaction(db, async (transaction) => {
      online(userId);
      const existing = (await transaction.get(ref)).data();
      if (!existing) return false;
      checkRevision(existing, expectedRevision, "invoice");
      transaction.delete(ref);
      transaction.delete(placementRef(userId, id));
      transaction.delete(paymentRef(userId, id));
      transaction.delete(evidenceRef(userId, id));
      return true;
    });
  }

  async function currentPdfInvoice(uid, record) {
    online(uid);
    if (!storage) throw failure("PDF_STORAGE_UNAVAILABLE", "PDF storage is not configured. Your invoice data is saved, but its PDF has not been uploaded.");
    validId(record?.id);
    if (!Number.isSafeInteger(record?.revision) || record.revision < 1) {
      throw failure("PDF_INVALID_REVISION", "Save the invoice before saving its PDF to your account.");
    }
    const saved = (await getDocFromServer(invoiceRef(uid, record.id))).data();
    owner(uid);
    if (!saved) throw failure("INVOICE_NOT_FOUND", "This invoice is no longer saved in your account. Save the invoice before uploading its PDF.");
    if (saved.revision !== record.revision) throw conflict("invoice");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalInvoice(saved.invoice)));
    const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    owner(uid);
    return { target: storageRef(storage, `${scope(uid).join("/")}/invoices/${record.id}/revisions/${record.revision}.pdf`), fingerprint };
  }

  function checkPdfFingerprint(metadata, fingerprint) {
    if (metadata.customMetadata?.invoiceFingerprint !== fingerprint) {
      throw failure("PDF_CONTENT_CONFLICT", "A different PDF is already stored for this invoice revision. Save the invoice again to create a new revision before saving its PDF.");
    }
  }

  async function saveInvoicePdf(uid, record, blob) {
    online(uid);
    if (!(blob instanceof Blob) || blob.type !== "application/pdf" || blob.size < 5 || blob.size > MAX_PDF_BYTES) {
      throw failure("PDF_INVALID_FILE", "The invoice PDF must be a PDF file no larger than 10 MiB.");
    }
    if (await blob.slice(0, 5).text() !== "%PDF-") throw failure("PDF_INVALID_FILE", "The generated file is not a valid PDF.");
    const { target, fingerprint } = await currentPdfInvoice(uid, record);
    let metadata;
    let alreadySaved = false;
    try {
      metadata = await getMetadata(target);
      alreadySaved = true;
    } catch (error) {
      if (error.code !== "storage/object-not-found") throw error;
      // A revision is immutable. If another device uploads it first, the rules
      // reject our update and we reuse that successfully stored PDF.
      try {
        metadata = (await uploadBytes(target, blob, {
          contentType: "application/pdf", cacheControl: "private, no-store",
          customMetadata: { invoiceId: record.id, revision: String(record.revision), invoiceFingerprint: fingerprint },
        })).metadata;
      } catch (uploadError) {
        if (uploadError.code !== "storage/unauthorized") throw uploadError;
        try { metadata = await getMetadata(target); alreadySaved = true; }
        catch { throw uploadError; }
      }
    }
    checkPdfFingerprint(metadata, fingerprint);
    checkPdfFingerprint(metadata, (await currentPdfInvoice(uid, record)).fingerprint);
    return { path: target.fullPath, revision: record.revision, size: metadata.size, alreadySaved };
  }

  async function loadInvoicePdf(uid, record) {
    const { target, fingerprint } = await currentPdfInvoice(uid, record);
    const metadata = await getMetadata(target);
    checkPdfFingerprint(metadata, fingerprint);
    // Authenticated SDK download: never create or persist a public download URL.
    const blob = await getBlob(target, MAX_PDF_BYTES);
    checkPdfFingerprint(metadata, (await currentPdfInvoice(uid, record)).fingerprint);
    if (blob.size < 5 || await blob.slice(0, 5).text() !== "%PDF-") {
      throw failure("PDF_INVALID_FILE", "The saved file is not a valid PDF. Save a new invoice revision to create another PDF.");
    }
    // Some browser/Storage emulator responses omit the Blob MIME type despite
    // correct object metadata; preserve PDF opening and printing behavior.
    return blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  }

  async function loadDraft(userId) {
    online(userId);
    const data = (await getDocFromServer(draftRef(userId))).data();
    owner(userId);
    return data && !data.deleted ? { invoice: data.invoice, revision: data.revision } : null;
  }

  async function writeDraft(userId, invoice, signal, expectedRevision) {
    online(userId);
    const ref = draftRef(userId);
    const value = invoice ? cleanInvoice(invoice) : null;
    return revisionTransaction(userId, ref, expectedRevision, "draft", async (transaction) => {
      online(userId);
      if (signal?.aborted) throw Object.assign(new Error("Draft operation cancelled."), { name: "AbortError" });
      const existing = (await transaction.get(ref)).data();
      if (!value && (!existing || existing.deleted)) return;
      checkRevision(existing, expectedRevision, "draft");
      const revision = (existing?.revision || 0) + 1;
      // A tombstone keeps revisions increasing across delete/recreate cycles.
      transaction.set(ref, { invoice: value, revision, deleted: !value, updatedAt: serverTimestamp() });
      return { revision };
    });
  }

  async function allocateNumber(invoiceDate, reserve) {
    const uid = owner();
    online(uid);
    const date = String(invoiceDate).replace(/-/g, "");
    if (!/^\d{8}$/.test(date)) throw new Error("Choose a valid invoice date.");
    const ref = sequenceRef(uid, date);
    const format = (value) => {
      if (value > 999999) throw new Error("The invoice sequence for this date is full.");
      return `EHR-${date}-${String(value).padStart(3, "0")}`;
    };
    if (!reserve) {
      const snapshot = await getDocFromServer(ref);
      owner(uid);
      return format((snapshot.data()?.sequence || 0) + 1);
    }
    return runTransaction(db, async (transaction) => {
      online(uid);
      const sequence = ((await transaction.get(ref)).data()?.sequence || 0) + 1;
      const number = format(sequence);
      transaction.set(ref, { sequence });
      return number;
    });
  }

  async function migrateLocalData(uid, records, draft, sequences = [], payments = [], organization = {}) {
    online(uid);
    const prepared = (records || []).map((record) => ({ ...record, id: validId(record.id), invoice: cleanInvoice(record.invoice) }));
    const localDraft = draft ? cleanInvoice(draft) : null;
    const numbering = Array.isArray(sequences) ? sequences : [sequences];
    for (const value of numbering) {
      if (!value || !/^\d{8}$/.test(value.date) || !Number.isInteger(value.sequence) || value.sequence < 1 || value.sequence > 999999) {
        throw new Error("The backup contains an invalid invoice sequence.");
      }
    }
    // Import is retryable: existing IDs are never overwritten. A colliding record
    // must be resolved by the user, with the original browser backup preserved.
    for (const record of prepared) {
      const existing = (await getDocFromServer(invoiceRef(uid, record.id))).data();
      owner(uid);
      if (existing) {
        const desired = { ...record.invoice, historyId: record.id, draftDirty: false };
        if (canonicalInvoice(existing.invoice) !== canonicalInvoice(desired)) throw new Error("An imported invoice ID already belongs to a different saved invoice. Your local copy is preserved; download its backup before continuing.");
      } else {
        await saveInvoice(uid, { ...record, revision: undefined }, { preserveCreatedAt: true });
      }
    }
    for (const value of numbering) {
      await runTransaction(db, async (transaction) => {
        online(uid);
        const ref = sequenceRef(uid, value.date);
        const previous = (await transaction.get(ref)).data()?.sequence || 0;
        if (value.sequence > previous) transaction.set(ref, { sequence: value.sequence });
      });
    }
    if (localDraft) {
      if (prepared.some((record) => record.id === localDraft.historyId)) {
        const imported = (await getDocFromServer(invoiceRef(uid, localDraft.historyId))).data();
        owner(uid);
        localDraft.historyRevision = imported.revision;
      }
      const saved = await loadDraft(uid);
      if (saved && canonicalInvoice(saved.invoice) !== canonicalInvoice(localDraft)) throw new Error("Your account already has a draft. The invoices have been imported and the local copy is preserved. Review the account draft before importing the local draft.");
      if (!saved) await writeDraft(uid, localDraft, undefined, undefined);
    }
    for (const payment of payments) {
      if (!prepared.some((record) => record.id === payment.id)) throw new Error("Payment backup does not match an imported invoice.");
      const current = await loadPayment(uid, payment.id);
      if (current.revision) {
        if (current.status !== payment.status || current.remarks !== payment.remarks || current.screenshot !== (payment.screenshot || "")) throw new Error("Payment details already exist. Existing evidence was preserved.");
      } else await savePayment(uid, payment.id, { ...payment, revision: undefined, confirmed: payment.status !== "unpaid" });
    }
    const remaining = [...(organization.folders || [])];
    const restored = new Set([""]);
    while (remaining.length) {
      const index = remaining.findIndex(folder => restored.has(folder.parentId));
      if (index < 0) throw new Error("The backup contains an invalid folder hierarchy.");
      const [folder] = remaining.splice(index, 1);
      await createFolder(uid, folder.name, folder.parentId, folder.id);
      restored.add(folder.id);
    }
    const existingPlacements = new Map((await loadFolders(uid)).placements.map(entry => [entry.id, entry.folderId]));
    for (const entry of organization.placements || []) {
      if (!prepared.some(record => record.id === entry.id)) throw new Error("Folder placement does not match an imported invoice.");
      const previous = existingPlacements.get(entry.id) || "";
      if (previous && previous !== entry.folderId) throw new Error("An invoice already belongs to another folder. Its location was preserved.");
      await moveInvoice(uid, entry.id, entry.folderId, previous);
    }
    return { imported: prepared.length };
  }

  return {
    async listProfiles() {
      owner();
      const snapshot = await getDocsFromServer(collection(db, "users", auth.currentUser.uid, "profiles"));
      const profiles = snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
      if (!profiles.some(profile => profile.id === "default")) profiles.unshift({ id: "default", name: "My business", logo: "", terms: null });
      return profiles;
    },
    activeProfileId: selectedProfile,
    async saveProfile(profile) {
      owner();
      const id = profile.id || crypto.randomUUID();
      const name = String(profile.name || "").trim();
      if (!name || name.length > 80) throw new Error("Enter a profile name up to 80 characters.");
      const value = { name, logo: profile.logo || "", terms: profile.terms ?? "" };
      await setDoc(doc(db, "users", auth.currentUser.uid, "profiles", validId(id)), value);
      return { id, ...value };
    },
    async selectProfile(id) {
      const profiles = await this.listProfiles();
      if (!profiles.some(profile => profile.id === id)) throw new Error("This profile is unavailable.");
      environment.sessionStorage.setItem(`quotini-profile:${auth.currentUser.uid}`, id);
    },
    configured: true, guestMode: false, localMode: false, provider: "firebase",
    async getSession() { await auth.authStateReady(); return session(); },
    onAuthStateChange(callback) { listeners.add(callback); return { unsubscribe: () => listeners.delete(callback) }; },
    async signIn(email, password) { await signInWithEmailAndPassword(auth, email, password); return { session: session() }; },
    async signInWithGoogle() {
      if (directGoogleSignIn) {
        const token = await directGoogleSignIn();
        await signInWithCredential(auth, GoogleAuthProvider.credential(null, token));
        return { session: session() };
      }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      // Keep the popup flow on Pages: cross-domain redirects cannot reliably
      // recover their result under Safari's third-party storage restrictions.
      await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      return { session: session() };
    },
    async signUp(email, password) { await createUserWithEmailAndPassword(auth, email, password); return { session: session() }; },
    async sendPasswordReset(email) {
      try { await sendPasswordResetEmail(auth, email); }
      catch (error) { if (error.code !== "auth/user-not-found") throw error; }
    },
    async preparePasswordRecovery(url) {
      const params = new URL(url).searchParams;
      if (params.get("mode") !== "resetPassword") return false;
      resetCode = params.get("oobCode");
      if (!resetCode) throw new Error("This password reset link is incomplete. Request a new one.");
      await verifyPasswordResetCode(auth, resetCode);
      return true;
    },
    async updatePassword(password) {
      if (resetCode) { await confirmPasswordReset(auth, resetCode, password); resetCode = undefined; }
      else { owner(); await updatePassword(auth.currentUser, password); }
    },
    signOut: () => signOut(auth),
    listInvoices, saveInvoice, deleteInvoice, loadDraft, loadPayment, savePayment, loadFolders, createFolder, moveInvoice, ensureBookingFolders, createBookingFolders, listAttachments, uploadAttachment, downloadAttachment, deleteAttachment,
    pdfStorageAvailable, saveInvoicePdf, loadInvoicePdf,
    saveDraft: writeDraft,
    deleteDraft: (uid, signal, revision) => writeDraft(uid, null, signal, revision),
    nextInvoiceNumber: (date) => allocateNumber(date, false),
    reserveInvoiceNumber: (date) => allocateNumber(date, true),
    migrateLocalData,
    async exportAccountData(uid) {
      online(uid);
      const [history, draft, sequences] = await Promise.all([
        getDocsFromServer(invoices(uid)), loadDraft(uid),
        getDocsFromServer(collection(db, ...scope(uid), "sequences")),
      ]);
      owner(uid);
      return { version: 1, exportedAt: new Date().toISOString(), source: "Quotini business profile", profile: (await this.listProfiles()).find(profile => profile.id === selectedProfile()), organization: await loadFolders(uid), payments: await Promise.all(history.docs.map(async (entry) => ({ id: entry.id, ...await loadPayment(uid, entry.id) }))), history: history.docs.map((entry) => asRecord(entry.data())), draft: draft?.invoice || null, draftRevision: draft?.revision || null,
        sequences: sequences.docs.map((entry) => ({ date: entry.id, sequence: entry.data().sequence })) };
    },
    exportLocalData: localBackend?.exportLocalData,
    restoreLocalData: localBackend?.restoreLocalData,
    clearLocalData: localBackend?.clearLocalData,
    // Used by emulator tests to release SDK connections after each scenario.
    close: () => terminate(db),
  };
}

if (typeof window !== "undefined") window.createFirebaseInvoiceBackend = createFirebaseInvoiceBackend;
