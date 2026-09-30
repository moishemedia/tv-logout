#!/usr/bin/env node
// tv-logout - signs stray "YouTube on TV" sessions out of your Google Account.
//
// Everything runs on your own machine against your own browser profile. No
// credentials, cookies or session data ever leave this computer.
//
// Google deliberately offers no API for device sessions, so the only route is
// driving a real signed-in browser. Google also refuses sign-in inside an
// automated browser, so `setup` establishes the session by hand and this
// reuses it.

import { chromium } from 'playwright';
import {
  readFileSync, mkdirSync, appendFileSync, rmSync,
  statSync, renameSync, readdirSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const PROFILE = join(ROOT, 'profile');
export const SHOTS = join(ROOT, 'shots');
export const LOG = join(ROOT, 'run.log');
export const CONFIG = join(ROOT, 'config.json');

const DEVICE_LIST_URL = 'https://myaccount.google.com/device-activity';
const ACCOUNT_URL = 'https://www.youtube.com/account';
const MAX_SIGNOUTS = 25;      // stops a runaway loop from emptying an account
const LOG_MAX_BYTES = 1 << 20; // 1 MB
const LOG_KEEP = 3;
const SHOTS_KEEP = 24;

export function loadConfig() {
  if (!existsSync(CONFIG)) {
    console.error('No config.json found. Run:  npm run setup');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

export function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* non-fatal */ }
}

// AppleScript string literals have no escape sequences, so newlines and quotes
// must be scrubbed rather than escaped.
function asLiteral(s) {
  const flat = String(s)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '')
    .replace(/"/g, "'")
    .slice(0, 200)
    .trim();
  return `"${flat}"`;
}

export function notify(title, body) {
  if (process.platform !== 'darwin') return;
  try {
    execFileSync('/usr/bin/osascript', [
      '-e', `display notification ${asLiteral(body)} with title ${asLiteral(title)}`,
    ]);
  } catch { /* best effort */ }
}

function rotateLog() {
  try { if (statSync(LOG).size < LOG_MAX_BYTES) return; } catch { return; }
  try {
    rmSync(`${LOG}.${LOG_KEEP}`, { force: true });
    for (let n = LOG_KEEP - 1; n >= 1; n--) {
      try { renameSync(`${LOG}.${n}`, `${LOG}.${n + 1}`); } catch { /* gap */ }
    }
    renameSync(LOG, `${LOG}.1`);
  } catch { /* never block a run */ }
}

function pruneShots() {
  try {
    const files = readdirSync(SHOTS)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ f, t: statSync(join(SHOTS, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(SHOTS_KEEP)) rmSync(join(SHOTS, f), { force: true });
  } catch { /* best effort */ }
}

// Playwright refuses a profile another Chrome still holds. A lock left by a
// closed window is safe to clear; a live process is not.
export function assertProfileFree() {
  try {
    // pgrep on macOS reads a leading "--" as an option, so match un-dashed.
    execFileSync('/usr/bin/pgrep', ['-f', `user-data-dir=${PROFILE}`]);
  } catch {
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { rmSync(join(PROFILE, f), { force: true }); } catch { /* ignore */ }
    }
    return;
  }
  log('ABORT - a Chrome window is still using the profile. Quit it and retry.');
  notify('tv-logout', 'Quit the Chrome window on the tv-logout profile, then retry.');
  process.exit(5);
}

export async function launch({ headless }) {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    viewport: { width: 1400, height: 1000 },
    // Chrome encrypts cookies with a macOS Keychain key. Playwright's default
    // --use-mock-keychain substitutes a fake key, so real cookies decrypt to
    // garbage AND get deleted. Dropping it preserves the signed-in session.
    ignoreDefaultArgs: ['--use-mock-keychain'],
    args: ['--no-first-run', '--no-default-browser-check'],
  });
}

// Google's Material overlays sometimes swallow pointer events.
async function robustClick(handle) {
  try { await handle.click({ timeout: 8000 }); return true; } catch { /* overlay */ }
  try { await handle.click({ force: true, timeout: 5000 }); return true; } catch { /* blocked */ }
  try { await handle.evaluate((el) => el.click()); return true; } catch { return false; }
}

// When someone is watching, Google's challenge is answerable: wait it out.
async function waitForDeviceList(page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const t = await page.innerText('body').catch(() => '');
    if (/your devices/i.test(t)) return true;
  }
  return false;
}

export async function readTvRows(page, scopeLabel) {
  const out = [];
  for (const li of await page.$$('li')) {
    const text = ((await li.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 200) continue;
    if (!text.toLowerCase().includes(scopeLabel.toLowerCase())) continue;
    out.push({ li, text });
  }
  return out;
}

export async function confirmAccount(page, expected) {
  await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  if (/accounts\.google\.com|ServiceLogin/.test(page.url())) return { ok: false, reason: 'session expired' };
  const body = await page.innerText('body').catch(() => '');
  const m = body.match(/Signed in as\s+([\w.+-]+@[\w.-]+)/i);
  if (!m) return { ok: false, reason: 'account check failed' };
  if (expected && m[1].toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, reason: `wrong account (${m[1]})`, email: m[1] };
  }
  return { ok: true, email: m[1] };
}

