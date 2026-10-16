# Invoice folders

Folder creation is business-neutral: users choose every folder name and hierarchy. The app no longer seeds Eng Hoon folders or offers the event/market shortcut. Existing folders remain intact.

The Firebase prototype supports Drive-style folders and nested subfolders. Choose **New folder** at the top of invoice history. Open a folder and use **New folder** again to create a subfolder. Breadcrumbs return to a parent or **All invoices**.

**All invoices** shows the entire account; **Unfiled** shows invoices without a folder. Individual folders show only their own invoices, with search and payment filtering applied before pagination. Use an invoice's **More → Move to folder** action to select a destination, including Unfiled. New invoices saved while browsing a folder are filed there atomically with the invoice save.

Folders and invoice placements are separate, account-private Firestore collections. Moving an invoice preserves its data, revision, payment evidence, and stored PDF. Concurrent moves from a stale location are rejected. Deleting an invoice also deletes its folder placement. Existing invoices remain unfiled until moved.

Account JSON backups include the folder hierarchy and invoice locations. Restore reconstructs parents before children and rejects conflicting existing locations. Folder parent links are immutable; folder renaming, deletion, and drag-and-drop are not part of this version.

The invoice list uses a compact Edit / More action group. Download PDF, payment details, moving, duplication, and deletion are in More. Payment evidence fields appear for paid/refunded status only; an existing-evidence removal notice appears when changing to unpaid. Existing evidence and confirmation validation remain enforced by the backend and rules.

Verification includes account isolation, nested creation, pagination within a folder, concurrent moves, creating an invoice in a folder, backup restore, invoice deletion cleanup, and desktop/mobile browser navigation and reload persistence.
