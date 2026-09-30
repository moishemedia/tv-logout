// Service-agnostic engine. Adapters describe WHERE things are; this decides
// what to do with them, so per-service code stays small and reviewable.
//
// Two modes:
//   bulk       - one "sign out of all devices" button. Robust, but also signs
//                out the devices you own. Preferred where it exists.
//   per-device - walk device rows, skip anything on the keep list. Fragile,
//                but the only option when a service has no bulk control.

import { join } from 'node:path';
import { mkdirSync, appendFileSync, statSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { launch, robustClick, findByText, bodyText, waitForText, ROOT } from './browser.mjs';

export const SHOTS = join(ROOT, 'shots');
export const LOG = join(ROOT, 'run.log');
const MAX_SIGNOUTS = 25;      // runaway guard
const LOG_MAX = 1 << 20;
const SHOTS_KEEP = 40;

export function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* non-fatal */ }
}

function housekeep() {
  mkdirSync(SHOTS, { recursive: true });
  try {
    if (statSync(LOG).size >= LOG_MAX) {
      rmSync(`${LOG}.3`, { force: true });
      for (let n = 2; n >= 1; n--) { try { renameSync(`${LOG}.${n}`, `${LOG}.${n + 1}`); } catch {} }
      renameSync(LOG, `${LOG}.1`);
    }
  } catch { /* no log yet */ }
  try {
    const f = readdirSync(SHOTS).filter((x) => x.endsWith('.png'))
      .map((x) => ({ x, t: statSync(join(SHOTS, x)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { x } of f.slice(SHOTS_KEEP)) rmSync(join(SHOTS, x), { force: true });
  } catch { /* best effort */ }
}

const OK = (signedOut, kept) => ({ status: 'ok', signedOut, kept });
const FAIL = (reason) => ({ status: 'failed', reason, signedOut: [], kept: [] });

export async function runAdapter(adapter, { dry = false, headful = false, keep = [] } = {}) {
  housekeep();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = `[${adapter.name}]`;
  const isKept = (t) => keep.some((k) => t.toLowerCase().includes(k.toLowerCase()));
  const signedOut = [];
  const kept = [];
  let ctx;

  try {
    ctx = await launch(adapter.id, { headless: !headful });
    const page = ctx.pages()[0] || (await ctx.newPage());

    await page.goto(adapter.devicesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // These pages redirect and hydrate on their own schedule, so poll for a
    // decisive signal instead of guessing a fixed wait. A fixed wait either
    // fails intermittently or makes every run needlessly slow.
    let text = await bodyText(page);
    const settleBy = Date.now() + (adapter.maxSettleMs || 30000);
    const decided = () => adapter.challengeRe?.test(text) || adapter.signedOutRe?.test(text)
      || (adapter.readyRe ? adapter.readyRe.test(text) : true);
    while (!decided() && Date.now() < settleBy) {
      await page.waitForTimeout(2000);
      text = await bodyText(page);
    }

    // A challenge is answerable when someone is watching, and fatal otherwise.
    if (adapter.challengeRe?.test(text)) {
      if (!headful) {
        log(`${tag} blocked: the service wants to verify it is you`);
        await page.screenshot({ path: join(SHOTS, `${stamp}-${adapter.id}-blocked.png`), fullPage: true });
        return FAIL('verification required');
      }
      log(`${tag} approve the verification prompt in the window...`);
      await page.bringToFront().catch(() => {});
      if (!(await waitForText(page, adapter.readyRe, 180000))) return FAIL('verification not completed');
      text = await bodyText(page);
    }

    if (adapter.signedOutRe?.test(text) || /\/login|\/signin/i.test(page.url())) {
      log(`${tag} not signed in`);
      return FAIL('not signed in');
    }
    if (adapter.readyRe && !adapter.readyRe.test(text)) {
      log(`${tag} device page did not look right - layout may have changed`);
      await page.screenshot({ path: join(SHOTS, `${stamp}-${adapter.id}-unexpected.png`), fullPage: true });
      return FAIL('device page not recognised');
    }

    await page.screenshot({ path: join(SHOTS, `${stamp}-${adapter.id}-before.png`), fullPage: true });

    if (adapter.mode === 'bulk') {
      const btn = await findByText(page, adapter.bulkPatterns);
      if (!btn) { log(`${tag} no bulk sign-out control found`); return FAIL('bulk control not found'); }
      if (dry) { log(`${tag} WOULD CLICK "${btn.text}"`); return OK([btn.text], []); }

      if (!(await robustClick(btn.el))) return FAIL('bulk control not clickable');
      await page.waitForTimeout(2500);
      // Confirm inside the dialog when one opens; the page behind it usually
      // still shows an identical button that does nothing.
      const dialog = await page.$('[role="dialog"], [role="alertdialog"]');
      const confirm = await findByText(dialog || page, adapter.confirmPatterns || adapter.bulkPatterns, { last: true });
      if (confirm) { await robustClick(confirm.el); await page.waitForTimeout(3000); }
      log(`${tag} signed out of all devices`);
      signedOut.push('all devices');
    } else {
      const processed = new Set();
      for (let i = 0; i < MAX_SIGNOUTS; i++) {
        if (i > 0) {
          await page.goto(adapter.devicesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(adapter.settleMs || 5000);
        }
        const rows = [];
        for (const li of await page.$$(adapter.rowSelector || 'li')) {
          const t = ((await li.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 200) continue;
          if (adapter.rowScopeRe && !adapter.rowScopeRe.test(t)) continue;
          rows.push({ li, text: t });
        }
        if (i === 0) log(`${tag} found ${rows.length} device row(s)`);

        const next = rows.find((r) => {
          const key = r.text.slice(0, 90);
          if (processed.has(key)) return false;
          if (adapter.alreadyOutRe?.test(r.text)) { processed.add(key); return false; }
          if (isKept(r.text)) { processed.add(key); kept.push(key); log(`${tag} KEEP: ${key}`); return false; }
          return true;
        });
        if (!next) break;

        const key = next.text.slice(0, 90);
        processed.add(key);
        if (dry) { log(`${tag} WOULD SIGN OUT: ${key}`); signedOut.push(key); continue; }

        const inRow = await findByText(next.li, adapter.rowSignOutPatterns || [/^sign out$/i]);
        if (inRow) {
          if (!(await robustClick(inRow.el))) { log(`${tag} not clickable: ${key}`); continue; }
        } else {
          // No control inside the row: open a detail view and act there.
          const open = (await next.li.$('[role="link"], a, button')) || next.li;
          if (!(await robustClick(open))) { log(`${tag} could not open: ${key}`); continue; }
          await page.waitForTimeout(3500);
          const detail = (await bodyText(page)).replace(/\s+/g, ' ');
          if (isKept(detail)) { log(`${tag} ABORT ROW - failed re-check: ${key}`); continue; }
          const btn = await findByText(page, adapter.rowSignOutPatterns || [/^sign out$/i]);
          if (!btn || !(await robustClick(btn.el))) { log(`${tag} no sign-out control: ${key}`); continue; }
        }

        await page.waitForTimeout(2500);
        const dialog = await page.$('[role="dialog"], [role="alertdialog"]');
        const confirm = await findByText(dialog || page, adapter.confirmPatterns || [/^(sign out|confirm|ok|yes|remove)$/i], { last: true });
        if (dialog && !confirm) { log(`${tag} NOT CONFIRMED - skipping: ${key}`); continue; }
        if (confirm) await robustClick(confirm.el);
        await page.waitForTimeout(3000);

        signedOut.push(key);
        log(`${tag} SIGNED OUT: ${key}`);
      }
    }

    await page.screenshot({ path: join(SHOTS, `${stamp}-${adapter.id}-after.png`), fullPage: true });
    log(`${tag} done - ${dry ? 'would sign out' : 'signed out'} ${signedOut.length}, kept ${kept.length}`);
    return OK(signedOut, kept);
  } catch (err) {
    if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(err.message)) {
      log(`${tag} no network`);
      return FAIL('no network connection');
    }
    log(`${tag} ERROR: ${err.message}`);
    return FAIL(err.message);
  } finally {
    await ctx?.close().catch(() => {});
  }
}