export async function run({ dry, headful, cfg }) {
  mkdirSync(SHOTS, { recursive: true });
  rotateLog();
  pruneShots();
  assertProfileFree();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const keep = cfg.keep || [];
  const scopeLabel = cfg.scopeLabel || 'YouTube on TV';
  const isKept = (t) => keep.some((k) => t.toLowerCase().includes(k.toLowerCase()));

  let ctx;
  const signedOut = [];
  let exitCode = 0;
  let failReason = null;

  try {
    ctx = await launch({ headless: !headful });
    const page = ctx.pages()[0] || (await ctx.newPage());

    const acct = await confirmAccount(page, cfg.account);
    if (!acct.ok) {
      log(`ABORT - ${acct.reason}`);
      notify('tv-logout', `${acct.reason}. Run: npm run setup`);
      return { exitCode: acct.reason === 'session expired' ? 2 : 3, failReason: acct.reason, signedOut };
    }
    log(`account confirmed: ${acct.email}${dry ? ' [DRY RUN]' : ''}`);

    const processed = new Set();
    for (let i = 0; i < MAX_SIGNOUTS; i++) {
      await page.goto(DEVICE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
      if (i === 0) await page.screenshot({ path: join(SHOTS, `${stamp}-before.png`), fullPage: true });

      // Google gates this page behind a periodic passkey challenge. On that
      // screen the list is simply absent, which would otherwise be
      // indistinguishable from "nothing to do" and report a false success.
      const listText = await page.innerText('body').catch(() => '');
      if (!/your devices/i.test(listText)) {
        const reauth = /verifying it.s you|complete sign-in|confirm you.re you|passkey|enter your password/i.test(listText);
        if (reauth && headful) {
          log('Google wants to verify it is you - approve the prompt in the window.');
          await page.bringToFront().catch(() => {});
          notify('tv-logout', 'Approve the Google prompt in the open window.');
          if (await waitForDeviceList(page, 180000)) { log('verified - continuing'); i--; continue; }
          failReason = 'verification not completed in time';
        } else if (reauth) {
          failReason = 'Google requires verification';
        } else {
          failReason = 'device list did not load';
        }
        log(`ABORT - ${failReason}`);
        notify('tv-logout', `${failReason}. Run: npm run purge`);
        await page.screenshot({ path: join(SHOTS, `${stamp}-blocked.png`), fullPage: true });
        return { exitCode: reauth ? 6 : 7, failReason, signedOut };
      }

      const rows = await readTvRows(page, scopeLabel);
      if (i === 0) log(`found ${rows.length} "${scopeLabel}" session(s)`);

      const next = rows.find((r) => {
        const key = r.text.slice(0, 90);
        if (processed.has(key)) return false;
        if (/signed out/i.test(r.text)) { processed.add(key); return false; }
        if (isKept(r.text)) { processed.add(key); log(`KEEP: ${key}`); return false; }
        return true;
      });
      if (!next) break;

      const key = next.text.slice(0, 90);
      processed.add(key);
      if (dry) { log(`WOULD SIGN OUT: ${key}`); signedOut.push(key); continue; }

      const rowLink = (await next.li.$('[role="link"], [role="button"], a, button')) || next.li;
      if (!(await robustClick(rowLink))) { log(`could not open: ${key}`); continue; }
      await page.waitForTimeout(4000);

      // Re-verify on the detail page before anything destructive.
      const detail = (await page.innerText('body')).replace(/\s+/g, ' ').trim();
      if (!detail.toLowerCase().includes(scopeLabel.toLowerCase()) || isKept(detail)) {
        log(`ABORT ROW - failed re-check: ${key}`);
        continue;
      }

      let opened = false;
      for (const b of await page.$$('button, [role="button"]')) {
        const t = ((await b.innerText().catch(() => '')) || '').trim();
        if (/^sign out$/i.test(t) && (await b.isVisible().catch(() => false))) {
          opened = await robustClick(b);
          break;
        }
      }
      if (!opened) { log(`no Sign out button: ${key}`); continue; }
      await page.waitForTimeout(2500);

      // The modal's button must be found INSIDE the dialog: the page behind it
      // still has its own "Sign out", and clicking that just reopens the modal.
      const dialog = await page.$('[role="dialog"], [role="alertdialog"]');
      const scope = dialog || page;
      let confirmed = false;
      for (const b of (await scope.$$('button, [role="button"]')).reverse()) {
        const t = ((await b.innerText().catch(() => '')) || '').trim();
        if (/^(sign out|confirm|ok|yes|remove)$/i.test(t) && (await b.isVisible().catch(() => false))) {
          confirmed = await robustClick(b);
          break;
        }
      }
      if (!confirmed) { log(`NOT CONFIRMED - skipping: ${key}`); continue; }

      await page.waitForTimeout(4000);
      signedOut.push(key);
      log(`SIGNED OUT: ${key}`);
    }

    await page.goto(DEVICE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(SHOTS, `${stamp}-after.png`), fullPage: true });

    log(`DONE - ${dry ? 'would sign out' : 'signed out'} ${signedOut.length}`);
    if (signedOut.length && !dry) {
      notify('tv-logout', `Signed out ${signedOut.length} TV session(s).`);
    }
  } catch (err) {
    if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ENOTFOUND|EAI_AGAIN/.test(err.message)) {
      log('no network connection');
      return { exitCode: 8, failReason: 'no network connection', signedOut };
    }
    log(`ERROR: ${err.message}`);
    notify('tv-logout', `Failed: ${err.message}`);
    exitCode = 1;
    failReason = err.message;
  } finally {
    await ctx?.close().catch(() => {});
  }
  return { exitCode, failReason, signedOut };
}
