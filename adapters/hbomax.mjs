// UNVERIFIED. HBO Max has changed name, domain and platform several times, so
// both URLs here are starting guesses to be corrected from a probe. Note this
// account reaches HBO Max through a Disney+/Hulu bundle, which may route login
// through Disney rather than Max directly.
export default {
  id: 'hbomax',
  name: 'HBO Max',
  mode: 'per-device',
  loginUrl: 'https://www.max.com/login',
  devicesUrl: 'https://www.max.com/settings/devices',
  settleMs: 8000,
  readyRe: /manage devices|registered devices|sign out of all devices|your devices/i,
  signedOutRe: /sign in to your account|enter your email|create account/i,
  challengeRe: /verification code|enter the code|we sent a code|one-time/i,
  rowScopeRe: /^(?!.*current device).*(\btv\b|roku|chromecast|shield|fire ?tv|apple ?tv|smart|samsung|vizio|hisense|tcl|\blg\b|bravia|playstation|xbox|android tv|google tv)/i,
  rowSignOutPatterns: [/^(sign out|log out)$/i],
  confirmPatterns: [/^(sign out|log out|confirm|yes|continue)$/i],
};
