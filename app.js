var activeBusinessProfile;
const EMPTY_PROFILE_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const DEFAULT_INVOICE_TERMS = "Please note that all payments made for weekend market space bookings are non-refundable upon confirmation, as the space will be reserved exclusively for you.\n\nShould you be unable to participate, we may, at our discretion and subject to availability, allow your booking to be transferred to a replacement date or future pop-up event.";
const STORAGE_KEY = "invoice-studio-draft-v1";
const DRAFT_REVISION_KEY = "invoice-studio-guest-draft-revision-v1";
const SEQUENCE_KEY = "invoice-studio-sequence-v1";
const HISTORY_KEY = "invoice-studio-history-v1";
const RESTORE_JOURNAL_KEY = "invoice-studio-restore-journal-v1";
const PAPER_WIDTH = 793.7;
const PAPER_HEIGHT = 1122.52;
const MAX_QUANTITY = 9999;
const MAX_PRICE = 999999999.99;
const MIN_PRICE = -MAX_PRICE;
const MAX_ITEM_DESCRIPTION_LENGTH = 1000;
const MAX_BILL_TO_LENGTH = 2000;
const HISTORY_PAGE_SIZE = 25;
const DRAFT_RETRY_MAX_DELAY = 30000;
const PDF_LIBRARY_URL = "./vendor/html2pdf.bundle.min.js?v=33";
const backend = window.invoiceBackend;
const draftOutbox = window.invoiceDraftOutbox;

const form = document.querySelector("#invoiceForm");
const itemsEditor = document.querySelector("#itemsEditor");
const previewItems = document.querySelector("#previewItems");
const previewStage = document.querySelector("#previewStage");
const paperScaleWrap = document.querySelector("#paperScaleWrap");
const invoiceSheet = document.querySelector("#invoiceSheet");
const saveStatus = document.querySelector("#saveStatus");
const toast = document.querySelector("#toast");
const appLoadingScreen = document.querySelector("#appLoadingScreen");
const installButton = document.querySelector("#installButton");
const updateButton = document.querySelector("#updateButton");
const offlineBanner = document.querySelector("#offlineBanner");
const outputDialog = document.querySelector("#outputDialog");
const outputFileName = document.querySelector("#outputFileName");
const cloudPdfPanel = document.querySelector("#cloudPdfPanel");
const cloudPdfStatus = document.querySelector("#cloudPdfStatus");
const retryCloudPdfButton = document.querySelector("#retryCloudPdfButton");
const savePdfButton = document.querySelector("#savePdfButton");
const savePdfButtonLabel = document.querySelector("#savePdfButtonLabel");
const printNowButton = document.querySelector("#printNowButton");
const closeOutputDialogButton = document.querySelector("#closeOutputDialogButton");
const cancelOutputDialogButton = document.querySelector("#cancelOutputDialogButton");
const fitPreviewButton = document.querySelector("#fitPreviewButton");
const actualSizePreviewButton = document.querySelector("#actualSizePreviewButton");
const backToEditorButton = document.querySelector("#backToEditorButton");
const invoiceListPage = document.querySelector("#invoiceListPage");
const editorPage = document.querySelector("#editorPage");
const invoiceListButton = document.querySelector("#invoiceListButton");
const newInvoiceButton = document.querySelector("#newInvoiceButton");
const printButton = document.querySelector("#printButton");
const editorTitle = document.querySelector("#editorTitle");
const pdfFileNameInput = document.querySelector("#pdfFileName");
const customizePdfFileName = document.querySelector("#customizePdfFileName");
const pdfFileNameHelp = document.querySelector("#pdfFileNameHelp");
const invoiceHistoryList = document.querySelector("#invoiceHistoryList");
const historyEmptyState = document.querySelector("#historyEmptyState");
const historyNoResults = document.querySelector("#historyNoResults");
const invoiceCount = document.querySelector("#invoiceCount");
const invoiceSearch = document.querySelector("#invoiceSearch");
const invoiceSearchField = document.querySelector("#invoiceSearchField");
const historyNewInvoiceButton = document.querySelector("#historyNewInvoiceButton");
const historySection = document.querySelector("#historySection");
const historyLoadingState = document.querySelector("#historyLoadingState");
const historyErrorState = document.querySelector("#historyErrorState");
const retryHistoryButton = document.querySelector("#retryHistoryButton");
const loadMoreInvoicesButton = document.querySelector("#loadMoreInvoicesButton");
const draftNotice = document.querySelector("#draftNotice");
const draftNoticeSummary = document.querySelector("#draftNoticeSummary");
const authPage = document.querySelector("#authPage");
const authConfigurationState = document.querySelector("#authConfigurationState");
const workspaceErrorState = document.querySelector("#workspaceErrorState");
const authSignInState = document.querySelector("#authSignInState");
const authForm = document.querySelector("#authForm");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authMessage = document.querySelector("#authMessage");
const googleSignInButton = document.querySelector("#googleSignInButton");
const createAccountButton = document.querySelector("#createAccountButton");
const forgotPasswordButton = document.querySelector("#forgotPasswordButton");
const passwordRecoveryForm = document.querySelector("#passwordRecoveryForm");
const recoveryPassword = document.querySelector("#recoveryPassword");
const recoveryPasswordConfirm = document.querySelector("#recoveryPasswordConfirm");
const accountControls = document.querySelector("#accountControls");
const accountEmail = document.querySelector("#accountEmail");
const syncStatus = document.querySelector("#syncStatus");
const signOutButton = document.querySelector("#signOutButton");
const historyStorageNote = document.querySelector(".history-storage-note");
const legacyMigrationDialog = document.querySelector("#legacyMigrationDialog");
const legacyMigrationSummary = document.querySelector("#legacyMigrationSummary");
const legacyMigrationDestination = document.querySelector("#legacyMigrationDestination");
const legacyMigrationMessage = document.querySelector("#legacyMigrationMessage");
const moveLegacyDataButton = document.querySelector("#moveLegacyDataButton");
const exportLegacyDataButton = document.querySelector("#exportLegacyDataButton");
const discardLegacyDataButton = document.querySelector("#discardLegacyDataButton");
const cancelLegacyMigrationButton = document.querySelector("#cancelLegacyMigrationButton");
const draftConflictDialog = document.querySelector("#draftConflictDialog");
const localDraftConflictSummary = document.querySelector("#localDraftConflictSummary");
const cloudDraftConflictSummary = document.querySelector("#cloudDraftConflictSummary");
const keepLocalDraftButton = document.querySelector("#keepLocalDraftButton");
const keepCloudDraftButton = document.querySelector("#keepCloudDraftButton");
const storageRecoveryPage = document.querySelector("#storageRecoveryPage");
const storageRecoveryMessage = document.querySelector("#storageRecoveryMessage");
const storageRecoveryDetail = document.querySelector("#storageRecoveryDetail");
const recoveryExportButton = document.querySelector("#recoveryExportButton");
const recoveryImportButton = document.querySelector("#recoveryImportButton");
const recoveryRetryButton = document.querySelector("#recoveryRetryButton");
const recoveryClearButton = document.querySelector("#recoveryClearButton");
const exportDataButton = document.querySelector("#exportDataButton");
const importDataButton = document.querySelector("#importDataButton");
const importDataFile = document.querySelector("#importDataFile");

let state = createInvoiceDraft();
let invoiceHistory = [];
let saveTimer;
let toastTimer;
let installPrompt;
let draftPersistenceEnabled = true;
let draftChanged = false;
let outputBusy = false;
let invoiceSaving = false;
let outputDialogTrigger;
let outputPdfContext;
let currentPage = "history";
let historyQuery = "";
let currentFolderId = null;
let invoiceFolders = [];
let folderAction = null;
let historyNextCursor;
let historyTotal = 0;
let historyLoading = false;
let historyLoadError = false;
let historyRequestVersion = 0;
let historySearchTimer;
let previewScaleMode = "fit";
let currentUser;
let workspaceLoading = false;
let draftWriteQueue = Promise.resolve();
let outboxWriteQueue = Promise.resolve();
let draftSaveVersion = 0;
let draftRevision;
let draftWriteAbortController = new AbortController();
let sessionEpoch = 0;
let authStateVersion = 0;
let pendingLegacyMigration;
let resolveLegacyMigration;
let draftRetryTimer;
let draftSyncPromise;
let draftConflictOperation;
let draftConflictRemote;
let resolveDraftConflictChoice;
let pdfLibraryPromise;
let authBusy = false;
let pendingAuthEmailRequest = "";
let pendingAuthEmailRequestUntil = 0;
let authEmailRequestsBlockedUntil = 0;
let editorMode = "new";
let waitingServiceWorker;
let serviceWorkerUpdateRequested = false;
let serviceWorkerRegistration;
let serviceWorkerUpdateCheck = 0;
let reloadingForServiceWorker = false;
let draftStorageRefreshTimer;

function normalizeInvoiceData(value) {
  if (!value || !Array.isArray(value.items) || value.items.length === 0) return null;
  const invoiceNumber = String(value.invoiceNumber || "").toLocaleUpperCase("en-SG").slice(0, 120);
  const savedPdfFileName = String(value.pdfFileName || "").trim().slice(0, 120);
  const pdfFileNameCustomized = typeof value.pdfFileNameCustomized === "boolean"
    ? value.pdfFileNameCustomized
    : Boolean(savedPdfFileName && savedPdfFileName !== invoiceNumber);
  return {
    historyId: typeof value.historyId === "string" ? value.historyId.slice(0, 160) : undefined,
    historyRevision: Number.isInteger(value.historyRevision) ? value.historyRevision : undefined,
    draftDirty: Boolean(value.draftDirty),
    invoiceNumber,
    pdfFileName: pdfFileNameCustomized
      ? savedPdfFileName || invoiceNumber || "invoice"
      : invoiceNumber || savedPdfFileName || "invoice",
    pdfFileNameCustomized,
    invoiceDate: String(value.invoiceDate || ""),
    dueDate: String(value.dueDate || ""),
    billTo: String(value.billTo || "").toLocaleUpperCase("en-SG").slice(0, MAX_BILL_TO_LENGTH),
    igHandle: String(value.igHandle || "").slice(0, 31),
    terms: typeof value.terms === "string" ? value.terms.slice(0, 1000) : DEFAULT_INVOICE_TERMS,
    logo: typeof value.logo === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.logo) && value.logo.length <= 120000 ? value.logo : "",
    items: value.items.slice(0, 5).map((item, index) => ({
      id: String(item?.id || `item-${Date.now()}-${index}`).slice(0, 160),
      quantity: normalizeDraftQuantity(item?.quantity),
      description: String(item?.description || "").slice(0, MAX_ITEM_DESCRIPTION_LENGTH),
      price: normalizeDraftPrice(item?.price),
    })),
  };
}

function normalizeDraftQuantity(value) {
  if (value === "" || value === null || value === undefined) return "";
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : "";
}

function normalizeDraftPrice(value) {
  if (value === "" || value === null || value === undefined) return "";
  const price = Number(value);
  return Number.isFinite(price) ? price : "";
}

function loadLegacyDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeInvoiceData(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadLegacyInvoiceHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .map((record) => {
        const id = typeof record?.id === "string" ? record.id : "";
        const invoice = normalizeInvoiceData(record?.invoice);
        if (!id || seen.has(id) || !invoice) return null;
        seen.add(id);
        invoice.historyId = id;
        return {
          id,
          createdAt: String(record.createdAt || record.updatedAt || ""),
          updatedAt: String(record.updatedAt || record.createdAt || ""),
          invoice,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function setAuthMessage(message = "", stateName = "") {
  authMessage.textContent = message;
  if (stateName) authMessage.dataset.state = stateName;
  else authMessage.removeAttribute("data-state");
}

function normalizeAuthEmail(value) {
  return String(value || "").trim().toLocaleLowerCase("en-SG");
}

function updateAuthEmailActions() {
  if (authBusy) return;
  if (authEmailRequestsBlockedUntil <= Date.now()) authEmailRequestsBlockedUntil = 0;
  if (pendingAuthEmailRequestUntil <= Date.now()) {
    pendingAuthEmailRequest = "";
    pendingAuthEmailRequestUntil = 0;
  }
  const emailRequestPending = authEmailRequestsBlockedUntil > Date.now() || Boolean(
    pendingAuthEmailRequest && normalizeAuthEmail(authEmail.value) === pendingAuthEmailRequest,
  );
  createAccountButton.disabled = emailRequestPending;
  forgotPasswordButton.disabled = emailRequestPending;
}

function markAuthEmailRequested(email, retrySeconds = 60) {
  pendingAuthEmailRequest = normalizeAuthEmail(email);
  pendingAuthEmailRequestUntil = Date.now() + Math.max(1, retrySeconds) * 1000;
  window.setTimeout(updateAuthEmailActions, Math.max(1, retrySeconds) * 1000);
  updateAuthEmailActions();
}

function blockAuthEmailRequests(retrySeconds = 3600) {
  authEmailRequestsBlockedUntil = Date.now() + Math.max(1, retrySeconds) * 1000;
  window.setTimeout(updateAuthEmailActions, Math.max(1, retrySeconds) * 1000);
  updateAuthEmailActions();
}

function authEmailRetrySeconds(error) {
  return Number(String(error?.message || "").match(/after\s+(\d+)\s+seconds?/i)?.[1]) || 0;
}

function authFailureMessage(error, action) {
  const code = String(error?.code || "");
  const firebaseMessages = {
    "auth/invalid-credential": action === "google-sign-in"
      ? "Google could not verify this sign-in. Please try again."
      : "The email or password is incorrect.",
    "auth/invalid-login-credentials": "The email or password is incorrect.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/user-not-found": "The email or password is incorrect.",
    "auth/email-already-in-use": "An account already uses this email. Sign in or reset your password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/password-does-not-meet-requirements": "Choose a stronger password that meets your account's password requirements.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes before trying again.",
    "auth/network-request-failed": "Check your internet connection and try again.",
    "auth/user-disabled": "This account has been disabled. Contact the app administrator.",
    "auth/operation-not-allowed": action === "google-sign-in"
      ? "Google sign-in is not enabled yet. Use email sign-in or contact the app administrator."
      : "Email sign-in is not enabled yet. Contact the app administrator.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled. You can try again when ready.",
    "auth/cancelled-popup-request": "Google sign-in was interrupted. Please try again.",
    "auth/unauthorized-domain": "Google sign-in is not available on this website address yet. Contact the app administrator.",
    "auth/invalid-oauth-client-id": "Google sign-in is not configured correctly. Contact the app administrator.",
    "auth/operation-not-supported-in-this-environment": "Open Quotini in a regular browser to sign in with Google.",
    "auth/web-storage-unsupported": "Your browser must allow site storage to sign in with Google. Check your browser settings and try again.",
    "auth/account-exists-with-different-credential": "This email already has an account using another sign-in method. Use that method to access your existing invoices.",
    "auth/invalid-api-key": "The account connection is not configured correctly. Contact the app administrator.",
    "auth/expired-action-code": "This reset link has expired. Request a new password reset email.",
    "auth/invalid-action-code": "This reset link is invalid or already used. Request a new password reset email.",
    "auth/requires-recent-login": "Sign in again before changing your password.",
  };
  if (firebaseMessages[code]) return firebaseMessages[code];
  if (code === "email_not_confirmed") {
    return "Confirm your email before signing in. Use the newest confirmation email, then return here.";
  }
  if (code === "over_email_send_rate_limit") {
    const retrySeconds = authEmailRetrySeconds(error);
    return retrySeconds
      ? `A confirmation or reset email was requested too recently. Wait ${retrySeconds} seconds and use the newest email.`
      : "The email service limit has been reached. Use the newest email already received, or try again after the hourly allowance resets.";
  }
  if (Number(error?.status) === 429 || code === "over_request_rate_limit") {
    return action === "sign-in"
      ? "Too many sign-in attempts were made. Wait a few minutes before trying again."
      : "Too many requests were made. Wait a few minutes before trying again.";
  }
  if (code === "invalid_credentials") {
    return "The email or password is incorrect.";
  }
  return error?.message || (action === "sign-in"
    ? "Sign-in failed. Check your email and password."
    : "The authentication request could not be completed.");
}

function setAuthBusy(isBusy) {
  authBusy = isBusy;
  updateButton.disabled = isBusy || serviceWorkerUpdateRequested;
  for (const button of authPage.querySelectorAll("button")) button.disabled = isBusy;
  authPage.setAttribute("aria-busy", String(isBusy));
  if (!isBusy) updateAuthEmailActions();
}

function neutralizeDraftWrites() {
  clearTimeout(saveTimer);
  clearTimeout(draftRetryTimer);
  draftSaveVersion += 1;
  sessionEpoch += 1;
  document.querySelector("#paymentDialog")?.close();
  document.querySelector("#paymentFilter").value = "all";
  draftPersistenceEnabled = false;
  draftChanged = false;
  draftRevision = undefined;
  draftWriteAbortController.abort();
  draftWriteAbortController = new AbortController();
  draftWriteQueue = Promise.resolve();
  draftSyncPromise = undefined;
}

function clearCredentialInputs() {
  authEmail.value = "";
  authPassword.value = "";
  recoveryPassword.value = "";
  recoveryPasswordConfirm.value = "";
  recoveryPasswordConfirm.setCustomValidity("");
}

function finishLegacyMigrationPrompt(action) {
  const resolve = resolveLegacyMigration;
  resolveLegacyMigration = undefined;
  pendingLegacyMigration = undefined;
  if (legacyMigrationDialog.open) legacyMigrationDialog.close();
  if (resolve) resolve(action);
}

function clearSensitiveWorkspace() {
  neutralizeDraftWrites();
  clearOutputPdfContext();
  setOutputBusy(false);
  invoiceHistory = [];
  currentFolderId = null;
  invoiceFolders = [];
  document.querySelector("#folderDialog")?.close();
  document.querySelector("#attachmentsDialog")?.close();
  document.querySelector("#settingsPage").hidden = true;
  editingBusinessProfile = null;
  activeBusinessProfile = undefined;
  historyNextCursor = undefined;
  historyTotal = 0;
  historyLoading = false;
  historyLoadError = false;
  historyRequestVersion += 1;
  historyQuery = "";
  invoiceSearch.value = "";
  state = createInvoiceDraft();
  state.draftDirty = false;
  currentPage = "history";
  clearValidationErrors();
  fillForm();
  renderInvoiceHistory();
  outputFileName.textContent = "";
  accountEmail.textContent = "";
  setDraftSyncStatus("synced", "All changes synced");
  if (outputDialog.open) outputDialog.close();
  if (draftConflictDialog.open) draftConflictDialog.close();
  resolveDraftConflictChoice?.("signed-out");
  resolveDraftConflictChoice = undefined;
  draftConflictOperation = undefined;
  draftConflictRemote = undefined;
  finishLegacyMigrationPrompt("signed-out");
  clearCredentialInputs();
}

function hideWorkspace() {
  document.querySelector("#settingsPage").hidden = true;
  document.querySelector("#editProfileButton").hidden = true;
  document.querySelector("#profileControls").hidden = true;
  invoiceListPage.hidden = true;
  editorPage.hidden = true;
  invoiceListButton.hidden = true;
  newInvoiceButton.hidden = true;
  printButton.hidden = true;
}

function showSignedOutPage() {
  currentUser = undefined;
  workspaceLoading = false;
  clearSensitiveWorkspace();
  hideWorkspace();
  accountControls.hidden = true;
  storageRecoveryPage.hidden = true;
  authPage.hidden = false;
  authConfigurationState.hidden = true;
  workspaceErrorState.hidden = true;
  authSignInState.hidden = false;
  passwordRecoveryForm.hidden = true;
  authPage.setAttribute("aria-labelledby", "authTitle");
  document.body.dataset.page = "auth";
  document.title = "Sign in | Quotini";
  setAuthMessage();
  authEmail.focus({ preventScroll: true });
}

function showConfigurationPage() {
  currentUser = undefined;
  clearSensitiveWorkspace();
  hideWorkspace();
  accountControls.hidden = true;
  storageRecoveryPage.hidden = true;
  authPage.hidden = false;
  authConfigurationState.hidden = false;
  workspaceErrorState.hidden = true;
  authSignInState.hidden = true;
  passwordRecoveryForm.hidden = true;
  authPage.setAttribute("aria-labelledby", "configurationTitle");
  document.body.dataset.page = "auth";
  document.title = "Connect account | Quotini";
  setAuthMessage(backend?.configurationError || "", "error");
}

function showPasswordRecoveryPage() {
  hideWorkspace();
  storageRecoveryPage.hidden = true;
  authPage.hidden = false;
  authConfigurationState.hidden = true;
  workspaceErrorState.hidden = true;
  authSignInState.hidden = true;
  passwordRecoveryForm.hidden = false;
  authPage.setAttribute("aria-labelledby", "recoveryTitle");
  document.body.dataset.page = "auth";
  document.title = "Set a new password | Quotini";
  setAuthMessage();
  recoveryPassword.focus({ preventScroll: true });
}

function legacyStorageData() {
  const hasLegacyDraft = localStorage.getItem(STORAGE_KEY) !== null;
  const hasLegacyHistory = localStorage.getItem(HISTORY_KEY) !== null;
  const hasLegacySequence = localStorage.getItem(SEQUENCE_KEY) !== null;
  const records = loadLegacyInvoiceHistory();
  const draft = loadLegacyDraft();
  let importable = true;
  try {
    const rawHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    importable = Array.isArray(rawHistory) && rawHistory.length === records.length
      && (!hasLegacyDraft || Boolean(draft)) && !localStorage.getItem(RESTORE_JOURNAL_KEY);
  } catch { importable = false; }
  return {
    present: hasLegacyDraft || hasLegacyHistory || hasLegacySequence,
    draft, records, importable,
    sequence: legacyExportValue(SEQUENCE_KEY),
  };
}

function clearLegacyStorage() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(SEQUENCE_KEY);
  localStorage.removeItem(DRAFT_REVISION_KEY);
}

function legacyExportValue(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { unreadableRawValue: raw };
  }
}

function localBackupData() {
  let backup;
  try {
    backup = typeof backend.exportLocalData === "function"
      ? backend.exportLocalData()
      : {
        version: 1,
        exportedAt: new Date().toISOString(),
        source: "Quotini browser storage",
        history: legacyExportValue(HISTORY_KEY),
        draft: legacyExportValue(STORAGE_KEY),
        sequence: legacyExportValue(SEQUENCE_KEY),
      };
  } catch (error) {
    if (!['LOCAL_STORAGE_UNAVAILABLE', 'LOCAL_DATA_CORRUPT'].includes(error?.code)) throw error;
    backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      source: "Quotini open-tab recovery",
      history: { unavailable: true, message: error.message },
      draft: null,
      draftRevision: null,
      sequence: null,
    };
  }
  if (currentUser && (hasUnsavedDraft() || hasEnteredContent())) {
    backup.draft = cloneInvoice(state);
    backup.draftRevision = draftRevision ?? null;
    backup.openTabDraftIncluded = true;
  }
  return backup;
}

function downloadLocalBackup(options = {}) {
  const backup = localBackupData();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quotini-local-backup-${isoDate(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  if (options.migration) {
    legacyMigrationMessage.textContent = "Backup downloaded. Choose whether to move, discard, or keep the local data.";
  } else if (options.recovery) {
    storageRecoveryDetail.textContent = "Recovery backup downloaded. Keep it somewhere safe before clearing any data.";
  } else {
    showToast("Local backup downloaded.");
  }
}

async function downloadWorkspaceBackup() {
  if (backend.guestMode) return downloadLocalBackup();
  const uid = currentUser?.id;
  exportDataButton.disabled = true;
  try {
    const backup = await backend.exportAccountData(uid);
    if (currentUser?.id !== uid) return;
    if (hasUnsavedDraft()) {
      backup.draft = cloneInvoice(state);
      backup.draftRevision = draftRevision ?? null;
      backup.openTabDraftIncluded = true;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `quotini-account-backup-${isoDate(new Date())}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("Account backup downloaded.");
  } catch (error) {
    if (currentUser?.id === uid) showToast(error?.message || "The account backup could not be downloaded.");
  } finally { exportDataButton.disabled = false; }
}

function exportLegacyBrowserData() {
  try {
    downloadLocalBackup({ migration: true });
  } catch (error) {
    legacyMigrationMessage.textContent = error?.message || "The backup could not be created.";
    legacyMigrationMessage.dataset.state = "error";
  }
}

function requestBackupRestore() {
  importDataFile.value = "";
  importDataFile.click();
}

async function restoreBackupFile(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backend.guestMode && currentUser) {
      if (!Array.isArray(backup.history) || (backup.draft && !Array.isArray(backup.draft.items))) throw new Error("Choose a valid Quotini backup file.");
      if (!window.confirm("Import this backup into the current business profile? Existing invoices will be preserved.")) return;
      await persistDraftImmediately();
      await backend.migrateLocalData(currentUser.id, backup.history, backup.draft, backup.sequences || (backup.sequence ? [backup.sequence] : []), backup.payments || [], backup.organization || {});
      if (backup.profile && backend.saveProfile) await backend.saveProfile({ ...backup.profile, id: backend.activeProfileId() });
    } else {
      if (typeof backend.restoreLocalData !== "function") throw new Error("Backup restore is unavailable in this build.");
      backend.restoreLocalData(backup);
    }
    if (currentUser) await draftOutbox.remove(currentUser.id);
    showToast("Backup restored. Reloading your invoices...");
    window.setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    const message = error instanceof SyntaxError ? "That file is not valid JSON." : (error?.message || "The backup could not be restored.");
    if (!storageRecoveryPage.hidden) storageRecoveryDetail.textContent = message;
    showToast(message);
  }
}

function showStorageRecovery(error) {
  currentPage = "recovery";
  document.body.dataset.page = "recovery";
  authPage.hidden = true;
  invoiceListPage.hidden = true;
  editorPage.hidden = true;
  storageRecoveryPage.hidden = false;
  accountControls.hidden = true;
  invoiceListButton.hidden = true;
  newInvoiceButton.hidden = true;
  printButton.hidden = true;
  storageRecoveryMessage.textContent = error?.message || "Quotini could not access this browser's local storage.";
  storageRecoveryDetail.textContent = error?.storageKey
    ? `Affected storage area: ${error.storageKey}`
    : "Your existing local data has not been intentionally changed.";
  document.title = "Local data recovery | Quotini";
  requestAnimationFrame(() => document.querySelector("#storageRecoveryTitle")?.focus({ preventScroll: true }));
}

async function clearRecoveryData() {
  if (!window.confirm("Permanently clear Quotini invoices and drafts from this browser? Download a recovery backup first.")) return;
  try {
    if (typeof backend.clearLocalData !== "function") throw new Error("Local data clearing is unavailable in this build.");
    backend.clearLocalData();
    if (currentUser) await draftOutbox.remove(currentUser.id);
    window.location.reload();
  } catch (error) {
    storageRecoveryDetail.textContent = error?.message || "Local data could not be cleared.";
  }
}

function setLegacyMigrationBusy(isBusy) {
  for (const button of legacyMigrationDialog.querySelectorAll("button")) button.disabled = isBusy;
  legacyMigrationDialog.setAttribute("aria-busy", String(isBusy));
}

function promptForLegacyMigration(session) {
  if (backend.guestMode) return Promise.resolve("none");
  const legacy = legacyStorageData();
  if (!legacy.present) return Promise.resolve("none");

  pendingLegacyMigration = { ...legacy, userId: session.user.id };
  const invoiceCount = legacy.records.length;
  const parts = [`${invoiceCount} saved ${invoiceCount === 1 ? "invoice" : "invoices"}`];
  if (legacy.draft) parts.push("1 draft");
  if (invoiceCount === 0 && !legacy.draft) parts.push("unreadable local data");
  legacyMigrationSummary.textContent = parts.join(" and ");
  legacyMigrationDestination.textContent = session.user.email || "this signed-in account";
  legacyMigrationMessage.textContent = "Nothing has been moved yet.";
  legacyMigrationMessage.removeAttribute("data-state");
  setLegacyMigrationBusy(false);
  moveLegacyDataButton.disabled = !legacy.importable || (invoiceCount === 0 && !legacy.draft);
  if (!legacy.importable) legacyMigrationMessage.textContent = "Some local records need recovery. Download a backup before changing this browser's data, or use your account without importing.";
  legacyMigrationDialog.showModal();
  return new Promise((resolve) => {
    resolveLegacyMigration = resolve;
  });
}

async function moveLegacyBrowserData() {
  if (!pendingLegacyMigration?.importable) return;
  const migration = pendingLegacyMigration;
  setLegacyMigrationBusy(true);
  legacyMigrationMessage.textContent = "Moving the selected local data...";
  try {
    await backend.migrateLocalData(
      migration.userId,
      migration.records,
      migration.draft,
      migration.sequence ? [migration.sequence] : [],
    );
    if (currentUser?.id !== migration.userId || pendingLegacyMigration !== migration) return;
    clearLegacyStorage();
    finishLegacyMigrationPrompt("moved");
  } catch (error) {
    setLegacyMigrationBusy(false);
    legacyMigrationMessage.textContent = error?.message || "The local data could not be moved. It is still stored in this browser.";
    legacyMigrationMessage.dataset.state = "error";
  }
}

function discardLegacyBrowserData() {
  if (!window.confirm("Permanently discard this browser's local invoices and draft? Download a backup first.")) return;
  clearLegacyStorage();
  finishLegacyMigrationPrompt("discarded");
}

async function cancelLegacyMigration() {
  finishLegacyMigrationPrompt("cancelled");
}

function setDraftSyncStatus(stateName, message) {
  let visibleMessage = message;
  if (backend.guestMode) {
    if (stateName === "syncing") visibleMessage = "Saving on this device...";
    if (stateName === "waiting" || stateName === "synced") visibleMessage = "Saved locally";
  }
  syncStatus.textContent = visibleMessage;
  syncStatus.dataset.state = stateName;
}

function draftSummary(invoice, fallback = "No saved draft") {
  if (!invoice) return fallback;
  const customer = String(invoice.billTo || "").trim() || "Untitled invoice";
  return `${invoice.invoiceNumber || "Draft"} for ${customer}`;
}

function promptForDraftConflict(operation, remoteDraftRecord) {
  draftConflictOperation = operation;
  draftConflictRemote = remoteDraftRecord;
  localDraftConflictSummary.textContent = operation.type === "delete"
    ? "Delete the saved draft"
    : draftSummary(operation.invoice);
  cloudDraftConflictSummary.textContent = draftSummary(remoteDraftRecord?.invoice);
  setDraftSyncStatus("conflict", "Choose which local draft to keep");
  if (!draftConflictDialog.open) draftConflictDialog.showModal();
  return new Promise((resolve) => {
    resolveDraftConflictChoice = resolve;
  });
}

function finishDraftConflictChoice(choice) {
  const resolve = resolveDraftConflictChoice;
  resolveDraftConflictChoice = undefined;
  if (draftConflictDialog.open) draftConflictDialog.close();
  if (resolve) resolve(choice);
}

function retryDelay(attempts) {
  return Math.min(DRAFT_RETRY_MAX_DELAY, 1000 * (2 ** Math.min(Math.max(0, attempts - 1), 5)));
}

function scheduleDraftRetry(delay) {
  clearTimeout(draftRetryTimer);
  if (!currentUser) return;
  draftRetryTimer = window.setTimeout(() => flushDraftOutbox(), Math.max(0, delay));
}

function stageDraftSave() {
  if (!draftPersistenceEnabled || !currentUser) return Promise.resolve(null);
  const userId = currentUser.id;
  const snapshot = cloneInvoice(state);
  const epoch = sessionEpoch;
  const prepared = draftOutbox.prepareSave(userId, snapshot, draftRevision);
  outboxWriteQueue = outboxWriteQueue
    .catch(() => {})
    .then(() => {
      if (epoch !== sessionEpoch || currentUser?.id !== userId) return null;
      return draftOutbox.commit(prepared, draftRevision);
    })
    .then((operation) => {
      if (operation && epoch === sessionEpoch && currentUser?.id === userId) {
        setDraftSyncStatus("waiting", operation?.storage === "memory"
          ? "Draft is only in this open tab"
          : "Saved on this device. Waiting to sync");
      }
      return operation;
    })
    .catch((error) => {
      if (currentUser?.id === userId) setDraftSyncStatus("error", "Draft could not be saved on this device");
      throw error;
    });
  return outboxWriteQueue;
}

function stageDraftDelete() {
  if (!currentUser) return Promise.resolve(null);
  const userId = currentUser.id;
  const epoch = sessionEpoch;
  const prepared = draftOutbox.prepareDelete(userId, draftRevision);
  outboxWriteQueue = outboxWriteQueue
    .catch(() => {})
    .then(() => {
      if (epoch !== sessionEpoch || currentUser?.id !== userId) return null;
      return draftOutbox.commit(prepared, draftRevision);
    })
    .then((operation) => {
      if (operation && epoch === sessionEpoch && currentUser?.id === userId) setDraftSyncStatus("waiting", "Draft deletion waiting to sync");
      return operation;
    });
  return outboxWriteQueue;
}

async function applyDraftConflictChoice(operation, remoteDraftRecord, choice) {
  const userId = operation.userId;
  if (choice === "local") {
    const rebased = await draftOutbox.rebase(userId, operation.operationId, remoteDraftRecord?.revision);
    if (rebased?.type === "save") {
      state = normalizeInvoiceData(rebased.invoice) || state;
      draftChanged = Boolean(state.draftDirty);
      draftPersistenceEnabled = true;
      fillForm();
      renderInvoiceHistory();
    }
    draftRevision = remoteDraftRecord?.revision;
    setDraftSyncStatus("waiting", "Saved on this device. Waiting to sync");
    scheduleDraftRetry(0);
    return;
  }

  await draftOutbox.remove(userId, operation.operationId);
  draftRevision = remoteDraftRecord?.revision;
  if (remoteDraftRecord?.invoice) {
    state = normalizeInvoiceData(remoteDraftRecord.invoice) || state;
    draftChanged = Boolean(state.draftDirty);
    draftPersistenceEnabled = true;
  } else {
    state = await createLocalInvoiceDraft();
    state.draftDirty = false;
    draftChanged = false;
    draftPersistenceEnabled = false;
  }
  fillForm();
  renderInvoiceHistory();
  setDraftSyncStatus("synced", "All changes synced");
}

async function handleDraftConflict(operation) {
  if (!currentUser || currentUser.id !== operation.userId) return;
  let remoteDraftRecord;
  try {
    remoteDraftRecord = await backend.loadDraft(operation.userId);
  } catch {
    const attempts = Number(operation.attempts || 0) + 1;
    const delay = retryDelay(attempts);
    await draftOutbox.markRetry(operation.userId, operation.operationId, attempts, Date.now() + delay, "Could not load the saved draft.");
    setDraftSyncStatus("error", "Draft safe on this device. Sync retrying");
    scheduleDraftRetry(delay);
    return;
  }
  const choice = await promptForDraftConflict(operation, remoteDraftRecord);
  if (choice === "signed-out") return;
  await applyDraftConflictChoice(operation, remoteDraftRecord, choice);
}

async function runDraftOutboxSync(force = false) {
  if (!currentUser) return true;
  const userId = currentUser.id;
  const epoch = sessionEpoch;
  await outboxWriteQueue.catch(() => {});
  const operation = await draftOutbox.get(userId);
  if (epoch !== sessionEpoch || currentUser?.id !== userId) return false;
  if (!operation) {
    setDraftSyncStatus("synced", "All changes synced");
    return true;
  }
  if (!backend.guestMode && !navigator.onLine) {
    setDraftSyncStatus("waiting", "Saved on this device. Waiting to sync");
    return false;
  }
  if (!force && operation.nextAttemptAt > Date.now()) {
    setDraftSyncStatus("waiting", "Draft safe on this device. Sync retrying");
    scheduleDraftRetry(operation.nextAttemptAt - Date.now());
    return false;
  }

  setDraftSyncStatus("syncing", operation.type === "delete" ? "Deleting saved draft..." : "Saving draft...");
  const expectedRevision = Number.isInteger(operation.expectedRevision) ? operation.expectedRevision : undefined;
  try {
    const result = operation.type === "delete"
      ? await backend.deleteDraft(userId, undefined, expectedRevision)
      : await backend.saveDraft(userId, operation.invoice, undefined, expectedRevision);
    const nextRevision = operation.type === "delete" ? undefined : result?.revision;
    if (epoch !== sessionEpoch || currentUser?.id !== userId) return false;
    // A later local edit may already be waiting in the outbox. Publish our
    // successful write's revision before any more asynchronous outbox work so
    // subsequent stages cannot overwrite a rebased operation with a stale base.
    draftRevision = nextRevision;
    await draftOutbox.remove(userId, operation.operationId);
    const newerOperation = await draftOutbox.get(userId);
    if (epoch !== sessionEpoch || currentUser?.id !== userId) return false;
    if (newerOperation && newerOperation.operationId !== operation.operationId) {
      await draftOutbox.rebase(userId, newerOperation.operationId, nextRevision);
      scheduleDraftRetry(0);
      setDraftSyncStatus("waiting", "Saved on this device. Waiting to sync");
    } else {
      const time = new Intl.DateTimeFormat("en-SG", { hour: "numeric", minute: "2-digit" }).format(new Date());
      setDraftSyncStatus("synced", `Synced ${time}`);
      if (!state.historyId) {
        saveStatus.textContent = editorMode === "duplicate"
          ? (backend.provider === "firebase" ? "Duplicate draft synced. Not in history." : "Duplicate draft saved locally. Not in history.")
          : `Draft saved ${time}`;
      } else {
        saveStatus.textContent = `Saved ${time}`;
      }
    }
    return true;
  } catch (error) {
    if (epoch !== sessionEpoch || currentUser?.id !== userId) return false;
    if (error?.code === "DRAFT_REVISION_CONFLICT") {
      await handleDraftConflict(operation);
      return false;
    }
    const attempts = Number(operation.attempts || 0) + 1;
    const delay = retryDelay(attempts);
    await draftOutbox.markRetry(userId, operation.operationId, attempts, Date.now() + delay, error?.message);
    const memoryOnly = operation.storage === "memory";
    setDraftSyncStatus("error", memoryOnly ? "Draft not saved. Keep this tab open" : "Draft safe on this device. Sync retrying");
    saveStatus.textContent = memoryOnly ? "Draft not saved—keep this tab open" : "Saved on this device";
    if (memoryOnly) showToast("Browser storage is unavailable. Keep this tab open and download a recovery backup.");
    scheduleDraftRetry(delay);
    return false;
  }
}

function flushDraftOutbox(options = {}) {
  if (draftSyncPromise) return draftSyncPromise;
  const pendingSync = runDraftOutboxSync(Boolean(options.force))
    .finally(() => {
      if (draftSyncPromise === pendingSync) draftSyncPromise = undefined;
    });
  draftSyncPromise = pendingSync;
  return draftSyncPromise;
}

async function reconcileDraftOutbox(userId, remoteDraftRecord) {
  const operation = await draftOutbox.get(userId);
  if (!operation) return remoteDraftRecord;

  if (operation.type === "delete") {
    if (!remoteDraftRecord) {
      await draftOutbox.remove(userId, operation.operationId);
      setDraftSyncStatus("synced", "All changes synced");
      return null;
    }
    if (operation.expectedRevision === remoteDraftRecord.revision) {
      draftRevision = remoteDraftRecord.revision;
      setDraftSyncStatus("waiting", "Draft deletion waiting to sync");
      scheduleDraftRetry(0);
      return null;
    }
  } else {
    const localInvoice = normalizeInvoiceData(operation.invoice);
    const remoteInvoice = normalizeInvoiceData(remoteDraftRecord?.invoice);
    if (remoteDraftRecord && localInvoice && remoteInvoice && invoiceFingerprint(localInvoice) === invoiceFingerprint(remoteInvoice)) {
      await draftOutbox.remove(userId, operation.operationId);
      setDraftSyncStatus("synced", "All changes synced");
      return remoteDraftRecord;
    }
    const expectedRevision = Number.isInteger(operation.expectedRevision) ? operation.expectedRevision : undefined;
    if ((!remoteDraftRecord && expectedRevision === undefined)
      || (remoteDraftRecord && expectedRevision === remoteDraftRecord.revision)) {
      setDraftSyncStatus("waiting", "Draft restored from this device. Waiting to sync");
      scheduleDraftRetry(0);
      return { invoice: localInvoice, revision: remoteDraftRecord?.revision };
    }
  }

  const choice = await promptForDraftConflict(operation, remoteDraftRecord);
  if (choice === "signed-out") return remoteDraftRecord;
  if (choice === "cloud") {
    await draftOutbox.remove(userId, operation.operationId);
    setDraftSyncStatus("synced", "All changes synced");
    return remoteDraftRecord;
  }
  await draftOutbox.rebase(userId, operation.operationId, remoteDraftRecord?.revision);
  setDraftSyncStatus("waiting", "Saved on this device. Waiting to sync");
  scheduleDraftRetry(0);
  return operation.type === "save"
    ? { invoice: normalizeInvoiceData(operation.invoice), revision: remoteDraftRecord?.revision }
    : null;
}

function normalizeHistoryRecords(records) {
  const seen = new Set();
  return records
    .map((record, index) => {
      const invoice = normalizeInvoiceData(record.invoice);
      if (!invoice) return null;
      let id = String(record.id || "");
      if (!id) return null;
      if (seen.has(id)) id = `${id}-recovered-${index + 1}`;
      while (seen.has(id)) id = `${id}-copy`;
      seen.add(id);
      invoice.historyId = id;
      return { ...record, id, invoice };
    })
    .filter(Boolean);
}

function setHistoryLoading(isLoading) {
  historyLoading = isLoading;
  historySection.setAttribute("aria-busy", String(isLoading));
  historyLoadingState.hidden = !isLoading;
  loadMoreInvoicesButton.disabled = isLoading;
  document.querySelector("#paymentFilter").disabled = isLoading;
}

async function loadInvoiceHistory(options = {}) {
  if (!currentUser || (historyLoading && !options.reset)) return false;
  const reset = Boolean(options.reset);
  const requestVersion = reset ? ++historyRequestVersion : historyRequestVersion;
  const cursor = reset ? null : historyNextCursor;
  if (reset) {
    historyLoadError = false;
    historyErrorState.hidden = true;
    historyNextCursor = undefined;
    historyTotal = 0;
    invoiceHistory = [];
    renderInvoiceHistory();
  }
  setHistoryLoading(true);
  renderInvoiceHistory();
  try {
    const page = await backend.listInvoices(currentUser.id, {
      limit: HISTORY_PAGE_SIZE,
      cursor,
      query: historyQuery,
      status: document.querySelector("#paymentFilter").value,
      folderId: currentFolderId,
    });
    if (requestVersion !== historyRequestVersion) return false;
    invoiceFolders = page.folders || [];
    const records = normalizeHistoryRecords(page.records || []);
    const knownIds = new Set(invoiceHistory.map((record) => record.id));
    invoiceHistory = reset
      ? records
      : [...invoiceHistory, ...records.filter((record) => !knownIds.has(record.id))];
    historyNextCursor = page.nextCursor || undefined;
    historyTotal = Number.isFinite(Number(page.total)) ? Number(page.total) : invoiceHistory.length;
    historyLoadError = false;
    return true;
  } catch (error) {
    if (backend.guestMode && ["LOCAL_DATA_CORRUPT", "LOCAL_STORAGE_UNAVAILABLE"].includes(error?.code)) {
      showStorageRecovery(error);
    } else if (requestVersion === historyRequestVersion) {
      historyLoadError = true;
    }
    return false;
  } finally {
    if (requestVersion === historyRequestVersion) {
      setHistoryLoading(false);
      renderInvoiceHistory();
    }
  }
}

async function loadAuthenticatedWorkspace(session) {
  if (!session?.user || (workspaceLoading && currentUser?.id === session.user.id)) return;
  if (currentUser?.id === session.user.id && !invoiceListPage.hidden) return;
  if (currentUser?.id && currentUser.id !== session.user.id) clearSensitiveWorkspace();
  workspaceLoading = true;
  currentUser = session.user;
  const uid = session.user.id;
  const epoch = sessionEpoch;
  const stillCurrent = () => epoch === sessionEpoch && currentUser?.id === uid;
  hideWorkspace();
  workspaceErrorState.hidden = true;
  accountEmail.textContent = backend.guestMode ? "This device" : (session.user.email || "Signed in");
  signOutButton.hidden = Boolean(backend.guestMode);
  document.querySelector("#refreshInvoicesButton").hidden = Boolean(backend.guestMode);
  historyErrorState.querySelector("p").textContent = backend.guestMode
    ? "Invoices could not be loaded from this browser. Download a backup, then check browser storage and try again."
    : "Invoices could not be loaded. Check your connection and try again.";
  historyStorageNote.textContent = backend.guestMode
    ? "Invoices and drafts exist only in this browser profile. Clearing site data, using private browsing, or changing devices can remove access. Download a backup regularly."
    : "Saved privately to your account. Offline changes sync when you reconnect.";
  if (backend.guestMode) setDraftSyncStatus("synced", "Saved locally");
  accountControls.hidden = false;
  storageRecoveryPage.hidden = true;
  authPage.hidden = false;
  authSignInState.hidden = true;
  setAuthMessage("Loading your invoices...");

  try {
    if (backend.listProfiles) {
      const profiles = await backend.listProfiles();
      if (!stillCurrent()) return;
      activeBusinessProfile = profiles.find(profile => profile.id === backend.activeProfileId());
      if (!activeBusinessProfile) throw new Error("This business profile is unavailable.");
      const select = document.querySelector("#profileSelect");
      select.replaceChildren(...profiles.map(profile => new Option(profile.name, profile.id)));
      select.value = activeBusinessProfile.id;
      document.querySelector("#profileControls").hidden = false;
    }
    const migrationAction = await promptForLegacyMigration(session);
    if (!stillCurrent()) return;
    if (migrationAction === "cancelled") {
      await backend.signOut();
      return;
    }
    if (migrationAction === "signed-out") return;
    if (!stillCurrent()) return;
    const [historyPage, remoteDraftRecord] = await Promise.all([
      backend.listInvoices(uid, { limit: HISTORY_PAGE_SIZE, query: "" }),
      backend.loadDraft(uid),
    ]);
    if (!stillCurrent()) return;
    invoiceFolders = historyPage.folders || [];
    invoiceHistory = normalizeHistoryRecords(historyPage.records || []);
    historyNextCursor = historyPage.nextCursor || undefined;
    historyTotal = Number.isFinite(Number(historyPage.total)) ? Number(historyPage.total) : invoiceHistory.length;
    historyLoadError = false;
    const reconciledDraftRecord = await reconcileDraftOutbox(uid, remoteDraftRecord);
    if (!stillCurrent()) return;
    const nextState = normalizeInvoiceData(reconciledDraftRecord?.invoice) || await createLocalInvoiceDraft();
    if (!stillCurrent()) return;
    state = nextState;
    draftRevision = Number.isInteger(reconciledDraftRecord?.revision) ? reconciledDraftRecord.revision : undefined;
    draftChanged = Boolean(state.draftDirty);
    draftPersistenceEnabled = Boolean(reconciledDraftRecord);
    clearValidationErrors();
    fillForm();
    passwordRecoveryForm.hidden = true;
    authPage.hidden = true;
    showInvoiceList(false);
    flushDraftOutbox();
    if (migrationAction === "moved") showToast(backend.guestMode
      ? "Existing browser invoices are ready to use."
      : "Existing browser invoices were moved to your account.");
    if (migrationAction === "discarded") showToast("Local browser data was discarded without moving it.");
  } catch (error) {
    if (!stillCurrent()) return;
    if (backend.guestMode && ["LOCAL_DATA_CORRUPT", "LOCAL_STORAGE_UNAVAILABLE"].includes(error?.code)) {
      showStorageRecovery(error);
      return;
    }
    hideWorkspace();
    authPage.hidden = false;
    authSignInState.hidden = true;
    workspaceErrorState.hidden = false;
    accountControls.hidden = false;
    setAuthMessage(error?.code === "permission-denied"
      ? "Your account could not access its database. The app administrator needs to check the Firebase access rules."
      : (error?.message || "Your account data could not be loaded. Try again."), "error");
  } finally {
    if (stillCurrent()) workspaceLoading = false;
  }
}

async function handleSignIn(event) {
  event.preventDefault();
  if (authBusy || !authForm.reportValidity()) return;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authPassword.value = "";
  setAuthBusy(true);
  setAuthMessage("Signing in...");
  try {
    const { session } = await backend.signIn(email, password);
    if (session) await loadAuthenticatedWorkspace(session);
  } catch (error) {
    setAuthMessage(authFailureMessage(error, "sign-in"), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function handleGoogleSignIn() {
  if (authBusy) return;
  authPassword.value = "";
  setAuthBusy(true);
  setAuthMessage("Choose your Google account in the sign-in window...");
  try {
    const { session } = await backend.signInWithGoogle();
    if (session) await loadAuthenticatedWorkspace(session);
  } catch (error) {
    const cancelled = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error?.code);
    setAuthMessage(error?.code === "auth/google-loading" ? error.message : authFailureMessage(error, "google-sign-in"), cancelled ? "" : "error");
  } finally {
    setAuthBusy(false);
    if (!authPage.hidden && !authSignInState.hidden) googleSignInButton.focus({ preventScroll: true });
  }
}

async function handleCreateAccount() {
  if (authBusy || !authForm.reportValidity()) return;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authPassword.value = "";
  setAuthBusy(true);
  setAuthMessage("Creating your account...");
  try {
    const { session } = await backend.signUp(email, password);
    if (session) {
      await loadAuthenticatedWorkspace(session);
    } else {
      markAuthEmailRequested(email);
      setAuthMessage("Check your email to confirm the account, then return here to sign in.");
    }
  } catch (error) {
    if (error?.code === "over_email_send_rate_limit") {
      const retrySeconds = authEmailRetrySeconds(error);
      if (retrySeconds) markAuthEmailRequested(email, retrySeconds);
      else blockAuthEmailRequests();
    }
    setAuthMessage(authFailureMessage(error, "sign-up"), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function handlePasswordReset() {
  if (!authEmail.reportValidity()) return;
  setAuthBusy(true);
  setAuthMessage("Sending a password reset link...");
  const email = authEmail.value.trim();
  try {
    await backend.sendPasswordReset(email);
    markAuthEmailRequested(email);
    setAuthMessage("If that email has an account, a password reset link is on its way.");
  } catch (error) {
    if (error?.code === "over_email_send_rate_limit") {
      const retrySeconds = authEmailRetrySeconds(error);
      if (retrySeconds) markAuthEmailRequested(email, retrySeconds);
      else blockAuthEmailRequests();
    }
    setAuthMessage(authFailureMessage(error, "password-reset"), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function handlePasswordRecovery(event) {
  event.preventDefault();
  if (!passwordRecoveryForm.reportValidity()) return;
  if (recoveryPassword.value !== recoveryPasswordConfirm.value) {
    recoveryPasswordConfirm.setCustomValidity("Passwords must match.");
    recoveryPasswordConfirm.reportValidity();
    return;
  }
  recoveryPasswordConfirm.setCustomValidity("");
  const password = recoveryPassword.value;
  recoveryPassword.value = "";
  recoveryPasswordConfirm.value = "";
  setAuthBusy(true);
  setAuthMessage("Updating your password...");
  try {
    await backend.updatePassword(password);
    const session = await backend.getSession();
    if (session) await loadAuthenticatedWorkspace(session);
    else showSignedOutPage();
    const cleanUrl = new URL(window.location.href);
    for (const key of ["mode", "oobCode", "apiKey", "lang", "continueUrl"]) cleanUrl.searchParams.delete(key);
    window.history.replaceState({}, "", cleanUrl);
    setAuthMessage("Password updated. Sign in with your new password.");
  } catch (error) {
    setAuthMessage(authFailureMessage(error, "password-reset"), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function handleSignOut() {
  signOutButton.disabled = true;
  try {
    await persistDraftImmediately();
    await outboxWriteQueue.catch(() => {});
    if (currentUser && await draftOutbox.has(currentUser.id)) {
      setDraftSyncStatus("error", "Sync this draft before signing out");
      showToast("This draft has not synced. You can keep it on this device and sign in again later to sync.");
      if (!window.confirm("This draft has not synced yet. Sign out and keep it on this device? It will retry when you sign in to this account again.")) return;
    }
    await backend.signOut();
    showSignedOutPage();
  } catch (error) {
    showToast(error?.message || "Sign-out failed. Try again.");
  } finally {
    signOutButton.disabled = false;
  }
}

async function initializeApplication() {
  if (!backend?.configured) {
    showConfigurationPage();
    appLoadingScreen.hidden = true;
    return;
  }

  const initialAuthVersion = authStateVersion;
  backend.onAuthStateChange((event, session) => {
    if (new URL(window.location.href).searchParams.get("mode") === "resetPassword") return;
    if (event === "PASSWORD_RECOVERY") {
      authStateVersion += 1;
      currentUser = session?.user;
      showPasswordRecoveryPage();
      return;
    }
    if (event === "SIGNED_OUT") {
      authStateVersion += 1;
      showSignedOutPage();
      return;
    }
    if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
      authStateVersion += 1;
      loadAuthenticatedWorkspace(session);
    }
  });

  try {
    if (backend.preparePasswordRecovery && new URL(window.location.href).searchParams.get("mode") === "resetPassword") {
      await backend.preparePasswordRecovery(window.location.href);
      showPasswordRecoveryPage();
      return;
    }
    const session = await backend.getSession();
    if (initialAuthVersion !== authStateVersion) return;
    if (session) await loadAuthenticatedWorkspace(session);
    else showSignedOutPage();
  } catch (error) {
    if (initialAuthVersion !== authStateVersion) return;
    if (backend.guestMode && ["LOCAL_DATA_CORRUPT", "LOCAL_STORAGE_UNAVAILABLE"].includes(error?.code)) {
      showStorageRecovery(error);
    } else {
      showSignedOutPage();
      setAuthMessage(error?.message || "Authentication is unavailable. Try again.", "error");
    }
  } finally {
    appLoadingScreen.classList.add("is-ready");
    window.setTimeout(() => { appLoadingScreen.hidden = true; }, 220);
  }
}

async function reconcileResumedAuthSession() {
  const canRestore = () => backend?.configured && !backend.guestMode
    && !authPage.hidden && !authSignInState.hidden && passwordRecoveryForm.hidden
    && !workspaceLoading && !authBusy
    && new URL(window.location.href).searchParams.get("mode") !== "resetPassword";
  if (!canRestore()) return;
  const epoch = sessionEpoch;
  const version = authStateVersion;
  try {
    const session = await backend.getSession();
    // Safari can restore the sign-in page from its page cache after the popup
    // authenticates. Only a positive current result can restore the workspace;
    // a late empty/error result must never discard an editor or newer session.
    if (!session?.user || epoch !== sessionEpoch || version !== authStateVersion || !canRestore()) return;
    authStateVersion += 1;
    await loadAuthenticatedWorkspace(session);
  } catch {
    // Foreground checks are opportunistic. Explicit sign-in retains its error UI.
  }
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)));
}

function createInvoiceDraft(invoiceNumberOverride) {
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 2);
  const compactDate = isoDate(today).replace(/-/g, "");
  const invoiceNumber = invoiceNumberOverride || `EHR-${compactDate}-001`;
  return {
    draftDirty: false,
    invoiceNumber,
    pdfFileName: invoiceNumber,
    pdfFileNameCustomized: false,
    invoiceDate: isoDate(today),
    dueDate: isoDate(due),
    billTo: "",
    igHandle: "",
    terms: activeBusinessProfile?.terms ?? DEFAULT_INVOICE_TERMS,
    logo: activeBusinessProfile?.logo || (activeBusinessProfile && activeBusinessProfile.id !== "default" ? EMPTY_PROFILE_LOGO : ""),
    items: [{ id: `item-${Date.now()}`, quantity: 1, description: "", price: "" }],
  };
}

async function createLocalInvoiceDraft(options = {}) {
  if (!currentUser) throw new Error("Open the local workspace before creating an invoice.");
  const today = isoDate(new Date());
  const allocator = options.reserve && typeof backend.reserveInvoiceNumber === "function"
    ? backend.reserveInvoiceNumber
    : backend.nextInvoiceNumber;
  const invoiceNumber = await allocator(today);
  return createInvoiceDraft(invoiceNumber);
}

function saveDraft(markChanged = true) {
  clearTimeout(saveTimer);
  draftPersistenceEnabled = true;
  if (markChanged) {
    clearOutputPdfContext();
    draftChanged = true;
    state.draftDirty = true;
  }
  if (!currentUser) return;
  saveStatus.textContent = "Saving on this device...";
  stageDraftSave().catch(() => {
    saveStatus.textContent = "Could not save draft on this device";
  });
  saveTimer = window.setTimeout(() => flushDraftOutbox(), 350);
}

async function persistDraftImmediately() {
  if (!draftPersistenceEnabled || !currentUser) return true;
  clearTimeout(saveTimer);
  try {
    await stageDraftSave();
    // An earlier sync may have inspected an empty outbox before this edit was
    // staged. Wait for it, then flush the newly staged operation as well.
    if (draftSyncPromise && !await draftSyncPromise) return false;
  } catch {
    return false;
  }
  return flushDraftOutbox({ force: true });
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatAmount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "-";
}

function safePdfFileName(value, fallback) {
  const withoutExtension = String(value || "").trim().replace(/\.pdf$/i, "");
  const cleaned = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  const fallbackName = String(fallback || "invoice")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  const fileName = cleaned || fallbackName || "invoice";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(fileName) ? `${fileName}-invoice` : fileName;
}

function invoiceTotal() {
  return invoiceTotalFor(state);
}

function invoiceTotalFor(invoice) {
  return invoice.items.reduce((total, item) => {
    if (!Number.isFinite(total)) return total;
    if (item.quantity === "" || item.price === "") return total;
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    const valid = Number.isInteger(quantity)
      && quantity >= 1
      && quantity <= MAX_QUANTITY
      && Number.isFinite(price)
      && price >= MIN_PRICE
      && price <= MAX_PRICE;
    return valid ? total + quantity * price : Number.NaN;
  }, 0);
}

function formatHistoryAmount(value) {
  const numeric = Number(value);
  return new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" })
    .format(Number.isFinite(numeric) ? numeric : 0);
}

function cloneInvoice(invoice) {
  return {
    historyId: invoice.historyId,
    historyRevision: invoice.historyRevision,
    draftDirty: Boolean(invoice.draftDirty),
    invoiceNumber: invoice.invoiceNumber,
    pdfFileName: invoice.pdfFileName,
    pdfFileNameCustomized: invoice.pdfFileNameCustomized,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    billTo: invoice.billTo,
    igHandle: invoice.igHandle || "",
    terms: invoice.terms ?? DEFAULT_INVOICE_TERMS,
    logo: invoice.logo || "",
    items: invoice.items.map((item) => ({ ...item })),
  };
}

function invoiceFingerprint(invoice) {
  return JSON.stringify({
    invoiceNumber: invoice.invoiceNumber,
    pdfFileName: invoice.pdfFileName,
    pdfFileNameCustomized: Boolean(invoice.pdfFileNameCustomized),
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    billTo: invoice.billTo,
    igHandle: invoice.igHandle || "",
    terms: invoice.terms ?? DEFAULT_INVOICE_TERMS,
    logo: invoice.logo || "",
    items: invoice.items.map(({ quantity, description, price }) => ({ quantity, description, price })),
  });
}

function hasUnsavedDraft() {
  if (state.historyId) {
    const savedRecord = invoiceHistory.find((record) => record.id === state.historyId);
    return !savedRecord || invoiceFingerprint(savedRecord.invoice) !== invoiceFingerprint(state);
  }
  return Boolean(state.draftDirty || hasEnteredContent());
}

function historyRecordId() {
  if (typeof crypto.randomUUID === "function") return `invoice-${crypto.randomUUID()}`;
  return `invoice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function deleteStoredDraft() {
  clearTimeout(saveTimer);
  if (!currentUser) return true;
  const userId = currentUser.id;
  await stageDraftDelete();
  // An earlier save can still own the sync promise. Let it rebase the queued
  // deletion, then flush that deletion before resetting the editor.
  if (draftSyncPromise) await draftSyncPromise;
  await flushDraftOutbox({ force: true });
  if (await draftOutbox.has(userId)) throw new Error("Draft deletion is waiting to sync.");
  draftRevision = undefined;
  return true;
}

async function saveCurrentInvoiceToHistory() {
  if (!currentUser) {
    showToast("Open your workspace before saving an invoice.");
    return false;
  }
  const now = new Date().toISOString();
  const uid = currentUser.id;
  const epoch = sessionEpoch;
  const id = state.historyId || historyRecordId();
  const existingRecord = invoiceHistory.find((record) => record.id === id);
  const savedInvoice = cloneInvoice({ ...state, historyId: id, draftDirty: false });
  const savedRecord = {
    id,
    revision: state.historyRevision ?? existingRecord?.revision,
    createdAt: existingRecord?.createdAt || now,
    updatedAt: now,
    invoice: savedInvoice,
    folderId: state.historyId ? undefined : (currentFolderId || ""),
  };
  let remoteRecord;
  try {
    const draftSynced = await persistDraftImmediately();
    if (epoch !== sessionEpoch || currentUser?.id !== uid) return false;
    if (!draftSynced) {
      showToast("The draft has not synced yet. Resolve any draft conflict or reconnect, then save the invoice again.");
      return false;
    }
    remoteRecord = await backend.saveInvoice(uid, savedRecord);
    if (epoch !== sessionEpoch || currentUser?.id !== uid) return false;
  } catch (error) {
    if (epoch !== sessionEpoch || currentUser?.id !== uid) return false;
    if (error?.code === "INVOICE_REVISION_CONFLICT") {
      saveStatus.textContent = "Invoice changed elsewhere";
      showToast("This invoice changed in another session. Your edits were not overwritten; reload the invoice before saving again.");
    } else if (["LOCAL_DATA_CORRUPT", "LOCAL_STORAGE_UNAVAILABLE"].includes(error?.code)) {
      saveStatus.textContent = "Browser storage needs attention";
      showStorageRecovery(error);
    } else {
      saveStatus.textContent = "Could not save invoice";
      showToast(backend.guestMode ? "The invoice could not be saved. Check browser storage and try again." : (error?.message || "The invoice could not be saved. Check your connection and try again."));
    }
    return false;
  }

  try {
    await deleteStoredDraft();
  } catch {
    // The invoice is already safely stored. The durable outbox will retry the
    // draft deletion, and sign-out remains blocked until it succeeds.
  }
  if (epoch !== sessionEpoch || currentUser?.id !== uid) return false;
  remoteRecord.payment = existingRecord?.payment;
  remoteRecord.folderId = existingRecord?.folderId || savedRecord.folderId || "";
  invoiceHistory = [remoteRecord, ...invoiceHistory.filter((record) => record.id !== id)];
  if (!existingRecord) historyTotal += 1;
  historyQuery = "";
  invoiceSearch.value = "";

  state.historyId = id;
  state.historyRevision = remoteRecord.revision;
  state.draftDirty = false;
  draftChanged = false;
  draftPersistenceEnabled = false;
  saveStatus.textContent = existingRecord ? "Invoice changes saved" : "Invoice saved to history";
  renderInvoiceHistory();
  return true;
}

function createHistoryMeta(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  return wrapper;
}

function renderInvoiceHistory() {
  renderFolders();
  document.querySelector("#paymentFilterLabel").hidden = !backend.savePayment;
  const query = historyQuery.trim() || (currentFolderId !== null ? "folder" : "") || (document.querySelector("#paymentFilter").value !== "all" ? "payment filter" : "");
  const visibleRecords = invoiceHistory;

  invoiceHistoryList.replaceChildren();
  visibleRecords.forEach((record) => {
    const invoice = record.invoice;
    const article = document.createElement("article");
    article.className = "invoice-record";
    article.dataset.invoiceId = record.id;

    const identity = document.createElement("div");
    const number = document.createElement("h3");
    const customer = document.createElement("p");
    number.className = "invoice-number";
    number.id = `invoice-title-${record.id}`;
    number.textContent = invoice.invoiceNumber || "Untitled invoice";
    article.setAttribute("aria-labelledby", number.id);
    customer.className = "invoice-customer";
    customer.textContent = formattedBillTo(invoice) || "No customer name";
    identity.append(number, customer);

    const meta = document.createElement("dl");
    meta.className = "invoice-record-meta";
    meta.append(
      createHistoryMeta("Invoice date", formatDate(invoice.invoiceDate) || "-"),
      createHistoryMeta("Items", String(invoice.items.length)),
      createHistoryMeta("Total", formatHistoryAmount(invoiceTotalFor(invoice))),
    );

    const actions = document.createElement("div");
    actions.className = "invoice-record-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-secondary";
    edit.dataset.editInvoice = record.id;
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit invoice ${invoice.invoiceNumber}`);
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.className = "button button-secondary";
    duplicate.dataset.duplicateInvoice = record.id;
    duplicate.textContent = "Duplicate";
    duplicate.setAttribute("aria-label", `Duplicate invoice ${invoice.invoiceNumber}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.dataset.deleteInvoice = record.id;
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete invoice ${invoice.invoiceNumber}`);
    actions.append(edit);
    if (backend.pdfStorageAvailable && typeof backend.loadInvoicePdf === "function") {
      const download = document.createElement("button");
      download.type = "button";
      download.className = "button button-secondary";
      download.dataset.downloadInvoicePdf = record.id;
      download.textContent = "Download PDF";
      download.setAttribute("aria-label", `Download saved PDF for invoice ${invoice.invoiceNumber}`);
      actions.append(download);
    }
    if (backend.savePayment) {
      const paymentButton = document.createElement("button");
      paymentButton.type = "button";
      paymentButton.className = "button button-secondary";
      paymentButton.textContent = "Payment & remarks";
      paymentButton.addEventListener("click", () => openPayment(record));
      actions.append(paymentButton);
      const status = record.payment?.status || "unpaid";
      const badge = document.createElement("span");
      badge.className = `payment-badge payment-badge-${status}`;
      badge.textContent = status[0].toUpperCase() + status.slice(1);
      actions.prepend(badge);
    }
    const more = document.createElement("details");
    more.className = "invoice-more";
    const summary = document.createElement("summary");
    summary.textContent = "•••";
    summary.setAttribute("aria-label", `More actions for invoice ${invoice.invoiceNumber}`);
    const menu = document.createElement("div");
    menu.className = "invoice-more-menu";
    Array.from(actions.querySelectorAll("button")).filter(button => button !== edit).forEach(button => menu.append(button));
    if (backend.moveInvoice) {
      const move = document.createElement("button");
      move.type = "button";
      move.className = "button button-secondary";
      move.textContent = "Move to folder";
      move.addEventListener("click", () => openFolderDialog(record));
      menu.append(move);
    }
    if (backend.uploadAttachment && backend.pdfStorageAvailable) {
      const files = document.createElement("button");
      files.type = "button";
      files.className = "button button-secondary";
      files.textContent = "Files & uploads";
      files.addEventListener("click", () => openAttachments(record));
      menu.append(files);
    }
    menu.append(duplicate, remove);
    menu.addEventListener("click", () => { more.open = false; });
    more.addEventListener("toggle", () => {
      if (more.open) document.querySelectorAll(".invoice-more[open]").forEach(other => { if (other !== more) other.open = false; });
    });
    more.append(summary, menu);
    actions.append(more);

    article.append(identity, meta, actions);
    invoiceHistoryList.append(article);
  });

  const total = historyTotal;
  invoiceCount.textContent = historyLoading && visibleRecords.length === 0
    ? "Loading..."
    : query
      ? `${visibleRecords.length} of ${total} ${total === 1 ? "invoice" : "invoices"}`
      : `${total} ${total === 1 ? "invoice" : "invoices"}`;
  invoiceSearchField.hidden = total < 2 && !query;
  historyNewInvoiceButton.hidden = total === 0 && !query;
  historyLoadingState.hidden = !historyLoading;
  historyErrorState.hidden = !historyLoadError;
  historyEmptyState.hidden = historyLoading || historyLoadError || Boolean(query) || total !== 0;
  historyNoResults.hidden = historyLoading || historyLoadError || !query || total !== 0;
  loadMoreInvoicesButton.hidden = historyLoading || historyLoadError || !historyNextCursor;

  const showDraft = hasUnsavedDraft();
  draftNotice.hidden = !showDraft;
  if (showDraft) {
    const customer = state.billTo.trim() || "Untitled invoice";
    draftNoticeSummary.textContent = `${state.invoiceNumber} for ${customer}, ${formatHistoryAmount(invoiceTotal())}`;
  }
}

function clearValidationErrors() {
  form.querySelectorAll('[aria-invalid="true"]').forEach(clearFieldError);
}

async function downloadSavedInvoicePdf(id, button) {
  if (!currentUser || button.disabled) return;
  const record = invoiceHistory.find((entry) => entry.id === id);
  if (!record) return;
  const uid = currentUser.id;
  const epoch = sessionEpoch;
  const stillCurrent = () => currentUser?.id === uid && sessionEpoch === epoch;
  const fileName = `${safePdfFileName(record.invoice.pdfFileName, record.invoice.invoiceNumber)}.pdf`;
  button.disabled = true;
  button.textContent = "Downloading...";
  try {
    const blob = await backend.loadInvoicePdf(uid, { id: record.id, revision: record.revision });
    if (!stillCurrent()) return;
    downloadPdfBlob(blob, fileName);
    showToast(`${fileName} downloaded from your account.`);
  } catch (error) {
    if (!stillCurrent()) return;
    const message = error?.code === "storage/object-not-found"
      ? "No PDF has been saved for this invoice yet. Open it and choose Save invoice to create one."
      : ["INVOICE_REVISION_CONFLICT", "INVOICE_NOT_FOUND"].includes(error?.code)
        ? "This invoice changed on another device. Refresh your invoices before downloading its PDF."
        : error?.code === "PDF_CONTENT_CONFLICT"
          ? "Save this invoice again to create a new PDF version before downloading it."
          : "The saved PDF could not be downloaded. Check your connection and try again.";
    showToast(message);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = "Download PDF";
    }
  }
}

function showEditorPage(mode = "new", focusEditor = true) {
  document.querySelector("#settingsPage").hidden = true;
  document.querySelector("#editProfileButton").hidden = !backend.listProfiles;
  document.querySelector("#editProfileButton").removeAttribute("aria-current");
  editingBusinessProfile = null;
  document.querySelector("#profileControls").hidden = !backend.listProfiles;
  editorMode = mode;
  currentPage = "editor";
  document.body.dataset.page = "editor";
  storageRecoveryPage.hidden = true;
  invoiceListPage.hidden = true;
  editorPage.hidden = false;
  renderFolders();
  invoiceListButton.hidden = false;
  newInvoiceButton.hidden = false;
  printButton.hidden = false;
  invoiceListButton.removeAttribute("aria-current");
  if (mode === "new" || mode === "duplicate") newInvoiceButton.setAttribute("aria-current", "page");
  else newInvoiceButton.removeAttribute("aria-current");
  editorTitle.textContent = mode === "edit" ? "Edit invoice" : mode === "duplicate" ? "Review duplicated invoice" : "Create an invoice";
  document.title = state.invoiceNumber ? `${state.invoiceNumber} | Quotini` : "Quotini";
  window.scrollTo({ top: 0 });
  requestAnimationFrame(() => {
    updatePreviewScale();
    if (focusEditor) document.querySelector(mode === "edit" ? "#invoiceNumber" : "#billTo")?.focus();
  });
}

function showInvoiceList(focusHeading = true) {
  document.querySelector("#settingsPage").hidden = true;
  document.querySelector("#editProfileButton").hidden = !backend.listProfiles;
  document.querySelector("#editProfileButton").removeAttribute("aria-current");
  editingBusinessProfile = null;
  document.querySelector("#profileControls").hidden = !backend.listProfiles;
  persistDraftImmediately();
  currentPage = "history";
  document.body.dataset.page = "history";
  storageRecoveryPage.hidden = true;
  editorPage.hidden = true;
  invoiceListPage.hidden = false;
  invoiceListButton.hidden = false;
  newInvoiceButton.hidden = false;
  printButton.hidden = true;
  invoiceListButton.setAttribute("aria-current", "page");
  newInvoiceButton.removeAttribute("aria-current");
  document.title = "Invoices | Quotini";
  renderInvoiceHistory();
  window.scrollTo({ top: 0 });
  if (focusHeading) document.querySelector("#invoiceListTitle")?.focus({ preventScroll: true });
}

function canReplaceCurrentDraft(message) {
  return !hasUnsavedDraft() || window.confirm(message);
}

function editSavedInvoice(id) {
  const record = invoiceHistory.find((candidate) => candidate.id === id);
  if (!record || !canReplaceCurrentDraft("Open this invoice and replace your unsaved draft?")) return;
  clearTimeout(saveTimer);
  clearValidationErrors();
  state = cloneInvoice(record.invoice);
  state.historyId = record.id;
  state.historyRevision = record.revision;
  draftChanged = false;
  draftPersistenceEnabled = true;
  fillForm();
  persistDraftImmediately();
  saveStatus.textContent = "Saved invoice loaded";
  showEditorPage("edit");
}

async function duplicateSavedInvoice(id) {
  const record = invoiceHistory.find((candidate) => candidate.id === id);
  if (!record || !canReplaceCurrentDraft("Duplicate this invoice and replace your unsaved draft?")) return;
  clearTimeout(saveTimer);
  clearValidationErrors();
  state = {
    ...cloneInvoice(record.invoice),
    historyId: undefined,
    historyRevision: undefined,
    draftDirty: true,
    items: record.invoice.items.map((item, index) => ({
      ...item,
      id: `item-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    })),
  };
  draftChanged = true;
  draftPersistenceEnabled = true;
  editorMode = "duplicate";
  fillForm();
  persistDraftImmediately();
  saveStatus.textContent = "Duplicate ready. Not yet saved.";
  showEditorPage("duplicate");
}

async function deleteSavedInvoice(id) {
  const record = invoiceHistory.find((candidate) => candidate.id === id);
  if (!record || typeof backend.deleteInvoice !== "function") return;
  const label = record.invoice.invoiceNumber || "this invoice";
  const deletesCurrentInvoice = state.historyId === record.id;
  const draftWarning = deletesCurrentInvoice ? " and any linked draft changes" : "";
  if (!window.confirm(`Permanently delete invoice ${label}${draftWarning} from ${backend.guestMode ? "this browser" : "your account on all devices"}?`)) return;
  try {
    if (deletesCurrentInvoice) await deleteStoredDraft();
    const removed = await backend.deleteInvoice(currentUser.id, record.id, record.revision);
    if (!removed) {
      showToast("That invoice was already removed.");
      await loadInvoiceHistory({ reset: true });
      return;
    }
    invoiceHistory = invoiceHistory.filter((candidate) => candidate.id !== record.id);
    historyTotal = Math.max(0, historyTotal - 1);
    if (deletesCurrentInvoice) {
      state = await createLocalInvoiceDraft();
      draftRevision = undefined;
      draftChanged = false;
      draftPersistenceEnabled = false;
      editorMode = "new";
      fillForm();
    }
    renderInvoiceHistory();
    showToast(`Invoice ${label} deleted.`);
  } catch (error) {
    if (error?.code === "INVOICE_REVISION_CONFLICT") {
      showToast("This invoice changed in another tab. Reload the list before deleting it.");
    } else if (["LOCAL_DATA_CORRUPT", "LOCAL_STORAGE_UNAVAILABLE"].includes(error?.code)) {
      showStorageRecovery(error);
    } else {
      showToast(error?.message || "The invoice could not be deleted.");
    }
  }
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function fillForm() {
  clearOutputPdfContext();
  for (const input of form.querySelectorAll("[data-field]")) {
    input.value = state[input.dataset.field] ?? "";
  }
  updatePdfFileNameControl();
  renderItemsEditor();
  renderPreview();
}

function updatePdfFileNameControl() {
  const isCustom = Boolean(state.pdfFileNameCustomized);
  customizePdfFileName.checked = isCustom;
  pdfFileNameInput.readOnly = !isCustom;
  pdfFileNameInput.setAttribute("aria-readonly", String(!isCustom));
  pdfFileNameHelp.textContent = isCustom
    ? "Custom file name used when you choose Save as PDF. The .pdf extension is added automatically."
    : "Matches the invoice number. Tick the checkbox to enter a custom PDF file name.";
}

function createField(className, label, input, id) {
  const wrapper = document.createElement("div");
  wrapper.className = className;
  const visibleLabel = document.createElement("label");
  input.id = id;
  visibleLabel.className = "mobile-field-label";
  visibleLabel.htmlFor = input.id;
  visibleLabel.textContent = label;
  wrapper.append(visibleLabel, input);
  return wrapper;
}

function stripBoldMarkers(value) {
  return String(value || "").replace(/\*\*/g, "");
}

function updateDescriptionValidity(input) {
  input.setCustomValidity(stripBoldMarkers(input.value).trim() ? "" : "Enter an item description.");
}

function updateRequiredTextValidity(input) {
  input.setCustomValidity(input.value.trim() ? "" : "Enter a value that is not only spaces.");
}

function toggleBoldFormatting(input) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;
  const selected = value.slice(start, end);
  let nextValue;
  let nextStart;
  let nextEnd;

  if (start === end) {
    nextValue = `${value.slice(0, start)}****${value.slice(end)}`;
    nextStart = start + 2;
    nextEnd = nextStart;
  } else if (value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**") {
    nextValue = `${value.slice(0, start - 2)}${selected}${value.slice(end + 2)}`;
    nextStart = start - 2;
    nextEnd = end - 2;
  } else if (selected.startsWith("**") && selected.endsWith("**") && selected.length > 4) {
    const unwrapped = selected.slice(2, -2);
    nextValue = `${value.slice(0, start)}${unwrapped}${value.slice(end)}`;
    nextStart = start;
    nextEnd = start + unwrapped.length;
  } else {
    nextValue = `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
    nextStart = start + 2;
    nextEnd = end + 2;
  }

  if (nextValue.length > MAX_ITEM_DESCRIPTION_LENGTH) {
    showToast(`Bold formatting would exceed the ${MAX_ITEM_DESCRIPTION_LENGTH}-character item limit.`);
    return;
  }

  input.value = nextValue;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.setSelectionRange(nextStart, nextEnd);
}

function renderFormattedDescription(container, value) {
  container.replaceChildren();
  let cursor = 0;

  while (cursor < value.length) {
    const opening = value.indexOf("**", cursor);
    if (opening === -1) {
      container.append(document.createTextNode(value.slice(cursor)));
      break;
    }
    const closing = value.indexOf("**", opening + 2);
    if (closing === -1) {
      container.append(document.createTextNode(value.slice(cursor)));
      break;
    }
    if (opening > cursor) container.append(document.createTextNode(value.slice(cursor, opening)));
    const strong = document.createElement("strong");
    strong.textContent = value.slice(opening + 2, closing);
    container.append(strong);
    cursor = closing + 2;
  }
}

function renderItemsEditor() {
  itemsEditor.replaceChildren();

  state.items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.dataset.itemId = item.id;

    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.min = "1";
    quantity.max = String(MAX_QUANTITY);
    quantity.step = "1";
    quantity.inputMode = "numeric";
    quantity.value = item.quantity;
    quantity.required = true;
    quantity.dataset.itemField = "quantity";
    quantity.setAttribute("aria-label", `Quantity for item ${index + 1}`);
    quantity.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? 1 : -1;
        const current = quantity.value === "" ? 0 : normalizeQuantity(quantity.value);
        quantity.value = Math.max(1, current + direction);
        quantity.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if ([".", ",", "e", "E", "+", "-"].includes(event.key)) event.preventDefault();
    });

    const description = document.createElement("textarea");
    description.rows = 2;
    description.maxLength = MAX_ITEM_DESCRIPTION_LENGTH;
    description.value = item.description;
    description.required = true;
    description.dataset.itemField = "description";
    description.setAttribute("aria-label", `Description for item ${index + 1}`);
    description.setAttribute("aria-describedby", "itemFormattingHelp");
    description.setAttribute("aria-keyshortcuts", "Control+B Meta+B");
    updateDescriptionValidity(description);
    description.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "b" && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        toggleBoldFormatting(description);
      }
    });

    const price = document.createElement("input");
    price.type = "number";
    price.min = String(MIN_PRICE);
    price.max = String(MAX_PRICE);
    price.step = "0.01";
    price.inputMode = "decimal";
    price.value = item.price;
    price.required = true;
    price.dataset.itemField = "price";
    price.setAttribute("aria-label", `Unit price for item ${index + 1}`);
    price.setAttribute("aria-describedby", "itemPriceHelp");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.dataset.removeItem = item.id;
    remove.disabled = state.items.length === 1;
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove item ${index + 1}`);
    remove.title = remove.disabled ? "At least one item is required" : `Remove item ${index + 1}`;

    const descriptionField = createField("mobile-field description-field", `Item ${index + 1}`, description, `description-${item.id}`);
    const bold = document.createElement("button");
    bold.type = "button";
    bold.className = "item-format-button";
    bold.textContent = "Bold";
    bold.setAttribute("aria-label", `Bold selected text in item ${index + 1}`);
    bold.addEventListener("click", () => {
      toggleBoldFormatting(description);
      description.focus();
    });
    descriptionField.append(bold);

    row.append(
      createField("mobile-field", "Quantity", quantity, `quantity-${item.id}`),
      descriptionField,
      createField("mobile-field", "Unit price (SGD)", price, `price-${item.id}`),
      remove,
    );
    itemsEditor.append(row);
  });

  const addItemButton = document.querySelector("#addItemButton");
  const isAtItemLimit = state.items.length >= 5;
  addItemButton.disabled = isAtItemLimit;
  addItemButton.title = isAtItemLimit ? "Maximum of 5 items reached" : "";
}

function formattedBillTo(invoice) {
  const name = (invoice.billTo || "").trim();
  const handle = (invoice.igHandle || "").trim().replace(/^@/, "");
  return handle ? `${name} (@${handle})` : name;
}

function renderPreview() {
  setText("#previewInvoiceNumber", state.invoiceNumber || "");
  setText("#previewInvoiceDate", formatDate(state.invoiceDate));
  setText("#previewDueDate", formatDate(state.dueDate));
  setText("#previewBillTo", formattedBillTo(state));
  setText("#previewTerms", state.terms ?? DEFAULT_INVOICE_TERMS);
  const logo = document.querySelector(".invoice-logo");
  const source = state.logo || "./eng-hoon-residences-logo.png?v=79";
  if (logo.getAttribute("src") !== source) logo.src = source;
  logo.alt = state.logo ? "Invoice logo" : "Eng Hoon Residences";

  previewItems.replaceChildren();
  state.items.forEach((item, index) => {
    const row = document.createElement("tr");
    const number = document.createElement("td");
    const description = document.createElement("td");
    const symbol = document.createElement("td");
    const amount = document.createElement("td");
    number.textContent = String(index + 1);
    renderFormattedDescription(description, item.description || "");
    symbol.textContent = "$";
    symbol.className = "amount-symbol";
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    const validAmount = item.quantity !== ""
      && item.price !== ""
      && Number.isInteger(quantity)
      && quantity >= 1
      && quantity <= MAX_QUANTITY
      && Number.isFinite(price)
      && price >= MIN_PRICE
      && price <= MAX_PRICE;
    amount.textContent = validAmount ? formatAmount(quantity * price) : "-";
    amount.className = "amount-value";
    row.append(number, description, symbol, amount);
    previewItems.append(row);
  });

  const total = invoiceTotal();
  const displayedTotal = Number.isFinite(total) ? total : 0;
  setText("#previewTotal", formatAmount(displayedTotal));
  setText("#editorTotal", `$${formatAmount(displayedTotal)}`);
}

function handleFieldInput(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  if (field === "invoiceNumber" || field === "billTo") {
    const selectionStart = event.target.selectionStart;
    const selectionEnd = event.target.selectionEnd;
    event.target.value = event.target.value.toLocaleUpperCase("en-SG");
    if (selectionStart !== null && selectionEnd !== null) {
      event.target.setSelectionRange(selectionStart, selectionEnd);
    }
    updateRequiredTextValidity(event.target);
  }
  state[field] = event.target.value;
  if (field === "pdfFileName") {
    state.pdfFileNameCustomized = true;
  }
  if (field === "invoiceNumber" && !state.pdfFileNameCustomized) {
    state.pdfFileName = event.target.value;
    document.querySelector("#pdfFileName").value = event.target.value;
  }
  renderPreview();
  saveDraft();
}

function togglePdfFileNameEditing() {
  state.pdfFileNameCustomized = customizePdfFileName.checked;
  if (!state.pdfFileNameCustomized) {
    state.pdfFileName = state.invoiceNumber;
    pdfFileNameInput.value = state.invoiceNumber;
  }
  updatePdfFileNameControl();
  saveDraft();
}

function handleItemInput(event) {
  const field = event.target.dataset.itemField;
  if (!field) return;
  const row = event.target.closest(".item-row");
  const item = state.items.find((candidate) => candidate.id === row?.dataset.itemId);
  if (!item) return;
  if (field === "quantity") {
    item.quantity = event.target.value === "" ? "" : Number(event.target.value);
  } else if (field === "price") {
    item.price = event.target.value === "" ? "" : Number(event.target.value);
  } else {
    item.description = event.target.value;
    updateDescriptionValidity(event.target);
  }
  renderPreview();
  saveDraft();
}

function addItem() {
  if (state.items.length >= 5) {
    showToast("The exact one-page template supports up to 5 items.");
    return;
  }
  const item = {
    id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    quantity: 1,
    description: "",
    price: "",
  };
  state.items.push(item);
  renderItemsEditor();
  renderPreview();
  saveDraft();
  const input = itemsEditor.querySelector(`[data-item-id="${item.id}"] textarea`);
  input?.focus();
}

function removeItem(id) {
  if (state.items.length === 1) return;
  const removedIndex = state.items.findIndex((item) => item.id === id);
  state.items = state.items.filter((item) => item.id !== id);
  renderItemsEditor();
  renderPreview();
  saveDraft();
  const focusIndex = Math.min(removedIndex, state.items.length - 1);
  itemsEditor.querySelectorAll('[data-item-field="description"]')[focusIndex]?.focus();
  showToast(`Item ${removedIndex + 1} removed. ${state.items.length} ${state.items.length === 1 ? "item" : "items"} remaining.`);
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function newInvoice() {
  const canUseCurrentBlankDraft = currentPage === "history"
    && !state.historyId
    && !hasUnsavedDraft()
    && state.invoiceDate === isoDate(new Date());
  if (canUseCurrentBlankDraft) {
    try {
      state = await createLocalInvoiceDraft({ reserve: true });
      fillForm();
      saveStatus.textContent = "Draft ready";
      showEditorPage("new");
    } catch (error) {
      showToast(error?.message || "A new invoice number could not be reserved.");
    }
    return;
  }
  if (!canReplaceCurrentDraft("Start a new invoice and replace the current unsaved draft?")) return;
  clearValidationErrors();
  try {
    const nextState = await createLocalInvoiceDraft({ reserve: true });
    await deleteStoredDraft();
    state = nextState;
  } catch (error) {
    showToast(error?.message || "A new invoice could not be created. Check browser storage and try again.");
    return;
  }
  draftChanged = false;
  draftPersistenceEnabled = true;
  fillForm();
  saveDraft(false);
  showEditorPage("new");
  showToast("New invoice ready.");
}

async function clearSavedDraft() {
  if (!window.confirm("Delete this draft from this device?")) return;
  if (!await resetDraft()) return;
  saveStatus.textContent = "Saved draft cleared";
  showToast("Draft deleted from this device.");
}

async function resetDraft() {
  clearTimeout(saveTimer);
  try {
    const nextState = await createLocalInvoiceDraft();
    await deleteStoredDraft();
    state = nextState;
  } catch (error) {
    showToast(error?.message || "The draft could not be replaced. Check browser storage and try again.");
    return false;
  }
  draftChanged = false;
  draftPersistenceEnabled = false;
  clearValidationErrors();
  fillForm();
  return true;
}

async function deleteUnsavedDraft() {
  if (!window.confirm("Delete this unsaved draft? This cannot be undone.")) return;
  if (!await resetDraft()) return;
  renderInvoiceHistory();
  saveStatus.textContent = "Draft deleted";
  showToast("Unsaved draft deleted.");
}

function hasEnteredContent() {
  return Boolean(
    state.billTo?.trim()
    || state.items.length > 1
    || state.items.some((item) => stripBoldMarkers(item.description).trim() || item.price !== ""),
  );
}

function fieldErrorMessage(input) {
  const messages = {
    invoiceNumber: "Enter an invoice number.",
    invoiceDate: "Choose an invoice date.",
    dueDate: "Choose a due date.",
    billTo: "Enter a customer or company name.",
    igHandle: "Use a username of up to 30 letters, numbers, dots or underscores.",
    quantity: "Enter a whole-number quantity of at least 1.",
    description: "Enter an item description.",
    price: "Enter a price from -$999,999,999.99 to $999,999,999.99.",
  };
  if (input.dataset.field === "dueDate" && hasInvalidDateOrder()) {
    return "Due date cannot be earlier than the invoice date.";
  }
  return messages[input.dataset.field || input.dataset.itemField] || "Complete this field.";
}

function hasInvalidDateOrder() {
  return Boolean(state.invoiceDate && state.dueDate && state.dueDate < state.invoiceDate);
}

function showFieldError(input) {
  const itemId = input.closest(".item-row")?.dataset.itemId;
  const key = input.dataset.field || `${itemId}-${input.dataset.itemField}`;
  const errorId = `error-${key}`;
  let error = document.getElementById(errorId);
  if (!error) {
    error = document.createElement("p");
    error.id = errorId;
    error.className = "field-error";
    input.parentElement.append(error);
  }
  error.textContent = fieldErrorMessage(input);
  error.dataset.validation = input.dataset.field === "dueDate" && hasInvalidDateOrder() ? "date-order" : "field";
  input.setAttribute("aria-invalid", "true");
  const describedBy = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  describedBy.add(errorId);
  input.setAttribute("aria-describedby", [...describedBy].join(" "));
}

function clearFieldError(input) {
  const describedBy = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  const errorIds = describedBy.filter((id) => id.startsWith("error-"));
  errorIds.forEach((id) => document.getElementById(id)?.remove());
  const remaining = describedBy.filter((id) => !errorIds.includes(id));
  if (remaining.length) input.setAttribute("aria-describedby", remaining.join(" "));
  else input.removeAttribute("aria-describedby");
  input.removeAttribute("aria-invalid");
}

function validateForm() {
  form.querySelectorAll('[aria-invalid="true"]').forEach(clearFieldError);
  updateRequiredTextValidity(document.querySelector("#invoiceNumber"));
  updateRequiredTextValidity(document.querySelector("#billTo"));
  const invalidInputs = [...form.querySelectorAll("input, textarea, select")].filter((input) => !input.validity.valid);
  const dueDate = document.querySelector("#dueDate");
  if (hasInvalidDateOrder() && !invalidInputs.includes(dueDate)) invalidInputs.push(dueDate);
  invalidInputs.forEach(showFieldError);
  return invalidInputs;
}

function viewPreview() {
  const previewPanel = document.querySelector("#preview-panel");
  document.querySelector("#invoiceNumber").value = state.invoiceNumber || "";
  renderPreview();
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  previewPanel.scrollIntoView({ behavior, block: "start" });
  previewPanel.focus({ preventScroll: true });
}

function viewEditor() {
  fillForm();
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.querySelector("#editorTitle").scrollIntoView({ behavior, block: "start" });
  document.querySelector("#editorTitle").focus({ preventScroll: true });
}

function invoiceIsReady(action) {
  const invalidInputs = validateForm();
  if (invalidInputs.length) {
    showToast(`Complete the highlighted fields before ${action}.`);
    invalidInputs[0].focus();
    return false;
  }
  if (!Number.isFinite(invoiceTotal())) {
    showToast(`The invoice total is too large. Reduce a quantity or price before ${action}.`);
    return false;
  }
  if (invoiceSheet.scrollHeight > PAPER_HEIGHT + 2 || invoiceSheet.scrollWidth > PAPER_WIDTH + 2) {
    showToast("This invoice is too long for the one-page template. Shorten the terms or an item, or remove a row.");
    return false;
  }
  state.invoiceNumber = state.invoiceNumber.trim();
  state.billTo = state.billTo.trim();
  document.querySelector("#invoiceNumber").value = state.invoiceNumber;
  document.querySelector("#billTo").value = state.billTo;
  if (!state.pdfFileNameCustomized) {
    state.pdfFileName = state.invoiceNumber;
    pdfFileNameInput.value = state.invoiceNumber;
  }
  renderPreview();
  hideToast();
  return true;
}

function clearOutputPdfContext() {
  outputPdfContext = undefined;
  cloudPdfPanel.hidden = true;
  cloudPdfStatus.textContent = "";
  delete cloudPdfStatus.dataset.state;
  retryCloudPdfButton.hidden = true;
}

function isCurrentOutputPdf(context) {
  return context && outputPdfContext === context && context.epoch === sessionEpoch
    && context.uid === currentUser?.id;
}

function setCloudPdfStatus(message, status) {
  cloudPdfPanel.hidden = false;
  cloudPdfStatus.textContent = message;
  cloudPdfStatus.dataset.state = status;
  retryCloudPdfButton.hidden = status !== "error";
}

async function outputPdfBlob(context) {
  if (!context.blobPromise) {
    context.blobPromise = createInvoicePdfWorker(context).then(async ({ worker }) => {
      const blob = await worker.outputPdf("blob");
      if (!(blob instanceof Blob) || !blob.size) throw new Error("The PDF could not be created.");
      context.blob = blob;
      return blob;
    }).catch((error) => {
      context.blobPromise = undefined;
      throw error;
    });
  }
  return context.blobPromise;
}

async function saveOutputPdfToAccount() {
  const context = outputPdfContext;
  if (!isCurrentOutputPdf(context) || outputBusy || context.saved) return;
  setOutputBusy(true, "Saving PDF to account...");
  setCloudPdfStatus("Invoice details saved. Creating and saving your PDF to this account...", "saving");
  try {
    const blob = await outputPdfBlob(context);
    if (!isCurrentOutputPdf(context)) return;
    const record = { id: context.id, revision: context.revision };
    const result = await backend.saveInvoicePdf(context.uid, record, blob);
    if (!isCurrentOutputPdf(context)) return;
    if (result.alreadySaved) {
      // A different renderer may have saved this revision first. Reuse the
      // stored bytes for downloads and print, including PDF metadata.
      const storedBlob = await backend.loadInvoicePdf(context.uid, record);
      if (!isCurrentOutputPdf(context)) return;
      context.blob = storedBlob;
      context.blobPromise = Promise.resolve(storedBlob);
    }
    context.saved = true;
    setCloudPdfStatus("PDF saved to your account.", "saved");
  } catch (error) {
    if (!isCurrentOutputPdf(context)) return;
    const reason = ["storage/unauthorized", "storage/bucket-not-found", "PDF_STORAGE_UNAVAILABLE"].includes(error?.code)
      ? "Cloud PDF storage needs to be enabled by the app administrator."
      : error?.code === "PDF_CONTENT_CONFLICT"
        ? "Save this invoice again to create a new PDF version."
        : ["INVOICE_NOT_FOUND", "INVOICE_REVISION_CONFLICT"].includes(error?.code)
        ? "This invoice changed on another device. Reopen its latest saved version before saving a PDF."
        : error?.code === "PDF_INVALID_FILE"
          ? "The generated PDF could not be accepted by cloud storage."
          : !context.blob
            ? "The PDF could not be created. Try again."
            : "Retry the upload when your connection is available.";
    setCloudPdfStatus(`Invoice details saved. We couldn't confirm that the PDF was saved to your account. ${reason} You can still download or print a copy.`, "error");
  } finally {
    if (isCurrentOutputPdf(context)) setOutputBusy(false);
  }
}

async function openOutputDialog(event) {
  if (invoiceSaving) return;
  if (!invoiceIsReady("saving or printing")) return;
  invoiceSaving = true;
  outputDialogTrigger = event.currentTarget;
  const controls = [...document.querySelectorAll(".header-actions button, #editorPage button")];
  const previousDisabled = controls.map((button) => button.disabled);
  for (const button of controls) button.disabled = true;
  form.inert = true;
  try {
    const saved = await saveCurrentInvoiceToHistory();
    if (!saved) return;
    clearOutputPdfContext();
    outputFileName.textContent = `${safePdfFileName(state.pdfFileName, state.invoiceNumber)}.pdf`;
    if (backend.pdfStorageAvailable) {
      outputPdfContext = {
        uid: currentUser.id, id: state.historyId, revision: state.historyRevision,
        epoch: sessionEpoch, invoice: cloneInvoice(state), saved: false,
        // Clone the rendered sheet and styles before any asynchronous work.
        exportSheet: capturePdfExportSheet(),
      };
    } else if (backend.provider === "firebase" && backend.pdfStorageAvailable === false) {
      setCloudPdfStatus("Invoice details saved. Cloud PDF storage is not configured yet; download a copy to this device.", "unavailable");
    }
    outputDialog.showModal();
    if (outputPdfContext) await saveOutputPdfToAccount();
  } finally {
    controls.forEach((button, index) => { button.disabled = previousDisabled[index]; });
    form.inert = false;
    invoiceSaving = false;
  }
}

function closeOutputDialog() {
  if (outputBusy) return;
  dismissOutputDialog();
}

function dismissOutputDialog() {
  outputDialog.close();
  if (outputDialogTrigger?.isConnected) outputDialogTrigger.focus();
  outputDialogTrigger = undefined;
}

function setOutputBusy(isBusy, label = "Creating PDF...") {
  outputBusy = isBusy;
  savePdfButton.disabled = isBusy;
  printNowButton.disabled = isBusy;
  closeOutputDialogButton.disabled = isBusy;
  cancelOutputDialogButton.disabled = isBusy;
  retryCloudPdfButton.disabled = isBusy;
  savePdfButtonLabel.textContent = isBusy ? label : "Save as PDF";
  outputDialog.setAttribute("aria-busy", String(isBusy));
}

function pdfSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addSearchablePdfText(pdf, invoice = state) {
  if (typeof pdf?.text !== "function") return;
  const lines = [
    "INVOICE",
    `Invoice Number: ${pdfSearchText(invoice.invoiceNumber)}`,
    `Invoice Date: ${formatDate(invoice.invoiceDate)}`,
    `Invoice Due Date: ${formatDate(invoice.dueDate)}`,
    "BILL FROM: TIONG BAHRU SERVICED APARTMENTS PTE LTD, UEN 201420098R",
    `BILL TO: ${pdfSearchText(formattedBillTo(invoice))}`,
    ...invoice.items.map((item, index) => (
      `${index + 1}. ${pdfSearchText(stripBoldMarkers(item.description))} - SGD ${formatAmount(Number(item.quantity) * Number(item.price))}`
    )),
    `TOTAL: SGD ${formatAmount(invoice.items.reduce((total, item) => total + Number(item.quantity) * Number(item.price), 0))}`,
    pdfSearchText(invoice.terms ?? DEFAULT_INVOICE_TERMS),
    "PAYNOW: TIONG BAHRU SERVICED APARTMENTS PTE LTD, UEN 201420098R",
    "sgtbsapl@gmail.com - instagram.com/enghoonresidences",
  ];
  if (typeof pdf.setFont === "function") pdf.setFont("helvetica", "normal");
  if (typeof pdf.setFontSize === "function") pdf.setFontSize(3);
  pdf.text(lines, 2, 2, { renderingMode: "invisible", lineHeightFactor: 1 });
  if (typeof pdf.setLanguage === "function") pdf.setLanguage("en-SG");
}

function loadPdfLibrary() {
  if (typeof window.html2pdf === "function") return Promise.resolve(window.html2pdf);
  if (pdfLibraryPromise) return pdfLibraryPromise;
  pdfLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDF_LIBRARY_URL;
    script.async = true;
    script.dataset.pdfLibrary = "html2pdf";
    script.addEventListener("load", () => {
      if (typeof window.html2pdf === "function") resolve(window.html2pdf);
      else reject(new Error("The PDF library did not initialize."));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("The PDF library could not be loaded.")), { once: true });
    document.head.append(script);
  }).catch((error) => {
    pdfLibraryPromise = undefined;
    document.querySelector('script[data-pdf-library="html2pdf"]')?.remove();
    throw error;
  });
  return pdfLibraryPromise;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("The invoice logo could not be read.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function embeddedImageSource(image) {
  const source = image.currentSrc || image.src;
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
  const response = await fetch(source, { cache: "force-cache" });
  if (!response.ok) throw new Error("The invoice logo could not be loaded.");
  return blobToDataUrl(await response.blob());
}

function capturePdfExportSheet() {
  const exportSheet = invoiceSheet.cloneNode(true);
  const sourceElements = [invoiceSheet, ...invoiceSheet.querySelectorAll("*")];
  const exportElements = [exportSheet, ...exportSheet.querySelectorAll("*")];

  sourceElements.forEach((sourceElement, index) => {
    const computedStyle = window.getComputedStyle(sourceElement);
    const exportElement = exportElements[index];
    for (let propertyIndex = 0; propertyIndex < computedStyle.length; propertyIndex += 1) {
      const property = computedStyle[propertyIndex];
      exportElement.style.setProperty(property, computedStyle.getPropertyValue(property));
    }
  });

  exportSheet.removeAttribute("id");
  exportSheet.style.width = `${Math.floor(PAPER_WIDTH)}px`;
  exportSheet.style.height = "auto";
  exportSheet.style.minHeight = `${Math.floor(PAPER_HEIGHT) - 1}px`;
  exportSheet.style.margin = "0";
  exportSheet.style.boxShadow = "none";
  exportSheet.style.transform = "none";
  return exportSheet;
}

async function createPdfExportSheet(capturedSheet) {
  const exportSheet = capturedSheet ? capturedSheet.cloneNode(true) : capturePdfExportSheet();
  await Promise.all([...exportSheet.querySelectorAll("img")].map(async (image) => {
    const source = await embeddedImageSource(image);
    image.removeAttribute("srcset");
    image.src = source;
    if (typeof image.decode === "function") await image.decode();
  }));
  return exportSheet;
}

async function createInvoicePdfWorker(context) {
  const invoice = context?.invoice || cloneInvoice(state);
  const [, exportSheet] = await Promise.all([loadPdfLibrary(), createPdfExportSheet(context?.exportSheet)]);
  const pdfBaseName = safePdfFileName(invoice.pdfFileName, invoice.invoiceNumber);
  const pdfFileName = `${pdfBaseName}.pdf`;
  const worker = window
    .html2pdf()
    .set({
      margin: 0,
      filename: pdfFileName,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { backgroundColor: "#ffffff", scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .from(exportSheet)
    .toPdf()
    .get("pdf")
    .then((pdf) => {
      try {
        addSearchablePdfText(pdf, invoice);
      } catch {
        // Keep the visual PDF available if an older PDF engine does not
        // support invisible searchable text.
      }
      pdf.setProperties({
        title: pdfBaseName,
        subject: `Invoice ${invoice.invoiceNumber}`,
        author: "Eng Hoon Residences",
        creator: "Eng Hoon Residences",
      });
    });
  return { worker, pdfBaseName, pdfFileName };
}

function downloadPdfBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadInvoicePdf() {
  if (outputBusy) return;
  if (!invoiceIsReady("saving")) {
    dismissOutputDialog();
    return;
  }

  setOutputBusy(true);
  const context = outputPdfContext;
  const uid = currentUser?.id;
  const epoch = sessionEpoch;
  const stillCurrent = () => currentUser?.id === uid && sessionEpoch === epoch;
  try {
    if (context) {
      const blob = await outputPdfBlob(context);
      if (!isCurrentOutputPdf(context)) return;
      const fileName = `${safePdfFileName(context.invoice.pdfFileName, context.invoice.invoiceNumber)}.pdf`;
      downloadPdfBlob(blob, fileName);
      if (context.saved) dismissOutputDialog();
      showToast(`${fileName} downloaded to this device.`);
    } else {
      const { worker, pdfFileName } = await createInvoicePdfWorker();
      if (!stillCurrent()) return;
      if (backend.provider === "firebase") {
        const blob = await worker.outputPdf("blob");
        if (!stillCurrent()) return;
        downloadPdfBlob(blob, pdfFileName);
      } else {
        await worker.save();
        if (!stillCurrent()) return;
      }
      dismissOutputDialog();
      showToast(backend.provider === "firebase" ? `${pdfFileName} downloaded to this device.` : `${pdfFileName} saved.`);
    }
  } catch (error) {
    if (!stillCurrent()) return;
    if (context && !isCurrentOutputPdf(context)) return;
    const message = typeof window.html2pdf === "function"
      ? "The PDF could not be created. Try again or use Print."
      : "PDF saving is unavailable. Check your connection and try again, or use Print.";
    showToast(message);
  } finally {
    if (stillCurrent() && (!context || isCurrentOutputPdf(context))) setOutputBusy(false);
  }
}

async function printInvoice() {
  if (outputBusy) return;
  if (!invoiceIsReady("printing")) {
    dismissOutputDialog();
    return;
  }
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Allow pop-ups for this site to print, or use Save as PDF.");
    return;
  }

  try {
    printWindow.document.title = "Preparing invoice...";
    printWindow.document.body.textContent = "Preparing a clean invoice for printing...";
    printWindow.document.body.style.cssText = "font: 16px system-ui; margin: 32px; color: #222;";
  } catch {
    // The PDF can still open if a browser does not expose the temporary tab.
  }

  setOutputBusy(true);
  const context = outputPdfContext;
  const uid = currentUser?.id;
  const epoch = sessionEpoch;
  const stillCurrent = () => currentUser?.id === uid && sessionEpoch === epoch;
  try {
    let pdfBlob;
    let pdfFileName;
    if (context) {
      pdfBlob = await outputPdfBlob(context);
      if (!isCurrentOutputPdf(context)) { printWindow.close(); return; }
      pdfFileName = `${safePdfFileName(context.invoice.pdfFileName, context.invoice.invoiceNumber)}.pdf`;
    } else {
      const result = await createInvoicePdfWorker();
      pdfBlob = await result.worker.outputPdf("blob");
      pdfFileName = result.pdfFileName;
    }
    if (!stillCurrent()) { printWindow.close(); return; }
    const pdfUrl = URL.createObjectURL(pdfBlob);
    printWindow.addEventListener("load", () => {
      window.setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch {
          // The clean PDF stays open so the browser's print button remains available.
        }
      }, 250);
    }, { once: true });
    printWindow.location.replace(pdfUrl);
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 300000);
    if (!context || context.saved) dismissOutputDialog();
    showToast(`${pdfFileName} opened for printing.`);
  } catch {
    printWindow.close();
    if (!stillCurrent()) return;
    if (context && !isCurrentOutputPdf(context)) return;
    const message = typeof window.html2pdf === "function"
      ? "The print copy could not be created. Try Save as PDF."
      : "Printing is unavailable. Check your connection and try again.";
    showToast(message);
  } finally {
    if (stillCurrent() && (!context || isCurrentOutputPdf(context))) setOutputBusy(false);
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
  toast.textContent = "";
}

function updatePreviewScale() {
  const stageStyles = window.getComputedStyle(previewStage);
  const horizontalPadding = Number.parseFloat(stageStyles.paddingLeft) + Number.parseFloat(stageStyles.paddingRight);
  const availableWidth = Math.max(1, previewStage.clientWidth - horizontalPadding);
  const scale = previewScaleMode === "actual" ? 1 : Math.min(1, availableWidth / PAPER_WIDTH);
  invoiceSheet.style.transform = `scale(${scale})`;
  paperScaleWrap.style.width = `${PAPER_WIDTH * scale}px`;
  paperScaleWrap.style.height = `${PAPER_HEIGHT * scale}px`;
}

function setPreviewScaleMode(mode) {
  previewScaleMode = mode;
  fitPreviewButton.setAttribute("aria-pressed", String(mode === "fit"));
  actualSizePreviewButton.setAttribute("aria-pressed", String(mode === "actual"));
  updatePreviewScale();
}

function updateConnectionStatus() {
  offlineBanner.hidden = navigator.onLine || backend.guestMode;
  if (navigator.onLine || backend.guestMode) {
    clearTimeout(draftRetryTimer);
    flushDraftOutbox({ force: true });
  } else if (currentUser) {
    draftOutbox.has(currentUser.id).then((pending) => {
      if (pending) setDraftSyncStatus("waiting", "Saved on this device. Waiting to sync");
    }).catch(() => {});
  }
}

form.addEventListener("input", handleFieldInput);
customizePdfFileName.addEventListener("change", togglePdfFileNameEditing);
form.addEventListener("input", (event) => {
  if (event.target.matches("[required]") && event.target.validity.valid) clearFieldError(event.target);
  if (event.target.id === "invoiceDate" || event.target.id === "dueDate") {
    const dueDate = document.querySelector("#dueDate");
    const dueDateError = document.querySelector("#error-dueDate");
    if (!state.invoiceDate || !state.dueDate) {
      if (dueDateError?.dataset.validation === "date-order") clearFieldError(dueDate);
      return;
    }
    if (hasInvalidDateOrder()) {
      if (dueDate.getAttribute("aria-invalid") === "true") showFieldError(dueDate);
      return;
    }
    if (dueDateError?.dataset.validation === "date-order") clearFieldError(dueDate);
  }
});
itemsEditor.addEventListener("input", handleItemInput);
itemsEditor.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-item]");
  if (button) removeItem(button.dataset.removeItem);
});
document.querySelector("#addItemButton").addEventListener("click", addItem);
newInvoiceButton.addEventListener("click", newInvoice);
document.querySelector("#mobileNewInvoiceButton").addEventListener("click", newInvoice);
historyNewInvoiceButton.addEventListener("click", newInvoice);
document.querySelector("#emptyStateNewInvoiceButton").addEventListener("click", newInvoice);
document.querySelector("#continueDraftButton").addEventListener("click", () => {
  const mode = state.historyId ? "edit" : "new";
  fillForm();
  saveStatus.textContent = "Draft restored";
  showEditorPage(mode);
});
document.querySelector("#deleteDraftButton").addEventListener("click", deleteUnsavedDraft);
invoiceListButton.addEventListener("click", () => showInvoiceList());
invoiceHistoryList.addEventListener("click", (event) => {
  const downloadPdfButton = event.target.closest("[data-download-invoice-pdf]");
  if (downloadPdfButton) {
    downloadSavedInvoicePdf(downloadPdfButton.dataset.downloadInvoicePdf, downloadPdfButton);
    return;
  }
  const editButton = event.target.closest("[data-edit-invoice]");
  if (editButton) {
    editSavedInvoice(editButton.dataset.editInvoice);
    return;
  }
  const duplicateButton = event.target.closest("[data-duplicate-invoice]");
  if (duplicateButton) {
    duplicateSavedInvoice(duplicateButton.dataset.duplicateInvoice);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-invoice]");
  if (deleteButton) deleteSavedInvoice(deleteButton.dataset.deleteInvoice);
});
invoiceSearch.addEventListener("input", () => {
  clearTimeout(historySearchTimer);
  historyQuery = invoiceSearch.value.trim();
  historySearchTimer = window.setTimeout(() => {
    if (historyLoading) {
      invoiceSearch.dispatchEvent(new Event("input", { bubbles: false }));
      return;
    }
    loadInvoiceHistory({ reset: true });
  }, 300);
});
loadMoreInvoicesButton.addEventListener("click", () => loadInvoiceHistory());
retryHistoryButton.addEventListener("click", () => loadInvoiceHistory({ reset: invoiceHistory.length === 0 }));
exportDataButton.addEventListener("click", async () => {
  try {
    await downloadWorkspaceBackup();
  } catch (error) {
    showToast(error?.message || "The backup could not be created.");
  }
});
importDataButton.addEventListener("click", requestBackupRestore);
recoveryExportButton.addEventListener("click", () => {
  try {
    downloadLocalBackup({ recovery: true });
  } catch (error) {
    storageRecoveryDetail.textContent = error?.message || "The recovery backup could not be created.";
  }
});
recoveryImportButton.addEventListener("click", requestBackupRestore);
recoveryRetryButton.addEventListener("click", () => window.location.reload());
recoveryClearButton.addEventListener("click", clearRecoveryData);
importDataFile.addEventListener("change", restoreBackupFile);
document.querySelector("#clearDraftButton").addEventListener("click", clearSavedDraft);
printButton.addEventListener("click", openOutputDialog);
document.querySelector("#mobilePrintButton").addEventListener("click", openOutputDialog);
document.querySelector("#mobileViewPreviewButton").addEventListener("click", viewPreview);
fitPreviewButton.addEventListener("click", () => setPreviewScaleMode("fit"));
actualSizePreviewButton.addEventListener("click", () => setPreviewScaleMode("actual"));
backToEditorButton.addEventListener("click", viewEditor);
savePdfButton.addEventListener("click", downloadInvoicePdf);
retryCloudPdfButton.addEventListener("click", saveOutputPdfToAccount);
printNowButton.addEventListener("click", printInvoice);
closeOutputDialogButton.addEventListener("click", closeOutputDialog);
cancelOutputDialogButton.addEventListener("click", closeOutputDialog);
outputDialog.addEventListener("cancel", (event) => {
  if (outputBusy) event.preventDefault();
});
outputDialog.addEventListener("click", (event) => {
  if (event.target === outputDialog) closeOutputDialog();
});
outputDialog.addEventListener("close", () => {
  if (outputDialogTrigger?.isConnected) outputDialogTrigger.focus();
  outputDialogTrigger = undefined;
});
legacyMigrationDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelLegacyMigration();
});
moveLegacyDataButton.addEventListener("click", moveLegacyBrowserData);
exportLegacyDataButton.addEventListener("click", exportLegacyBrowserData);
discardLegacyDataButton.addEventListener("click", discardLegacyBrowserData);
cancelLegacyMigrationButton.addEventListener("click", cancelLegacyMigration);
document.querySelector("#skipLegacyMigrationButton").addEventListener("click", () => finishLegacyMigrationPrompt("skipped"));
document.querySelector("#retryWorkspaceButton").addEventListener("click", () => {
  if (currentUser) loadAuthenticatedWorkspace({ user: currentUser });
});
document.querySelector("#refreshInvoicesButton").addEventListener("click", () => loadInvoiceHistory({ reset: true }));
draftConflictDialog.addEventListener("cancel", (event) => event.preventDefault());
keepLocalDraftButton.addEventListener("click", () => finishDraftConflictChoice("local"));
keepCloudDraftButton.addEventListener("click", () => finishDraftConflictChoice("cloud"));

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
window.addEventListener("storage", (event) => {
  if (!currentUser || event.storageArea !== localStorage) return;
  if (event.key === HISTORY_KEY || event.key === RESTORE_JOURNAL_KEY) {
    if (currentPage === "history") loadInvoiceHistory({ reset: true });
    else showToast("Invoice history changed in another tab. Return to Invoices to refresh it.");
  }
  if ([STORAGE_KEY, DRAFT_REVISION_KEY, RESTORE_JOURNAL_KEY].includes(event.key)) {
    clearTimeout(draftStorageRefreshTimer);
    draftStorageRefreshTimer = window.setTimeout(async () => {
      if (currentPage !== "history") {
        showToast("The saved draft changed in another tab. Return to Invoices to review it.");
        return;
      }
      try {
        const storedDraft = await backend.loadDraft(currentUser.id);
        if (storedDraft?.invoice) {
          state = normalizeInvoiceData(storedDraft.invoice) || state;
          draftRevision = storedDraft.revision;
          draftChanged = Boolean(state.draftDirty);
          draftPersistenceEnabled = true;
          editorMode = state.historyId ? "edit" : "new";
        } else {
          state = await createLocalInvoiceDraft();
          draftRevision = undefined;
          draftChanged = false;
          draftPersistenceEnabled = false;
          editorMode = "new";
        }
        fillForm();
        renderInvoiceHistory();
      } catch (error) {
        if (["LOCAL_DATA_CORRUPT", "LOCAL_STORAGE_UNAVAILABLE"].includes(error?.code)) showStorageRecovery(error);
      }
    }, 60);
  }
});
window.addEventListener("pagehide", persistDraftImmediately);
window.addEventListener("pageshow", () => {
  reconcileResumedAuthSession();
  checkForAppUpdate();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistDraftImmediately();
  else {
    reconcileResumedAuthSession();
    checkForAppUpdate();
  }
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  installPrompt = undefined;
  showToast("Quotini installed.");
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined;
  installButton.hidden = true;
});

