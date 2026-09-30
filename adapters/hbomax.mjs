// UNSUPPORTED - kept for the record rather than as a working adapter.
//
// Findings from probing a live signed-in session (Sept 2026, Peru):
//   - max.com returns an Akamai "Access Denied" for every path: the US domain
//     is geo-blocked. The working domain is play.hbomax.com.
//   - play.hbomax.com/settings loads and the session is valid, but it exposes
//     only Playback, Subtitle Style, marketing preferences and Parent Code.
//     There is NO device management section.
//   - /settings/devices and /profile both redirect to /error.
//
// So there is no web surface to automate. This account reaches HBO Max through
// a Disney+/Hulu bundle, so device control may live on Disney's side or be
// app-only. Re-check from a US connection before concluding it is impossible
// everywhere; the geo-block may be hiding a fuller site.
export default {
  id: 'hbomax',
  name: 'HBO Max',
  unsupported: 'no device management surface on the web in this region',
  mode: 'per-device',
  loginUrl: 'https://play.hbomax.com',
  devicesUrl: 'https://play.hbomax.com/settings',
  settleMs: 9000,
  readyRe: /manage devices|registered devices|your devices/i,
  signedOutRe: /sign in to your account|enter your email/i,
  challengeRe: /verification code|enter the code|one-time/i,
  rowScopeRe: /^(?!.*current device).*(\btv\b|roku|chromecast|shield|fire ?tv|apple ?tv|smart)/i,
  rowSignOutPatterns: [/^(sign out|log out)$/i],
  confirmPatterns: [/^(sign out|log out|confirm|yes|continue)$/i],
};
