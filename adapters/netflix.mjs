// UNVERIFIED - selectors are a best guess until `npm run probe netflix` is run
// against a signed-in session. Netflix exposes a bulk control, which is far
// more robust than row matching, at the cost of signing out your own TVs too.
export default {
  id: 'netflix',
  name: 'Netflix',
  mode: 'bulk',
  loginUrl: 'https://www.netflix.com/login',
  devicesUrl: 'https://www.netflix.com/account/security',
  settleMs: 6000,
  readyRe: /sign out of all devices|device|access and devices|security/i,
  signedOutRe: /sign in|enter your email/i,
  challengeRe: /verify|verification code|confirm it.s you/i,
  bulkPatterns: [/sign out of all devices/i, /sign out all devices/i],
  confirmPatterns: [/^(sign out|confirm|yes|continue)$/i],
};
