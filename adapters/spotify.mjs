// Spotify localises by IP (it served Spanish from this connection), so the
// browser locale is pinned to en-US in core/browser.mjs. Spanish equivalents
// are kept as a fallback in case a region override slips through.
export default {
  id: 'spotify',
  name: 'Spotify',
  mode: 'bulk',
  loginUrl: 'https://accounts.spotify.com/login',
  devicesUrl: 'https://www.spotify.com/account/overview/',
  settleMs: 7000,
  readyRe: /sign out everywhere|account overview|cierra sesi.n en todas partes|resumen de la cuenta/i,
  signedOutRe: /log in to spotify|inicia sesi.n en spotify/i,
  challengeRe: /verification code|c.digo de verificaci.n/i,
  bulkPatterns: [/sign out everywhere/i, /cierra sesi.n en todas partes/i],
  confirmPatterns: [/^(sign out everywhere|sign out|confirm|yes|cerrar sesi.n|confirmar|s.)$/i],
};