document.querySelector(".skip-link").addEventListener("click", () => {
  requestAnimationFrame(() => {
    const target = currentPage === "settings" ? document.querySelector("#settingsTitle") : currentPage === "editor"
      ? editorTitle
      : currentPage === "history"
        ? document.querySelector("#invoiceListTitle")
        : currentPage === "recovery"
          ? document.querySelector("#storageRecoveryTitle")
          : document.querySelector("#authTitle");
    target?.focus({ preventScroll: true });
  });
});

authForm.addEventListener("submit", handleSignIn);
googleSignInButton.addEventListener("click", handleGoogleSignIn);
createAccountButton.addEventListener("click", handleCreateAccount);
forgotPasswordButton.addEventListener("click", handlePasswordReset);
authEmail.addEventListener("input", () => {
  if (normalizeAuthEmail(authEmail.value) !== pendingAuthEmailRequest) updateAuthEmailActions();
});
passwordRecoveryForm.addEventListener("submit", handlePasswordRecovery);
recoveryPasswordConfirm.addEventListener("input", () => recoveryPasswordConfirm.setCustomValidity(""));
signOutButton.addEventListener("click", handleSignOut);

function offerServiceWorkerUpdate(worker) {
  if (!worker) return;
  waitingServiceWorker = worker;
  updateButton.hidden = false;
  updateButton.disabled = authBusy || serviceWorkerUpdateRequested;
}

