# Deployment

Ledgerly remains a static PWA. Firebase's browser SDK is bundled locally during the build. Safari and iOS use Google Identity Services to obtain credentials directly, without Firebase's cross-site login helper. No application server is required. Publish the generated `dist/` directory on a stable HTTPS origin.

## Activation status

Verified on 17 September 2026: **Ledgerly / ledgerly-e0c95** has a configured web app, both Email/Password and Google providers enabled, and both an email/password test account and the project account signed in through Google appear in Authentication after live app sign-in. The default Standard Firestore database is in `asia-southeast1` (Singapore). The owner activated Blaze (Free Trial), and the default Storage bucket `ledgerly-e0c95.firebasestorage.app` is in `US-EAST1`.

Private Firestore/Storage rules and invoice index exemptions are deployed. Storage's permission to check Firestore and the bucket GET CORS configuration are active. A real test invoice and its 183,098-byte PDF were saved through the app, then retrieved from history after sign-out/sign-in. The downloaded PDF matched the cloud object's size and checksum. See [verification evidence](FIREBASE-VERIFICATION.md). That initial cloud verification used the local production-configured build at `http://localhost:55334/`. GitHub Pages deployment is described below.

## GitHub Pages

The public app is at `https://ignatius5k.github.io/quotini/`. Pages must use **GitHub Actions** as its publishing source. Publishing the repository root directly serves the unconfigured development files and omits the generated Firebase SDK, leaving the app in device-only mode.

The `Verify` workflow runs the application and Firebase tests, audit, and build checks. For `main`, it then rebuilds `dist/` using the **FIREBASE_WEB_CONFIG** repository secret, verifies that the Firebase configuration (including `storageBucket`) and bundled SDK are present, and publishes the artifact through the `github-pages` environment. Missing configuration fails the deployment rather than publishing a device-only app. Pull requests and `staging` do not deploy.

Live Pages verification on 18 September 2026 confirmed email registration, Google sign-in, private invoice history, and identical immediate/stored PDF downloads after sign-out and sign-in. See [verification evidence](FIREBASE-VERIFICATION.md).

Set the repository secret to the Firebase public web configuration JSON described below. Never put service account credentials in that secret. The Firebase authorized-domain list and bucket CORS configuration must include `ignatius5k.github.io`. The app uses relative asset paths so it works under `/quotini/`. Existing visitors can select **Update ready** after the new service worker arrives; device invoices remain available for the explicit account-import flow.

## Setup

1. Authenticate with `npx firebase login`. Verify the project with `npx firebase projects:list`; `.firebaserc` selects `ledgerly-e0c95`.
2. Register a **web app** in the Firebase project and copy its SDK configuration from Project settings → Your apps.
3. Enable **Authentication → Sign-in method → Email/Password** and **Google**. For Google, select the project's support email and save. Add the deployed hostname under **Authentication → Settings → Authorized domains**. Add `localhost` when testing the live project locally. Keep the default **one account per email address** setting so supported provider linking keeps the existing Firebase UID and its invoices.
4. Create the default Cloud Firestore database in **production mode**, using **Standard edition**. Choose `asia-southeast1` (Singapore) for the expected audience. Location is a creation-time choice.
5. Deploy the included rules and indexes before enabling the app for users:

   ```sh
   npx firebase deploy --only firestore:rules,firestore:indexes --project ledgerly-e0c95
   ```

6. Create `firebase-config.local.json` with the actual public web app configuration:

   ```json
   {
     "apiKey": "COPY_FROM_FIREBASE",
     "authDomain": "ledgerly-e0c95.firebaseapp.com",
     "projectId": "ledgerly-e0c95",
     "appId": "COPY_FROM_FIREBASE",
     "storageBucket": "ledgerly-e0c95.firebasestorage.app"
   }
   ```

   Alternatively, set **FIREBASE_WEB_CONFIG** to this JSON in the build environment. It takes precedence over the local file. The build copies only allowed web config fields; never provide service account keys or access tokens.

7. Complete the Cloud Storage setup below, then build and publish:

   ```sh
   npm ci
   npm test
   npm run test:firebase
   npm run build
   npx firebase deploy --only hosting --project ledgerly-e0c95
   ```

Firebase Hosting applies `firebase.json` headers. Netlify and compatible hosts use `dist/_headers`; reproduce them on other hosts. Existing Netlify builds can use `FIREBASE_WEB_CONFIG` without switching hosts. Password resets use Firebase's hosted handler by default. A custom action URL can point to Ledgerly, which also supports `mode=resetPassword&oobCode=…` links.

## Google sign-in

The **Continue with Google** button uses Google Identity Services on Safari/iOS, requesting only `openid email profile`. The returned access token is passed directly to Firebase's `signInWithCredential` and is never stored by application code. Other browsers and emulator tests retain Firebase's popup flow. Both paths use the same Firebase UID, workspace loader, local invoice import, and ownership rules. Safari's direct flow does not initialize Firebase's popup resolver. Firestore uses long polling on WebKit; foreground session recovery cannot discard an active editor or replace newer auth events.

