// Alerting and liveness. All optional: with nothing configured the tool still
// works, it just stays quiet. Secrets are read from the macOS keychain first,
// falling back to a gitignored secrets.json for hosts whose login keychain is
// locked to SSH sessions (the Mac Mini).

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './browser.mjs';
import { log, LOG } from './engine.mjs';

const SECRETS = join(ROOT, 'secrets.json');
const STATE = join(ROOT, 'state.json');
const PENDING = join(ROOT, 'pending-alert.json');

// Accepts several keychain service names so an existing install's items keep
// working after a rename, without anyone having to re-enter a secret.
export function secret(name, services) {
  for (const svc of [].concat(services)) {
    try {
      const v = execFileSync('/usr/bin/security',
        ['find-generic-password', '-s', svc, '-w']).toString().trim();
      if (v) return v;
    } catch { /* try the next name */ }
  }
  try {
    return JSON.parse(readFileSync(SECRETS, 'utf8'))[name] || null;
  } catch { return null; }
}

// AppleScript string literals have no escape sequences, so scrub rather than escape.
function asLiteral(s) {
  const flat = String(s).replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '').replace(/"/g, "'").slice(0, 200).trim();
  return `"${flat}"`;
}

export function notify(title, body) {
  if (process.platform !== 'darwin') return;
  try {
    execFileSync('/usr/bin/osascript',
      ['-e', `display notification ${asLiteral(body)} with title ${asLiteral(title)}`]);
  } catch { /* best effort */ }
}

export function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; }
}
export function writeState(s) {
  try { writeFileSync(STATE, JSON.stringify(s)); } catch { /* best effort */ }
}
export function recordSuccess() {
  writeState({ ...readState(), lastSuccess: new Date().toISOString() });
}

// A machine with no network cannot send its own failure alert, which is exactly
// when you most want one. Park it and deliver on the next run that has network.
function parkAlert(reason) {
  try {
    writeFileSync(PENDING, JSON.stringify({ reason, at: new Date().toISOString() }));
    log('alert parked for the next run with a network');
  } catch { /* best effort */ }
}

export async function emailFailure(cfg, reason, isFlush = false) {
  if (!cfg.alertEmail) return false;
  const key = secret('resendApiKey', ['tv-logout-resend', 'yt-tv-signout-resend']);
  if (!key) { log('no Resend key available - skipping failure email'); return false; }
  let tail = '';
  try { tail = readFileSync(LOG, 'utf8').trim().split('\n').slice(-25).join('\n'); } catch {}
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'tv-logout <onboarding@resend.dev>',
        to: [cfg.alertEmail],
        subject: `tv-logout failed: ${reason}`,
        text: `The scheduled tv-logout run did not complete.\n\nReason: ${reason}\n\nTo fix it now:\n  cd ${ROOT} && npm run evict\n\nRecent log:\n${tail}\n`,
      }),
    });
    if (!res.ok && !isFlush) parkAlert(reason);
    log(res.ok ? `failure email sent to ${cfg.alertEmail}` : `Resend error ${res.status}`);
    return res.ok;
  } catch (e) {
    log(`failure email could not be sent: ${e.message}`);
    if (!isFlush) parkAlert(reason);
    return false;
  }
}

export async function flushParkedAlert(cfg) {
  if (!existsSync(PENDING)) return;
  let parked;
  try { parked = JSON.parse(readFileSync(PENDING, 'utf8')); }
  catch { rmSync(PENDING, { force: true }); return; }
  if (await emailFailure(cfg, `${parked.reason} (delayed alert from ${parked.at})`, true)) {
    rmSync(PENDING, { force: true });
  }
}

// Check in with the off-machine dead-man's switch. A local watchdog cannot
// report a Mac that is simply off; this is the only signal that covers it.
// Never fatal - a missed ping is the switch's problem to notice.
export async function pingDeadman(cfg) {
  if (!cfg.deadmanUrl) return;
  const token = secret('deadmanToken', ['tv-deadman-token']);
  if (!token) { log('no dead-man token available - skipping ping'); return; }
  try {
    const res = await fetch(`${cfg.deadmanUrl.replace(/\/$/, '')}/ping`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    log(res.ok ? 'dead-man switch pinged' : `dead-man ping rejected: ${res.status}`);
  } catch (e) { log(`dead-man ping failed: ${e.message}`); }
}