function checkForAppUpdate() {
  if (!serviceWorkerRegistration || navigator.onLine === false || authBusy) return;
  if (Date.now() - serviceWorkerUpdateCheck < 60000) return;
  serviceWorkerUpdateCheck = Date.now();
  serviceWorkerRegistration.update().catch(() => {});
}

updateButton.addEventListener("click", () => {
  if (!waitingServiceWorker || authBusy || serviceWorkerUpdateRequested) return;
  serviceWorkerUpdateRequested = true;
  updateButton.disabled = true;
  updateButton.textContent = "Updating...";
  waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForServiceWorker || !serviceWorkerUpdateRequested) return;
    reloadingForServiceWorker = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((registration) => {
        serviceWorkerRegistration = registration;
        if (registration.waiting) offerServiceWorkerUpdate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) offerServiceWorkerUpdate(worker);
          });
        });
      })
      .catch(() => {
        showToast("Offline setup could not be completed.");
      });
  });
}

if ("ResizeObserver" in window) {
  const previewObserver = new ResizeObserver(updatePreviewScale);
  previewObserver.observe(previewStage);
} else {
  window.addEventListener("resize", updatePreviewScale);
}
window.addEventListener("beforeprint", () => {
  invoiceSheet.style.transform = "none";
});
window.addEventListener("afterprint", () => {
  updatePreviewScale();
});

