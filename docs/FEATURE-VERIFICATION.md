# Feature verification — 16 October 2026

Verified the local Firebase prototype against isolated Authentication, Firestore, and Storage emulators. The running demo and production data were not used as test fixtures.

Release verification: all 59 tests passed (24 application/infrastructure and 35 Firebase/browser/storage tests), with no skips. The build, vendored-bundle verification, whitespace checks and production dependency audit passed. Coverage includes Chrome desktop/mobile and WebKit desktop/iPhone. Tests now wait for complete backup downloads and open the invoice action menu before downloads. Profile coverage includes database/storage isolation, independent draft restoration, template settings persistence, and settings changes preserving existing drafts.

The PDF browser bundle is rebuilt reproducibly from locked dependencies using esbuild instead of copying the upstream prebuilt bundle, which embedded an older sanitizer. DOMPurify 3.4.17 and gRPC 1.14.6 are pinned through dependency overrides. The production dependency audit reports zero vulnerabilities.

Covered workflows:
- Desktop/mobile create, edit, duplicate, search, delete, PDF download and print flow.
- Account signup/signin/signout, password reset, reload and new-device persistence; simulated Google popup success/cancellation.
- Offline draft recovery, overlapping sync, stale-write rejection, atomic invoice numbering.
- Paid/unpaid/refunded payment data, screenshot evidence, remarks, filtering and reload persistence.
- Generic folder creation, nested folders, moving invoices, folder filtering and backup restoration. New accounts start without seeded business folders.
- Private file upload, listing, download, deletion and access revocation after invoice deletion.
- Logo upload, rejection of wrong dimensions without replacing the accepted logo, terms, Instagram formatting, today/+2 day defaults and PDF generation.
- Account isolation and denial of anonymous/cross-account database and storage operations.
- Exact PDF byte storage, retry and immutable revision behavior.

Limitations: this verifies local emulator integration, not deployed Firebase configuration, live Google OAuth, real email delivery, physical printing, or every browser/PWA installation environment. Existing invoice template defaults remain business-specific. Folder rename/delete/drag-and-drop are not implemented. Logo dimensions are enforced by the app upload workflow; Firestore validates stored image data rather than decoding its dimensions.
