# Quotini

Formerly Ledgerly. The app name is now Quotini; existing storage keys, Firebase project identifiers and deployment URLs are retained for compatibility.

Firebase prototype branch: start the seeded demo with `npm run prototype`. See [prototype launch and verification](docs/PROTOTYPE-LAUNCH.md) for sample accounts, test results, and release limitations.

An installable invoicing app for Eng Hoon Residences. Create, edit, duplicate, search, download, and print A4 invoices. Firebase Authentication provides Google sign-in, email/password accounts, and password resets; Cloud Firestore stores each account's invoice data, draft, and numbering separately; Cloud Storage stores private PDF files for saved invoice revisions.

## Run locally

```sh
npm ci
npm run build
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. Without Firebase configuration, the app retains its original device-local mode. Existing browser invoices can be imported after signing in when Firebase is configured.

## Connect Firebase

The selected project is **ledgerly-e0c95**. Put its public web SDK configuration in `firebase-config.local.json` (ignored by Git), or set `FIREBASE_WEB_CONFIG` to that JSON in the build environment, then rebuild. The build requires `apiKey`, `authDomain`, `projectId`, and `appId`; include `storageBucket` to enable PDF storage. Never supply service account credentials. See [setup and deployment](docs/DEPLOYMENT.md) for activation status and complete instructions.

The unconfigured `firebase-config.js` is an intentional local fallback. A configured Firebase connection that fails shows an error instead of silently saving account invoices locally.

## Verify

```sh
npm test
npm run test:firebase
npm run build
```

Firebase tests require Java 21+ and Chrome (`CHROME_PATH` can select the executable). They run only against the `demo-ledgerly` Authentication, Firestore, and Storage emulators, never production. Coverage includes real SDK sign-up, login, reset, account isolation, invoice CRUD, concurrent edits, numbering, imports, full five-line records, and the browser workflow with offline draft recovery. Google coverage uses the emulator's account chooser to check cancellation, blocked popups, local import, returning users, and preservation of an existing Gmail account's UID and invoices. Storage coverage uploads real PDF bytes, verifies authenticated downloads and cross-account denial, and checks immutable retries, stale revisions, invalid files, and deletion access. CI runs both suites.

## Saving and recovery

- **Save invoice** commits invoice data to Firestore, then generates and uploads its PDF to private Cloud Storage. The output dialog confirms PDF storage separately and offers **Retry PDF upload** if it fails. Local download and print remain available. Cloud Storage requires Firebase activation and the Blaze plan.
- Draft changes enter an IndexedDB outbox keyed by account ID before syncing. Conflicts ask which draft to keep; stale invoice edits are rejected.
- Signing in on another device loads saved invoices and the latest synced draft. **Refresh** reloads the list; **Download PDF** retrieves a stored copy without editing or creating another revision.
- **Continue with Google** opens an account chooser and signs up new users automatically. It uses the same invoice storage and device-import prompt as email sign-in. Enable the Google provider in Firebase before using it live; see the deployment guide.
- Offline editing preserves the open draft locally. Cloud history and invoice commits require a connection. Firestore caches are in memory; pending draft data remains in the browser until synced or explicitly discarded.
- **Download backup** exports invoice data, numbering, and the current draft as JSON; PDF files are not included. **Restore backup** imports without overwriting conflicting records.
- Signing out clears the visible workspace. A pending draft prompts whether to retain it locally for the next sign-in.

The original local keys (`invoice-studio-history-v1`, `invoice-studio-draft-v1`, `invoice-studio-guest-draft-revision-v1`, `invoice-studio-sequence-v1`) remain intact. See [operations](docs/OPERATIONS.md) for recovery and troubleshooting.