updateConnectionStatus();
updatePreviewScale();
initializeApplication();

const paymentDialog = document.querySelector("#paymentDialog");
const paymentForm = document.querySelector("#paymentForm");
const paymentStatus = document.querySelector("#paymentStatus");
const paymentRemarks = document.querySelector("#paymentRemarks");
const paymentScreenshot = document.querySelector("#paymentScreenshot");
const paymentConfirmed = document.querySelector("#paymentConfirmed");
const paymentPreview = document.querySelector("#paymentPreview");
const paymentError = document.querySelector("#paymentError");
const paymentSave = document.querySelector("#paymentSave");
let paymentContext;
let paymentImageVersion = 0;
function previewPayment(screenshot) {
  paymentPreview.hidden = !screenshot;
  if (screenshot) paymentPreview.src = screenshot;
  else paymentPreview.removeAttribute("src");
}
function updatePaymentFields() {
  const needsEvidence = paymentStatus.value !== "unpaid";
  document.querySelector("#paymentEvidence").hidden = !needsEvidence;
  document.querySelector("#paymentEvidenceTitle").textContent = paymentStatus.value === "refunded" ? "Refund screenshot" : "Payment screenshot";
  document.querySelector("#paymentRemovalHint").hidden = needsEvidence || !paymentContext?.value?.screenshot;
}
async function openPayment(record) {
  const context = { uid: currentUser.id, epoch: sessionEpoch, id: record.id };
  paymentContext = context;
  paymentForm.reset();
  updatePaymentFields();
  paymentError.textContent = "Loading payment details…";
  paymentSave.disabled = true;
  previewPayment("");
  document.querySelector("#paymentInvoiceNumber").textContent = record.invoice.invoiceNumber;
  paymentDialog.showModal();
  try {
    const value = await backend.loadPayment(context.uid, context.id);
    if (paymentContext !== context || currentUser?.id !== context.uid || sessionEpoch !== context.epoch) return;
    Object.assign(context, { value, screenshot: value.screenshot, evidenceStatus: value.status });
    paymentStatus.value = value.status;
    paymentRemarks.value = value.remarks;
    updatePaymentFields();
    previewPayment(value.screenshot);
    paymentError.textContent = "";
    paymentSave.disabled = false;
  } catch (error) { if (paymentContext === context) paymentError.textContent = error.message; }
}
paymentDialog.addEventListener("close", () => { paymentContext = null; paymentImageVersion++; previewPayment(""); });
document.querySelector("#paymentCancel").addEventListener("click", () => paymentDialog.close());
paymentStatus.addEventListener("change", () => {
  updatePaymentFields();
  paymentConfirmed.checked = false;
  if (paymentContext) { paymentContext.screenshot = ""; paymentContext.evidenceStatus = paymentStatus.value; }
  paymentScreenshot.value = "";
  paymentImageVersion++;
  previewPayment("");
});
paymentScreenshot.addEventListener("change", async () => {
  const context = paymentContext;
  const version = ++paymentImageVersion;
  const file = paymentScreenshot.files[0];
  paymentConfirmed.checked = false;
  if (!context) return;
  context.screenshot = "";
  previewPayment("");
  if (!file) return;
  paymentSave.disabled = true;
  paymentError.textContent = "Preparing screenshot…";
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP screenshot up to 10 MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "white"; drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const screenshot = canvas.toDataURL("image/jpeg", 0.8);
    if (screenshot.length > 700000) throw new Error("This screenshot is too large. Crop it to the transaction details and try again.");
    if (paymentContext !== context || version !== paymentImageVersion) return;
    context.screenshot = screenshot;
    context.evidenceStatus = paymentStatus.value;
    previewPayment(screenshot);
    paymentError.textContent = "Review the preview before confirming.";
  } catch (error) { if (paymentContext === context && version === paymentImageVersion) paymentError.textContent = error.message; }
  finally { if (paymentContext === context) paymentSave.disabled = !context.value; }
});
paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const context = paymentContext;
  if (!context?.value || currentUser?.id !== context.uid || sessionEpoch !== context.epoch) return;
  paymentSave.disabled = true;
  try {
    await backend.savePayment(context.uid, context.id, { revision: context.value.revision, status: paymentStatus.value, remarks: paymentRemarks.value.trim(), screenshot: context.screenshot, confirmed: paymentConfirmed.checked });
    if (paymentContext !== context || currentUser?.id !== context.uid || sessionEpoch !== context.epoch) return;
    paymentDialog.close();
    await loadInvoiceHistory({ reset: true });
    showToast("Payment details saved.");
  } catch (error) { if (paymentContext === context) paymentError.textContent = error.message; }
  finally { if (paymentContext === context) paymentSave.disabled = false; }
});
document.querySelector("#paymentFilter").addEventListener("change", () => loadInvoiceHistory({ reset: true }));