For Safari/iOS, add each deployed **origin** to the Google OAuth web client's **Authorized JavaScript origins** in Google Cloud Console, separately from Firebase's authorized domains. `https://ignatius5k.github.io` is configured for Ledgerly. When using a different Firebase project, include that project's public OAuth web client ID as `googleClientId` in `FIREBASE_WEB_CONFIG`; never put a client secret in the web config. Google configuration changes may require propagation time. The CSP permits the Google Identity Services script, iframe, styles, and connections.

Use the default `ledgerly-e0c95.firebaseapp.com` auth domain from the web configuration. The HTML, Netlify header template, and Firebase Hosting configuration also permit Google's `apis.google.com` popup script and Firebase's helper iframe for the other browsers. `Cross-Origin-Opener-Policy: same-origin-allow-popups` preserves communication with the sign-in window. If using a custom auth domain, add its HTTPS origin to `frame-src` in all three policies and configure it according to [Firebase's Google sign-in guide](https://firebase.google.com/docs/auth/web/google-signin#customizing-the-redirect-domain-for-google-sign-in).

Cancellation and popup blocking return to the login form without importing or removing device invoices. Browsers that block popups must allow them for Ledgerly. An account collision is shown with instructions to use the existing sign-in method; the app does not merge invoice data by matching email strings. Live Google consent and provider configuration must be verified after activation; emulator tests use Firebase's simulated Google account chooser.

## PDF file storage

[Cloud Storage requires the Blaze plan](https://firebase.google.com/docs/storage/web/start). The project owner must activate billing in the Firebase console, then open Storage and create the default bucket with private rules. Copy the actual bucket name into `storageBucket`; a name in web configuration alone does not create the bucket.

Deploy the tested rules after the bucket exists:

```sh
npx firebase deploy --only storage --project ledgerly-e0c95
```

The rules consult the matching Firestore invoice/revision. The first deployment may prompt to [enable Storage's permission to read Firestore for rule evaluation](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_cloud_firestore). Approve that specific service permission in the project. Do not use public/test rules.

Authenticated browser PDF downloads also require [bucket CORS configuration](https://firebase.google.com/docs/storage/web/download-files#cors_configuration). Review `storage.cors.json` to include the actual deployed origin, then apply it to the actual bucket with an authorized Google Cloud CLI:

```sh
gcloud storage buckets update gs://ledgerly-e0c95.firebasestorage.app --cors-file=storage.cors.json
```

The included origins cover this project's Firebase hosts, GitHub Pages hostname, and the documented local previews. CORS permits browser downloads; it does not grant access to a file. Storage rules still require the owning Firebase UID. The app uses authenticated `getBlob`, never a public download URL.

PDFs are at `users/{uid}/invoices/{invoiceId}/revisions/{revision}.pdf`. Uploads require the current committed invoice revision, PDF content type, and a file no larger than 10 MiB. Existing revision files cannot be overwritten. Retries reuse an existing matching file; an invoice fingerprint prevents reusing a PDF from a deleted/recreated record with different contents. When a file is reused, the app retrieves it for immediate download and printing so those bytes match history downloads, including PDF metadata. The output dialog reports invoice-data success separately from PDF-upload success.

Run all three emulators in one CLI process: cross-service Storage rules cannot find Firestore in a separate emulator process. `npm run test:firebase` does this automatically.

## Data model

| Path | Purpose |
| --- | --- |
| `users/{uid}/invoices/{invoiceId}` | Invoice fields, server update timestamp, revision |
| `users/{uid}/drafts/current` | Draft/deletion tombstone, revision, timestamp |
| `users/{uid}/sequences/{YYYYMMDD}` | Highest reserved or saved daily number |

Rules require the authenticated UID to match the path, validate structure and item limits, and enforce increasing revisions. All other paths are denied. There is no shared workspace or public invoice endpoint.

Normal history loading uses server pagination and a count. Substring search scans only the signed-in user's invoices because Firestore has no native substring index; add a dedicated search index before serving very large accounts. Invoice payload maps are exempted from indexing in `firestore.indexes.json`.

Automatic numbers use transactions; manual numbers and intentional duplicate invoices remain supported. Authentication persists the session, Firestore uses a memory cache, and offline drafts use an account-keyed IndexedDB outbox with a synchronous recovery journal. The journal preserves the latest edit if a refresh interrupts the queued write; it is removed after the matching operation is acknowledged.

## Release and rollback

Keep `index.html`, `firebase-config.js`, and `sw.js` revalidating. CSP permits the required Firebase Auth/Firestore/Storage endpoints. Localhost emulator endpoints are test-server-only. The service worker caches the app shell and SDK bundle, never API responses or password reset query URLs.

After live activation, verify login and an invoice save from a second browser. A static rollback does not delete Firestore data. A local-only build cannot display cloud invoices; communicate that before rolling back. Never clear browser data as part of deployment.
