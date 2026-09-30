// UNVERIFIED - Disney+ keeps device controls under account settings and has
// historically offered a log-out-everywhere action.
export default {
  id: 'disneyplus',
  name: 'Disney+',
  mode: 'bulk',
  loginUrl: 'https://www.disneyplus.com/login',
  devicesUrl: 'https://www.disneyplus.com/account/devices',
  settleMs: 7000,
  readyRe: /device|log out of all/i,
  signedOutRe: /log in|enter your email/i,
  challengeRe: /verify|one-time passcode|verification code/i,
  bulkPatterns: [/log out of all devices/i, /sign out of all devices/i, /log out all devices/i],
  confirmPatterns: [/^(log out|sign out|confirm|yes|continue)$/i],
};