function folderPath(id) {
  const parts = [];
  const visited = new Set();
  while (id && !visited.has(id)) {
    visited.add(id);
    const folder = invoiceFolders.find(entry => entry.id === id);
    if (!folder) break;
    parts.unshift(folder);
    id = folder.parentId;
  }
  return parts;
}
function navigateFolder(id) {
  if (currentPage !== "history") showInvoiceList(false);
  currentFolderId = id;
  historyQuery = "";
  invoiceSearch.value = "";
  loadInvoiceHistory({ reset: true });
}
function renderFolders() {
  const section = document.querySelector("#folderSection");
  section.hidden = !backend.createFolder || !currentUser;
  const sidebar = document.querySelector("#sidebarFolders");
  sidebar.hidden = section.hidden;
  const tree = document.querySelector("#sidebarFolderTree");
  tree.replaceChildren();
  if (section.hidden) return;
  const activePath = new Set(folderPath(currentFolderId).map(folder => folder.id));
  const addBranch = (parent, container, visited = new Set()) => {
    invoiceFolders.filter(folder => folder.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name)).forEach(folder => {
        if (visited.has(folder.id)) return;
        const children = invoiceFolders.some(child => child.parentId === folder.id);
        const row = document.createElement(children ? "details" : "div");
        row.className = "sidebar-folder-branch";
        if (children) row.open = activePath.has(folder.id);
        const heading = document.createElement(children ? "summary" : "div");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = folder.name;
        button.title = folder.name;
        if (folder.id === currentFolderId) button.setAttribute("aria-current", "page");
        button.addEventListener("click", event => { event.preventDefault(); navigateFolder(folder.id); });
        heading.append(button);
        row.append(heading);
        if (children) {
          const nested = document.createElement("div");
          nested.className = "sidebar-folder-children";
          addBranch(folder.id, nested, new Set([...visited, folder.id]));
          row.append(nested);
        }
        container.append(row);
      });
  };
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "All folders";
  if (currentFolderId === null) all.setAttribute("aria-current", "page");
  all.addEventListener("click", () => navigateFolder(null));
  tree.append(all);
  addBranch("", tree);
  const breadcrumbs = document.querySelector("#folderBreadcrumbs");
  breadcrumbs.replaceChildren();
  const crumb = (name, id, current) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.setAttribute("aria-label", name);
    if (current) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => navigateFolder(id));
    breadcrumbs.append(button);
  };
  crumb("All folders", null, currentFolderId === null);
  if (currentFolderId === "") crumb("Unfiled", "", true);
  folderPath(currentFolderId).forEach(folder => crumb(folder.name, folder.id, folder.id === currentFolderId));
  const grid = document.querySelector("#folderGrid");
  grid.replaceChildren();
  const addFolder = (name, id, hint) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-tile";
    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = name;
    const detail = document.createElement("small");
    detail.textContent = hint;
    button.append(icon, label, detail);
    button.addEventListener("click", () => navigateFolder(id));
    grid.append(button);
  };
  if (currentFolderId === null) addFolder("Unfiled", "", "Invoices without a folder");
  invoiceFolders.filter(folder => folder.parentId === (currentFolderId || ""))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(folder => {
      const count = invoiceFolders.filter(child => child.parentId === folder.id).length;
      addFolder(folder.name, folder.id, count ? `${count} subfolder${count === 1 ? "" : "s"}` : "Open folder");
    });
  document.querySelector("#savedInvoicesTitle").textContent = currentFolderId === null ? "Saved invoices" : "Invoices in this folder";
  const empty = document.querySelector("#historyNoResults");
  if (currentFolderId !== null && !historyQuery && document.querySelector("#paymentFilter").value === "all") {
    empty.querySelector("h2").textContent = "No invoices in this folder";
    empty.querySelector("p").textContent = "Use More → Move to folder on an invoice to organise it here.";
  } else {
    empty.querySelector("h2").textContent = "No matching invoices";
    empty.querySelector("p").textContent = "Try another search or payment status.";
  }
}
function openFolderDialog(record = null) {
  folderAction = { uid: currentUser.id, epoch: sessionEpoch, record, parentId: currentFolderId || "" };
  const moving = Boolean(record);
  document.querySelector("#folderForm").reset();
  document.querySelector("#folderDialogTitle").textContent = moving ? "Move invoice" : "New folder";
  document.querySelector("#folderDialogContext").textContent = moving ? record.invoice.invoiceNumber : `Inside ${folderPath(currentFolderId).map(folder => folder.name).join(" / ") || "All folders"}`;
  document.querySelector("#folderNameField").hidden = moving;
  document.querySelector("#folderName").required = !moving;
  document.querySelector("#folderDestinationField").hidden = !moving;
  const destination = document.querySelector("#folderDestination");
  destination.replaceChildren(new Option("Unfiled", ""));
  invoiceFolders.map(folder => ({ id: folder.id, path: folderPath(folder.id).map(entry => entry.name).join(" / ") }))
    .sort((a, b) => a.path.localeCompare(b.path)).forEach(folder => destination.add(new Option(folder.path, folder.id)));
  destination.value = record?.folderId || "";
  document.querySelector("#folderError").textContent = "";
  document.querySelector("#folderSave").disabled = false;
  document.querySelector("#folderSave").textContent = moving ? "Move invoice" : "Create folder";
  document.querySelector("#folderDialog").showModal();
  document.querySelector(moving ? "#folderDestination" : "#folderName").focus();
}
document.querySelector("#newFolderButton").addEventListener("click", () => openFolderDialog());
document.querySelector("#folderCancel").addEventListener("click", () => document.querySelector("#folderDialog").close());
document.querySelector("#folderDialog").addEventListener("close", () => { folderAction = null; });
document.querySelector("#folderForm").addEventListener("submit", async event => {
  event.preventDefault();
  const action = folderAction;
  if (!action || action.uid !== currentUser?.id || action.epoch !== sessionEpoch) return;
  const button = document.querySelector("#folderSave");
  button.disabled = true;
  try {
    if (action.record) await backend.moveInvoice(action.uid, action.record.id, document.querySelector("#folderDestination").value, action.record.folderId || "");
    else await backend.createFolder(action.uid, document.querySelector("#folderName").value, action.parentId);
    if (folderAction !== action || action.uid !== currentUser?.id || action.epoch !== sessionEpoch) return;
    document.querySelector("#folderDialog").close();
    await loadInvoiceHistory({ reset: true });
    showToast(action.record ? "Invoice moved." : "Folder created.");
  } catch (error) {
    if (folderAction === action) document.querySelector("#folderError").textContent = error.message;
  } finally { if (folderAction === action) button.disabled = false; }
});
document.addEventListener("click", event => {
  if (!event.target.closest(".invoice-more")) document.querySelectorAll(".invoice-more[open]").forEach(menu => { menu.open = false; });
});

