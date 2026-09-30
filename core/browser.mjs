// Browser plumbing shared by every service adapter.
//
// One Chrome profile per service, kept side by side under profiles/. Sessions
// never leave the machine, and no service's cookies are visible to another.

import { chromium } from 'playwright';
import { rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const PROFILES = join(ROOT, 'profiles');
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const profileDir = (serviceId) => join(PROFILES, serviceId);

// pgrep on macOS reads a leading "--" as an option, so match the un-dashed form.
export function profileInUse(dir) {
  try { execFileSync('/usr/bin/pgrep', ['-f', `user-data-dir=${dir}`]); return true; }
  catch { return false; }
}

export function clearStaleLock(dir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { rmSync(join(dir, f), { force: true }); } catch { /* ignore */ }
  }
}

export async function launch(serviceId, { headless = true } = {}) {
  const dir = profileDir(serviceId);
  mkdirSync(dir, { recursive: true });
  if (profileInUse(dir)) {
    throw new Error(`a Chrome window is still using the ${serviceId} profile - quit it and retry`);
  }
  clearStaleLock(dir);
  return chromium.launchPersistentContext(dir, {
    channel: 'chrome',
    headless,
    viewport: { width: 1400, height: 1000 },
    // Services localise by IP, and Spotify served Spanish here. Every adapter
    // matches on English button text, so pin the language rather than trying
    // to translate selectors per region.
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    // Chrome encrypts cookies with a macOS Keychain key. Playwright's default
    // --use-mock-keychain substitutes a fake one, so real cookies decrypt to
    // garbage AND get deleted. Dropping it preserves the signed-in session.
    ignoreDefaultArgs: ['--use-mock-keychain'],
    args: ['--no-first-run', '--no-default-browser-check'],
  });
}

// Services block sign-in inside an automated browser, so logins happen in a
// normal Chrome window driven by the person, once per service.
export function openForLogin(serviceId, url) {
  const dir = profileDir(serviceId);
  mkdirSync(dir, { recursive: true });
  if (profileInUse(dir)) throw new Error('quit the Chrome window on this profile first');
  clearStaleLock(dir);
  spawnSync(CHROME, [
    `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--lang=en-US', url,
  ], { stdio: 'ignore' });
}

// Overlays and animated shells swallow pointer events on most of these sites.
export async function robustClick(handle) {
  try { await handle.click({ timeout: 8000 }); return true; } catch { /* overlay */ }
  try { await handle.click({ force: true, timeout: 5000 }); return true; } catch { /* blocked */ }
  try { await handle.evaluate((el) => el.click()); return true; } catch { return false; }
}

// Find a visible clickable whose text matches any pattern. Scope to a dialog
// when one is open: the page behind a modal often has an identical button.
export async function findByText(scope, patterns, { last = false } = {}) {
  const els = await scope.$$('button, a, [role="button"], [role="link"], input[type="submit"]');
  const list = last ? els.reverse() : els;
  for (const el of list) {
    const t = ((await el.innerText().catch(() => '')) || '').trim()
      || ((await el.getAttribute('value').catch(() => '')) || '').trim();
    if (!t || t.length > 80) continue;
    if (!patterns.some((p) => p.test(t))) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    return { el, text: t };
  }
  return null;
}

export async function waitForText(page, re, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const t = await page.innerText('body').catch(() => '');
    if (re.test(t)) return true;
  }
  return false;
}

export const bodyText = (page) => page.innerText('body').catch(() => '');
