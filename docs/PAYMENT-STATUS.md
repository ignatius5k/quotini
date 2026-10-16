# Invoice payment status and remarks

## Product requirements

Let an account owner categorise saved invoices as unpaid, paid or refunded, attach evidence, and keep internal remarks. Existing invoices and duplicates default to unpaid. Payment details are edited from **Payment & remarks** in invoice history. Filters apply to all matching invoices, including records outside the current page, and work with customer/invoice search.

Paid and refunded require a readable screenshot and explicit confirmation that the user checked the recipient, amount and transaction details. This is manual verification, not bank reconciliation, OCR or independent fraud detection. Switching status clears the selected evidence; a refund requires its own screenshot. Returning to unpaid deletes current evidence. This first version retains the current evidence only, not an audit trail or partial payments/refunds.

Remarks are optional, limited to 2,000 characters, displayed as plain text, and excluded from printed/customer PDFs. They can be saved independently with unpaid status. Updates require connectivity and preserve entered values on failure. Concurrent edits are rejected; cancel and reopen to retrieve the latest saved details.

## Storage and privacy

Implemented in the Firebase checkout. Account owners alone can access their payment records and evidence. Payment details are separate from invoice content and PDF revisions, so normal invoice edits do not overwrite remarks or payment status. New copies get no payment details. Deleting an invoice also deletes its payment record and evidence.

Images accept JPEG, PNG and WebP up to 10 MiB. The browser decodes and converts them to JPEG, maximum 1,600 pixels on the longest edge and a 700,000-character encoded limit. Review the resulting preview for readability. Evidence is stored in a separate private Firestore document so status and evidence can be committed atomically; list reads fetch payment metadata only. Security rules require matching evidence in the same revision for paid/refunded status. They validate the encoding, not the truth of a transaction.

Account JSON backups include payment metadata and screenshots. Imports preserve conflicting existing payment records rather than overwriting them. Backups contain sensitive payment information. The device-local mode has no payment panel in this release.

## Acceptance checks

- Saving paid/refunded without evidence or manual confirmation fails.
- Remarks/status/evidence survive reload and are visible on another signed-in device.
- Other accounts cannot read or write the records.
- Stale edits cannot overwrite newer payment details.
- Status filters combine with existing search and pagination.
- Changing to unpaid removes evidence; deleting the invoice removes payment records.
- Existing invoice, PDF, draft and offline behavior remains compatible.

## Release

Build with `npm run build`, run `npm test` and the Firebase emulator suite. Deploy updated `firestore.rules` together with the Firebase application build; the existing deployed rules reject the new collections. No production deployment is performed by this change. The public local-only main branch is unchanged.