let logoUploadVersion = 0;
document.querySelector("#invoiceLogoUpload").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  const invoice = state;
  const epoch = sessionEpoch;
  const version = ++logoUploadVersion;
  const message = document.querySelector("#invoiceAppearanceError");
  message.textContent = "Preparing logo…";
  try {
    const data = await prepareInvoiceLogo(file);
    if (state !== invoice || epoch !== sessionEpoch || version !== logoUploadVersion) return;
    state.logo = data;
    renderPreview(); saveDraft();
    message.textContent = "Logo updated. Save the invoice to keep it.";
  } catch (error) { if (state === invoice && epoch === sessionEpoch && version === logoUploadVersion) message.textContent = error.message; }
  finally { event.target.value = ""; }
});
document.querySelector("#resetInvoiceLogo").addEventListener("click", () => {
  logoUploadVersion++; state.logo = activeBusinessProfile?.logo || (activeBusinessProfile && activeBusinessProfile.id !== "default" ? EMPTY_PROFILE_LOGO : ""); renderPreview(); saveDraft();
  document.querySelector("#invoiceAppearanceError").textContent = "Default logo restored.";
});
document.querySelector("#resetInvoiceTerms").addEventListener("click", () => {
  state.terms = activeBusinessProfile?.terms ?? DEFAULT_INVOICE_TERMS;
  document.querySelector("#terms").value = state.terms;
  renderPreview(); saveDraft();
});
let attachmentContext;
function currentAttachmentContext(context) {
  return attachmentContext === context && currentUser?.id === context.uid && sessionEpoch === context.epoch;
}
async function refreshAttachments(context) {
  const files = await backend.listAttachments(context.uid, context.id);
  if (!currentAttachmentContext(context)) return;
  const list = document.querySelector("#attachmentsList");
  list.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("li"); empty.textContent = "No files uploaded yet."; list.append(empty);
  }
  files.forEach(file => {
    const row = document.createElement("li");
    const name = document.createElement("span"); name.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
    const download = document.createElement("button"); download.type = "button"; download.className = "button button-secondary"; download.textContent = "Download";
    download.addEventListener("click", async () => {
      download.disabled = true;
      try {
        const blob = await backend.downloadAttachment(context.uid, context.id, file.id);
        if (currentAttachmentContext(context)) downloadPdfBlob(blob, file.name);
      } catch (error) { if (currentAttachmentContext(context)) document.querySelector("#attachmentsError").textContent = error.message; }
      finally { download.disabled = false; }
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button-danger"; remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove ${file.name}? This cannot be undone.`)) return;
      remove.disabled = true;
      try { await backend.deleteAttachment(context.uid, context.id, file.id); if (currentAttachmentContext(context)) await refreshAttachments(context); }
      catch (error) { if (currentAttachmentContext(context)) document.querySelector("#attachmentsError").textContent = error.message; remove.disabled = false; }
    });
    row.append(name, download, remove); list.append(row);
  });
}
async function openAttachments(record) {
  const context = { uid: currentUser.id, epoch: sessionEpoch, id: record.id };
  attachmentContext = context;
  document.querySelector("#attachmentsInvoice").textContent = record.invoice.invoiceNumber;
  document.querySelector("#attachmentsList").replaceChildren();
  document.querySelector("#invoiceAttachments").value = "";
  document.querySelector("#invoiceAttachments").disabled = true;
  document.querySelector("#attachmentsError").textContent = "Loading files…";
  document.querySelector("#attachmentsDialog").showModal();
  try { await refreshAttachments(context); if (currentAttachmentContext(context)) document.querySelector("#attachmentsError").textContent = ""; }
  catch (error) { if (currentAttachmentContext(context)) document.querySelector("#attachmentsError").textContent = error.message; }
  finally { if (currentAttachmentContext(context)) document.querySelector("#invoiceAttachments").disabled = false; }
}
document.querySelector("#attachmentsClose").addEventListener("click", () => document.querySelector("#attachmentsDialog").close());
document.querySelector("#attachmentsDialog").addEventListener("close", () => { attachmentContext = null; });
document.querySelector("#invoiceAttachments").addEventListener("change", async event => {
  const context = attachmentContext;
  if (!context || !currentAttachmentContext(context)) return;
  const files = [...event.target.files];
  event.target.disabled = true;
  try {
    for (const file of files) {
      if (!currentAttachmentContext(context)) return;
      document.querySelector("#attachmentsError").textContent = `Uploading ${file.name}…`;
      await backend.uploadAttachment(context.uid, context.id, file);
    }
    if (currentAttachmentContext(context)) { await refreshAttachments(context); document.querySelector("#attachmentsError").textContent = "Files uploaded."; }
  } catch (error) {
    if (currentAttachmentContext(context)) { await refreshAttachments(context).catch(() => {}); document.querySelector("#attachmentsError").textContent = error.message; }
  } finally { if (currentAttachmentContext(context)) { event.target.disabled = false; event.target.value = ""; } }
});

