// PARTIALLY VERIFIED - not safe to enable yet.
//
// Real device page: netflix.com/manageaccountaccess (reached via Security ->
// "Access and devices"). Netflix remembers a verified browser, so the emailed
// code is occasional rather than per-run.
//
// The blocker: the only control Netflix renders is "Sign Out of All Devices",
// which signs out THIS browser too - destroying the session the tool depends
// on and forcing a fresh login plus a new code on every single run. Bulk mode
// is therefore self-defeating here.
//
// Per-device rows could not be confirmed: the account had no other devices
// signed in at probe time, so no per-row controls were rendered. Re-probe once
// a TV is actually signed in, then set mode to 'per-device' with the current
// browser excluded.
export default {
  id: 'netflix',
  name: 'Netflix',
  mode: 'per-device',
  loginUrl: 'https://www.netflix.com/login',
  devicesUrl: 'https://www.netflix.com/manageaccountaccess',
  settleMs: 12000,
  readyRe: /manage access and devices/i,
  signedOutRe: /sign in|enter your email/i,
  challengeRe: /make sure it.s you|email a code|text a code|verification code|enter the code/i,
  // Never touch the row representing our own browser: signing it out breaks
  // the stored session and triggers a new emailed code.
  rowScopeRe: /^(?!.*CURRENT DEVICE).*(tv|roku|chromecast|shield|fire|apple tv|smart|playstation|xbox)/i,
  rowSignOutPatterns: [/^sign out$/i],
  confirmPatterns: [/^(sign out|confirm|yes|continue)$/i],
};
