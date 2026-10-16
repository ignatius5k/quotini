# Operations

## Accounts and backups

Each Firebase Authentication account owns a separate Firestore workspace. Sign in with the same email/password on another device to retrieve committed invoices and synced drafts. **Refresh** retrieves changes made elsewhere. An edited invoice retains its original revision; concurrent changes cause save to be rejected while the current edits remain available for recovery.

Download backups regularly and retain important PDFs. JSON backups contain customer and invoice data, but do not include Cloud Storage PDF files or other attachments. Account restore imports matching/new records, preserves numbering, and stops at conflicts without overwriting them. If an import partly succeeds, retrying skips identical records. A conflicting account draft is retained, and the source backup/local copy is preserved.

Invoice deletion applies to the account on every device and requires confirmation in the app. The numbering counter remains. Stored PDFs become inaccessible while their Firestore invoice is absent; PDF objects are retained for separate administrative cleanup and may continue using storage. Deleting a Firebase Authentication user does not automatically delete their Firestore subcollections; any administrative removal workflow must explicitly handle that data and the user’s Cloud Storage objects.

## Stored PDFs

**Save invoice** first commits invoice details, then generates and uploads a PDF for that revision. Wait for **PDF saved to your account** before relying on the cloud copy. If upload fails, the invoice data remains saved; the output dialog offers **Retry PDF upload**, download, and print. A download alone does not prove a cloud upload succeeded.

The history **Download PDF** action fetches the stored current revision using the signed-in account. Old/imported invoices and JSON backup restores do not automatically include PDF files. Open and save those invoices to generate a stored PDF. Saving another revision retains previous PDF objects; the app exposes the current revision only.

Invoice PDFs are immutable per revision. If an ID is restored with different invoice data and conflicts with a retained PDF, save it again to create a new revision. Back up the bucket separately if historic PDFs must be retained, and define an administrative retention/cleanup policy.

## Drafts and shared devices

Drafts enter an IndexedDB outbox scoped by Firebase UID. **Synced** means the cloud write completed; **Waiting to sync** means the draft is still local. A pending draft cannot appear on another device until it syncs. Clearing site data, private browsing, or removing the browser profile can destroy an unsynced draft.

Firestore invoices are cached in memory. Sign-out/account changes clear visible data, and late responses from the old session are ignored. Unsynced drafts intentionally survive sign-out for the same account's next login. Use separate OS/browser profiles for stronger local privacy on shared devices. Firebase handles passwords; invoice records and backups never contain them.

Offline reload cannot retrieve cloud history. Reconnect and choose **Try again**, keeping the same account. An open editor can save draft edits locally and retry when connectivity returns. Sign-out with pending work asks whether to retain the draft locally.

## Existing browser invoices

On cloud login, choose whether to import local invoices and their draft into the displayed account, export a backup, leave them on the device, or discard them. Imports never silently select an account or overwrite a different record with the same ID. Unreadable/duplicate local records disable automatic import so the source can be recovered first.

Without Firebase configuration, the app is device-local. A different hostname, protocol, device, or browser profile has a different store. The original storage recovery screen and local backup restore remain available.

## Troubleshooting

- **Email sign-in not enabled:** enable Email/Password in the intended Firebase project.
- **PDF storage unavailable:** confirm Blaze billing, an existing bucket, matching `storageBucket`, deployed `storage.rules`, the Storage-to-Firestore rule permission, and bucket CORS. An upload failure does not undo a successful invoice-data save.
- **Permission denied:** check the configured project and deployment of `firestore.rules` to its default database. Do not switch to public/test rules.
- **Invoice changed elsewhere:** refresh and compare the newer invoice before reapplying edits. Draft base revisions survive reloads.
- **Draft conflict:** inspect both summaries and choose the version to keep.
- **Password reset:** use the newest email. Expired/used links require a new request.
- **Unchanged app shell:** reload online and use **Update ready**. Cache activation removes old shell caches, not invoice data.

Run `npm test` and `npm run test:firebase` after changes to authentication, storage, migrations, rules, or the app shell. Firebase tests use demo emulators and disposable test accounts only.