document.querySelector("#sidebarNewFolder").addEventListener("click", () => openFolderDialog());

var editingBusinessProfile;
let profileUploadPending = false;
function openBusinessProfile(create) {
  if (!currentUser || !backend.listProfiles || outputBusy) return;
  persistDraftImmediately();
  currentPage = "settings";
  document.body.dataset.page = "settings";
  invoiceListPage.hidden = true;
  editorPage.hidden = true;
  printButton.hidden = true;
  invoiceListButton.removeAttribute("aria-current");
  newInvoiceButton.removeAttribute("aria-current");
  document.querySelector("#editProfileButton").setAttribute("aria-current", "page");
  document.querySelector("#settingsPage").hidden = false;
  document.title = "Settings | Quotini";
  window.scrollTo({top:0});
  editingBusinessProfile = create ? { name: "", logo: "", terms: "" } : { ...activeBusinessProfile };
  document.querySelector("#profileDialogTitle").textContent = create ? "New business profile" : "Profile settings";
  document.querySelector("#profileName").value = editingBusinessProfile.name;
  document.querySelector("#profileTerms").value = editingBusinessProfile.terms ?? DEFAULT_INVOICE_TERMS;
  document.querySelector("#profileLogoUpload").value = "";
  const preview = document.querySelector("#profileLogoPreview");
  preview.hidden = !editingBusinessProfile.logo;
  if (editingBusinessProfile.logo) preview.src = editingBusinessProfile.logo;
  document.querySelector("#profileError").textContent = "";
  document.querySelector("#profileSave").disabled = false;
  document.querySelector("#settingsTitle").focus({preventScroll:true});
}
document.querySelector("#newProfileButton").addEventListener("click", () => openBusinessProfile(true));
document.querySelector("#editProfileButton").addEventListener("click", () => openBusinessProfile(false));
document.querySelector("#profileCancel").addEventListener("click", () => showInvoiceList());
document.querySelector("#profileLogoUpload").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  const profile = editingBusinessProfile;
  profileUploadPending = true;
  document.querySelector("#profileSave").disabled = true;
  try {
    profile.logo = await prepareInvoiceLogo(file);
    if (editingBusinessProfile !== profile) return;
    const preview = document.querySelector("#profileLogoPreview");
    preview.src = profile.logo; preview.hidden = false;
    document.querySelector("#profileError").textContent = "Logo ready. Save the profile to apply it.";
  } catch(error) { if (editingBusinessProfile === profile) document.querySelector("#profileError").textContent = error.message; }
  finally { profileUploadPending = false; document.querySelector("#profileSave").disabled = false; }
});
async function switchBusinessProfile(id) {
  if (outputBusy) throw new Error("Wait for the invoice to finish saving before switching profiles.");
  const persisted = await persistDraftImmediately();
  await outboxWriteQueue;
  if (!persisted && draftPersistenceEnabled && !await draftOutbox.has(currentUser.id)) throw new Error("Your draft could not be saved. Please retry before switching profiles.");
  await backend.selectProfile(id);
  // Reload clears in-flight requests and profile-specific UI; auth stays signed in.
  window.location.reload();
}
document.querySelector("#profileSelect").addEventListener("change", async event => {
  event.target.disabled = true;
  try { await switchBusinessProfile(event.target.value); }
  catch(error) { event.target.value = activeBusinessProfile.id; event.target.disabled = false; showToast(error.message); }
});
document.querySelector("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!editingBusinessProfile || profileUploadPending) return;
  const profile = editingBusinessProfile;
  const uid = currentUser?.id;
  document.querySelector("#profileSave").disabled = true;
  try {
    const saved = await backend.saveProfile({ ...profile, name: document.querySelector("#profileName").value, terms: document.querySelector("#profileTerms").value });
    if (editingBusinessProfile !== profile || currentUser?.id !== uid) return;
    if (!profile.id) { await switchBusinessProfile(saved.id); return; }
    activeBusinessProfile = saved;
    document.querySelector("#profileSelect option:checked").textContent = saved.name;
    editingBusinessProfile = { ...saved };
    document.querySelector("#profileError").textContent = "Changes saved.";
    showToast("Profile saved. Defaults apply to new invoices.");
  } catch(error) { if (editingBusinessProfile === profile) document.querySelector("#profileError").textContent = error.message; }
  finally { document.querySelector("#profileSave").disabled = false; }
});

async function prepareInvoiceLogo(file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP image up to 10 MB.");
    const image = await createImageBitmap(file);
    if (image.width !== 600 || image.height !== 530) {
      const dimensions = `${image.width} × ${image.height}`;
      image.close();
      throw new Error(`Your logo is ${dimensions} px. Upload a logo that is exactly 600 × 530 px to match the invoice layout.`);
    }
    const scale = Math.min(1, 400 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    let data = canvas.toDataURL("image/png");
    if (data.length > 120000) {
      const context = canvas.getContext("2d");
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL("image/jpeg", .75);
    }
    if (data.length > 120000) throw new Error("This logo is too detailed. Use a smaller or simpler image.");
    return data;
}
