# Business profiles

Use the sidebar's Business profile selector to switch without signing out. Add profile creates a separate workspace. The dedicated Settings page in the sidebar edits the current profile's name, default logo and terms, using the shared app navigation and form styles. Logo uploads require 600 × 530 pixels. Template changes affect newly created invoices; saved invoices and existing drafts keep their own values.

Existing data remains in My business (the default profile) at its original database paths. Additional profiles store invoices, drafts, numbering sequences, folders, payment evidence, PDFs and attachments beneath users/{uid}/profiles/{profileId}. Profile metadata is stored on the profile document. Firestore and Storage rules apply the same owner checks and data validation as the original workspace. Profiles are organizational boundaries within one authenticated account, not separate user permissions.

Switching saves the current draft locally and attempts sync, selects the destination for this browser tab and reloads the workspace while retaining Firebase authentication. Outbox keys include the profile identity. Other tabs keep their selected profile. Switching requires an online profile lookup; offline drafts remain available when returning to their profile. Profile deletion is not supported.

Backups export the current profile's data and template settings. Restore imports into the currently selected profile, including its default template settings when present. Legacy backups without profile metadata remain supported.

This release supports profile-specific logo and terms defaults. Invoice layout, currency and the existing issuer/contact/payment text remain shared template settings; fully configurable issuer details are a separate follow-up.
