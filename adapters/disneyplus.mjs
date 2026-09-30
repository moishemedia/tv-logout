// VERIFIED against the live page.
//
// Disney+ is the friendliest of the set: /identity/manage-devices lists every
// session with its own "Log Out", so per-device works and there is no need to
// touch the bulk control (which would sign this browser out too).
//
// Scope is TV-shaped hardware only. Disney lists phones and browsers here as
// well, and signing out a phone is not what this tool is for. Anything you do
// want spared regardless can go in the keep list.
export default {
  id: 'disneyplus',
  name: 'Disney+',
  mode: 'per-device',
  loginUrl: 'https://www.disneyplus.com/login',
  devicesUrl: 'https://www.disneyplus.com/identity/manage-devices',
  settleMs: 9000,
  readyRe: /manage devices/i,
  signedOutRe: /enter your email to continue|log in to disney/i,
  challengeRe: /one-time passcode|verification code|enter the code|we sent a code/i,
  // Never the row we are browsing from: logging it out destroys the session.
  rowScopeRe: /^(?!.*current device).*(\btv\b|roku|chromecast|shield|fire ?tv|apple ?tv|smart|samsung|vizio|hisense|tcl|\blg\b|bravia|playstation|xbox|android tv|google tv)/i,
  rowSignOutPatterns: [/^log out$/i],
  confirmPatterns: [/^(log out|sign out|confirm|yes|continue)$/i],
};
