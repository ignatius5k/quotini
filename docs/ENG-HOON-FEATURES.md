# Eng Hoon feature checklist

Implemented on the Firebase prototype branch, 14 October 2026. These changes run in the local demo; production deployment is separate.

## Invoice creation

- New invoices start with the current device-local date and a due date two calendar days later. Existing invoices/drafts retain their dates.
- Bill to has a company/name field and an optional Instagram username. The rendered invoice uses `COMPANY NAME (@handle)`. Existing Bill to text is preserved without guessing a handle.
- Expand **Invoice appearance → Logo & terms** to upload a PNG, JPEG or WebP logo (up to 10 MB). It is resized and saved with that invoice, including its draft, duplicate, JSON backup and PDF. **Use default logo** restores the Eng Hoon logo. New invoices retain the original logo by default.
- Edit terms in the same section (up to 1,000 characters), or restore the original two paragraphs. Terms are saved per invoice. The existing one-page overflow check prevents exporting content that exceeds the A4 template.

## Organisation

Accounts receive **Eng Hoon Residences → Weekend Market / Events** folders. **New event / market** creates a date folder under the selected category and a **Furniture rental** subgroup inside it. Repeating the same category/date reuses the existing folders. General folder/subfolder creation and invoice movement remain available. New invoices created inside a folder are saved there atomically.

## Files and payments

**More → Files & uploads** supports multiple private invoice attachments, up to 20 MB per file. Files can be listed, downloaded and removed. Downloads require the owner account and an existing parent invoice. Uploads are stored as binary downloads, not rendered as active HTML. Removing an invoice revokes access to its retained attachments; storage cleanup is separate.

JSON backups contain invoice data, logo, terms, customer details, payment evidence and folder structure. Cloud Storage attachments and PDFs are not embedded in JSON backups; download important files separately.

Payment status (unpaid/paid/refunded), screenshot evidence and internal remarks remain available under **More → Payment & remarks**. Verification is a manual check by the user, not bank reconciliation.

## Verification

24 application/infrastructure checks passed. The 30 Firebase/browser/storage checks passed across the full suite and the targeted rerun after fixing embedded-logo PDF generation. Coverage includes two-day defaults, current dates, combined customer display, logo and terms reload persistence, reset defaults, actual PDF creation/storage, dated folder creation, file upload/download, account isolation, attachment deletion and access revocation, backups, five-line invoices, and desktop/mobile layouts.
