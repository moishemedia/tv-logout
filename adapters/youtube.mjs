// VERIFIED against the live page. Google deleted the old bulk "unlink all TVs"
// control, so per-device is the only option left.
export default {
  id: 'youtube',
  name: 'YouTube',
  mode: 'per-device',
  loginUrl: 'https://myaccount.google.com/device-activity',
  devicesUrl: 'https://myaccount.google.com/device-activity',
  readyRe: /your devices/i,
  signedOutRe: /sign in to continue|use your google account/i,
  challengeRe: /verifying it.s you|complete sign-in|confirm you.re you|passkey|enter your password/i,
  // The whole account lives on this page. Scoping to the TV label is what keeps
  // phones, tablets and laptops structurally out of reach.
  rowScopeRe: /youtube on tv/i,
  alreadyOutRe: /signed out/i,
  rowSignOutPatterns: [/^sign out$/i],
  confirmPatterns: [/^(sign out|confirm|ok|yes|remove)$/i],
};
