const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdir, readFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");
const { webkit, devices } = require("playwright-core");
const { startServer, stopServer } = require("./browser-helpers");

for (const mobile of [false, true]) {
  test(`WebKit ${mobile ? "iPhone" : "desktop"}: login, validation, PDF persistence, reload and logout`, { timeout: 90000 }, async context => {
    assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/, "Use local Firebase emulators only");
    const server = await startServer({ firebase: true });
    context.after(() => stopServer(server));
    const browser = await webkit.launch({ headless: true });
    const browserContext = await browser.newContext(mobile ? { ...devices["iPhone 13"], acceptDownloads: true } : { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await browserContext.newPage();
    page.setDefaultTimeout(15000);
    context.after(async () => {
      const directory = join(__dirname, "../tmp/verification-round2/screenshots");
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `webkit-${mobile ? "mobile" : "desktop"}-last.png`) }).catch(() => {});
      if (context.error) console.log(await page.locator("body").innerText().catch(() => "Page unavailable"));
      await browser.close();
    });
    let phase = "initial login";
    const errors = [];
    const listenSessions = new Set();
    let retiringSessions = new Set();
    let reloading = false;
    const cancelledOnReload = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname === "/google.firestore.v1.Firestore/Listen/channel" && url.searchParams.has("SID")) {
        listenSessions.add(url.searchParams.get("SID"));
      }
    });
    page.on("pageerror", error => {
      // WebKit reports cancelled XHRs from the departing document as access-control
      // errors. Exempt only an observed OLD Firestore session during page.reload().
      // A new-session error, unrelated endpoint, or error outside reload still fails.
      const match = error.message.match(/^\/(127\.0\.0\.1:\d+\/google\.firestore\.v1\.Firestore\/Listen\/channel\?\S+) due to access control checks\.$/);
      const failedUrl = match ? new URL(`http://${match[1]}`) : null;
      if (reloading && failedUrl?.host === process.env.FIRESTORE_EMULATOR_HOST && retiringSessions.has(failedUrl.searchParams.get("SID"))) {
        cancelledOnReload.push(error.message);
      } else errors.push({ phase, message: error.message });
    });
    const directory = join(__dirname, "../tmp/verification-round2/screenshots");
    await mkdir(directory, { recursive: true });
    const capture = async name => {
      await page.locator("#appLoadingScreen").waitFor({ state: "hidden" });
      return page.screenshot({ path: join(directory, `webkit-${mobile ? "mobile" : "desktop"}-${name}.png`) });
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("#authPage").waitFor({ state: "visible" });
    await page.locator("#appLoadingScreen").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await capture("login");
    const email = `webkit-${mobile}-${Date.now()}@example.test`;
    await page.locator("#authEmail").fill(email);
    await page.locator("#authPassword").fill("WebKit-test-123!");
    await page.locator("#createAccountButton").click();
    await page.locator("#invoiceListPage").waitFor({ state: "visible" });
    await page.locator("#emptyStateNewInvoiceButton").click();
    await page.locator("#editorPage").waitFor({ state: "visible" });
    await page.locator("#billTo").fill("WEBKIT TEST CUSTOMER");
    await page.locator('[data-item-field="description"]').fill("2 DAYS RENTAL OF 4 TABLES & 5 CHAIRS");
    await page.locator('[data-item-field="price"]').fill("90");
    await page.locator("#customizePdfFileName").check();
    await page.locator("#pdfFileName").fill(`WEBKIT-${mobile ? "MOBILE" : "DESKTOP"}`);
    const save = page.locator(mobile ? "#mobilePrintButton" : "#printButton");
    await page.locator('[data-item-field="quantity"]').fill("0");
    await save.click();
    assert.equal(await page.locator("#outputDialog").isVisible(), false, "invalid quantity must prevent saving");
    await page.locator('[data-item-field="quantity"]').fill("1");
    await save.click();
    await page.locator('#cloudPdfStatus[data-state="saved"]').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector("#savePdfButton").disabled);
    await capture("pdf-ready");
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#savePdfButton").click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), `WEBKIT-${mobile ? "MOBILE" : "DESKTOP"}.pdf`);
    const pdf = await readFile(await download.path());
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
    assert.match(pdf.toString("latin1"), /WEBKIT TEST CUSTOMER/);
    await page.locator("#outputDialog").waitFor({ state: "hidden" });
    phase = "reload";
    retiringSessions = new Set(listenSessions);
    assert.ok(retiringSessions.size > 0, "capture the live connection before navigating");
    reloading = true;
    try { await page.reload(); } finally { reloading = false; }
    await page.locator(".invoice-record").waitFor();
    assert.ok([...listenSessions].some(sid => !retiringSessions.has(sid)), "reload establishes a new Firestore connection");
    assert.equal(await page.locator("#accountEmail").textContent(), email);
    assert.match(await page.locator(".invoice-record").innerText(), /90.00/);
    await page.locator(".invoice-record .invoice-more summary").click();
    const historyDownloadEvent = page.waitForEvent("download");
    await page.locator("[data-download-invoice-pdf]").click();
    const historyDownload = await historyDownloadEvent;
    const persisted = await readFile(await historyDownload.path());
    assert.equal(createHash("sha256").update(persisted).digest("hex"), createHash("sha256").update(pdf).digest("hex"));
    await capture("history");
    phase = "sign out";
    await page.locator("#signOutButton").click();
    await page.locator("#authPage").waitFor({ state: "visible" });
    await page.locator("#authEmail").fill(email);
    phase = "wrong password";
    await page.locator("#authPassword").fill("Wrong-password-123!");
    await page.locator("#signInButton").click();
    await page.waitForFunction(() => document.querySelector("#authMessage").textContent.includes("incorrect"));
    phase = "sign back in";
    await page.locator("#authPassword").fill("WebKit-test-123!");
    await page.locator("#signInButton").click();
    await page.locator(".invoice-record").waitFor();
    assert.equal(await page.locator(".invoice-record").count(), 1);
    context.diagnostic(`Cancelled departing-document requests during reload: ${cancelledOnReload.length}`);
    assert.deepEqual(errors, []);
  });
}
