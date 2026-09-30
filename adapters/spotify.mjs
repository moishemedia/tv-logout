// UNVERIFIED - Spotify's control is a single "Sign out everywhere" on the
// account overview page. Simplest of the set, and the least likely to break.
export default {
  id: 'spotify',
  name: 'Spotify',
  mode: 'bulk',
  loginUrl: 'https://accounts.spotify.com/login',
  devicesUrl: 'https://www.spotify.com/account/overview/',
  settleMs: 6000,
  readyRe: /sign out everywhere|account overview|your plan/i,
  signedOutRe: /log in to spotify|email address or username/i,
  challengeRe: /verify|verification code/i,
  bulkPatterns: [/sign out everywhere/i],
  confirmPatterns: [/^(sign out everywhere|sign out|confirm|yes)$/i],
};
