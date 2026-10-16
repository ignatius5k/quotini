const authError = (code, message) => Object.assign(new Error(message), { code: `auth/${code}` });

// Google returns the credential directly to this page. No Firebase hosted
// helper sessionStorage is involved in the Google round trip.
export function createGoogleTokenSignIn(environment, clientId) {
  const script = environment.document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  let failed = false;
  script.onerror = () => { failed = true; };
  environment.document.head.appendChild(script);
  let pending = false;
  return function signIn() {
    const oauth = environment.google?.accounts?.oauth2;
    if (!oauth) return Promise.reject(authError("google-loading", failed
      ? "Google sign-in could not load. Check your connection and reload the page."
      : "Google sign-in is loading. Please tap Continue with Google again in a moment."));
    if (pending) return Promise.reject(authError("cancelled-popup-request", "A Google sign-in is already open."));
    pending = true;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, token) => {
        if (finished) return;
        finished = true;
        pending = false;
        environment.clearTimeout(timer);
        error ? reject(error) : resolve(token);
      };
      // Allow time to complete Google's phone verification. A timeout is not
      // a user cancellation, and must be reported as a retryable failure.
      const timer = environment.setTimeout(() => finish(authError("timeout", "Google sign-in timed out. Return to Quotini and try again.")), 300000);
      try {
        const client = oauth.initTokenClient({
          client_id: clientId,
          scope: "openid email profile",
          include_granted_scopes: false,
          callback: (response) => {
            if (response?.error || typeof response?.access_token !== "string" || !response.access_token) {
              finish(authError(response?.error === "access_denied" ? "popup-closed-by-user" : "invalid-credential", "Google sign-in was not completed."));
            } else finish(null, response.access_token);
          },
          error_callback: (error) => finish(authError(error.type === "popup_failed_to_open" ? "popup-blocked" : "popup-closed-by-user", "Google sign-in was not completed.")),
        });
        // Keep this synchronous with the user's tap for Safari popup permission.
        client.requestAccessToken({ prompt: "select_account" });
      } catch (error) { finish(error); }
    });
  };
}
