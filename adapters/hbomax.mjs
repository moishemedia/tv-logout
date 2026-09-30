// UNVERIFIED - HBO Max has been rebranded and re-platformed repeatedly, so both
// the URL and the control text are likely to need correcting after a probe.
export default {
  id: 'hbomax',
  name: 'HBO Max',
  mode: 'bulk',
  loginUrl: 'https://auth.max.com/login',
  devicesUrl: 'https://auth.max.com/settings/devices',
  settleMs: 7000,
  readyRe: /device|sign out of all/i,
  signedOutRe: /sign in|email address/i,
  challengeRe: /verify|verification code/i,
  bulkPatterns: [/sign out of all devices/i, /sign out all devices/i, /log out of all/i],
  confirmPatterns: [/^(sign out|log out|confirm|yes|continue)$/i],
};
