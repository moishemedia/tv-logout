#!/usr/bin/env node
// tv-logout - evict yourself from TVs you no longer sit in front of.
//
//   setup <service>   sign in once, by hand (services block automated logins)
//   probe <service>   dump the live page so selectors can be corrected
//   evict             THE command: run every enabled service, visible window
//   check             dry run, changes nothing
//   weekly            headless backstop used by the scheduler
//   schedule | unschedule | status

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ROOT, openForLogin, launch, bodyText, waitForText } from './core/browser.mjs';
import { runAdapter, log } from './core/engine.mjs';
import {
  notify, recordSuccess, emailFailure, flushParkedAlert, pingDeadman,
} from './core/notify.mjs';

const CONFIG = join(ROOT, 'config.json');
const LABEL = 'com.tvlogout.weekly';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const SERVICES = ['youtube', 'netflix', 'hbomax', 'spotify', 'disneyplus'];

const loadAdapter = (id) => import(`./adapters/${id}.mjs`).then((m) => m.default);

function cfg() {
  if (!existsSync(CONFIG)) return { services: {}, deadmanUrl: '' };
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}
function saveCfg(c) { writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n'); }
const enabled = (c) => SERVICES.filter((s) => c.services?.[s]?.enabled);

function requireService(id) {
  if (SERVICES.includes(id)) return id;
  console.error(`Unknown service "${id}". Known: ${SERVICES.join(', ')}`);
  process.exit(1);
}

// Is this profile already usable? A challenge counts as signed in: you only
// get asked to verify yourself once you have authenticated.
async function checkSession(a, { headful = false, waitMs = 0 } = {}) {
  const ctx = await launch(a.id, { headless: !headful });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(a.devicesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(a.settleMs || 5000);
    let t = await bodyText(page);

    // Check the signed-out signal FIRST: "ready" patterns are necessarily
    // loose, and a login page mentioning e.g. "Supported Devices" in its footer
    // would otherwise read as success.
    if (a.signedOutRe?.test(t)) return { signedIn: false, challenged: false };

    if (a.challengeRe?.test(t)) {
      if (!waitMs) return { signedIn: true, challenged: true };
      console.log('The service wants to verify it is you - approve it in the window.');
      await page.bringToFront().catch(() => {});
      if (await waitForText(page, a.readyRe, waitMs)) return { signedIn: true, challenged: false };
      return { signedIn: true, challenged: true };
    }
    if (a.readyRe?.test(t)) return { signedIn: true, challenged: false };
    return { signedIn: false, challenged: false };
  } finally { await ctx.close().catch(() => {}); }
}

function enableService(id, a) {
  const c = cfg();
  c.services = c.services || {};
  c.services[id] = { enabled: true, keep: c.services[id]?.keep || [] };
  saveCfg(c);
  console.log(`\n${a.name} is set up and enabled.`);
  if (a.mode === 'bulk') {
    console.log('This service uses its bulk sign-out, so ALL devices go, including yours.');
    console.log('That is usually a short re-login on your own TV.');
  }
}

async function cmdSetup(id) {
  requireService(id);
  const a = await loadAdapter(id);

  // Skip the login window entirely when the profile already has a session.
  const existing = await checkSession(a).catch(() => ({ signedIn: false }));
  if (existing.signedIn) {
    console.log(`Already signed into ${a.name}${existing.challenged ? ' (a verification prompt is pending, which is fine)' : ''}.`);
    enableService(id, a);
    console.log('\nNext:  npm run check');
    return;
  }

  console.log(`
-------------------------------------------------------------
A Chrome window will open on a profile used only for ${a.name}.

  1. Sign into ${a.name}
  2. Wait until the page finishes loading
  3. Quit Chrome with Cmd+Q  (NOT the red close button)

Cmd+Q matters: Chrome only writes the session to disk on a
clean quit. Nothing is uploaded; the profile stays on this Mac.
-------------------------------------------------------------
`);
  openForLogin(id, a.loginUrl);

  console.log('Verifying...');
  const after = await checkSession(a);
  if (!after.signedIn) {
    console.error('\nSign-in did not stick. The usual cause is closing Chrome with the');
    console.error('red button instead of Cmd+Q - closing a window does not quit Chrome,');
    console.error('and the session is only written to disk on a clean quit.');
    process.exit(1);
  }
  enableService(id, a);
  console.log('\nNext:  npm run check');
}

// Selector archaeology. Every adapter but YouTube shipped unverified; this
// prints what the live page actually contains so they can be corrected.
async function cmdProbe(id) {
  requireService(id);
  const a = await loadAdapter(id);
  const ctx = await launch(id, { headless: false });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(a.devicesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout((a.settleMs || 5000) + 4000);
    console.log(`\nURL -> ${page.url()}\n`);
    const t = await bodyText(page);
    console.log('===== PAGE TEXT (first 2500) =====');
    console.log(t.replace(/\n{2,}/g, '\n').slice(0, 2500));
    console.log('\n===== VISIBLE CLICKABLES =====');
    for (const el of await page.$$('button, a, [role="button"], [role="link"]')) {
      const txt = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 60) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      console.log(' -', JSON.stringify(txt));
    }
    console.log('\n===== ADAPTER EXPECTATIONS =====');
    console.log('readyRe matches page:', a.readyRe ? a.readyRe.test(t) : 'n/a');
    if (a.mode === 'bulk') console.log('bulkPatterns:', a.bulkPatterns.map(String).join(', '));
    else console.log('rowScopeRe:', String(a.rowScopeRe));
  } finally { await ctx.close().catch(() => {}); }
}

async function runMany({ dry, headful }) {
  const c = cfg();
  const ids = enabled(c);
  if (!ids.length) { console.error('No services set up yet. Run:  npm run setup youtube'); process.exit(1); }

  if (!dry) await flushParkedAlert(c);
  const results = [];
  for (const id of ids) {
    const a = await loadAdapter(id);
    const r = await runAdapter(a, { dry, headful, keep: c.services[id].keep || [] });
    results.push({ id, name: a.name, ...r });
  }

  console.log('\n===== SUMMARY =====');
  for (const r of results) {
    const line = r.status === 'ok'
      ? `${r.name}: ${dry ? 'would sign out' : 'signed out'} ${r.signedOut.length}, kept ${r.kept.length}`
      : `${r.name}: FAILED - ${r.reason}`;
    console.log(' ', line);
  }
  const failed = results.filter((r) => r.status !== 'ok');
  if (dry) return failed.length ? 1 : 0;

  if (failed.length) {
    const reason = failed.map((f) => `${f.name}: ${f.reason}`).join('; ');
    log(`failures: ${reason}`);
    notify('tv-logout', `${failed.length} service(s) failed. Run: npm run evict`);
    await emailFailure(c, reason);
  } else {
    // The dead-man's switch is only pinged when EVERY service succeeded. A
    // partial run must not look healthy from the outside.
    recordSuccess();
    await pingDeadman(c);
  }
  return failed.length ? 1 : 0;
}

async function cmdEvict() {
  console.log('\nRunning every enabled service. Approve any verification prompts that appear.\n');
  process.exit(await runMany({ dry: false, headful: true }));
}
const cmdCheck = async () => process.exit(await runMany({ dry: true, headful: false }));
async function cmdWeekly() {
  // A laptop shut or off wifi at the scheduled minute should not lose its week.
  for (let attempt = 0; ; attempt++) {
    const code = await runMany({ dry: false, headful: false });
    if (code === 0 || attempt >= 2) process.exit(code);
    log(`retrying in 5 minutes (attempt ${attempt + 1} of 2)`);
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  }
}

function cmdStatus() {
  const c = cfg();
  console.log('Service        Enabled  Mode        Keep');
  for (const s of SERVICES) {
    const e = c.services?.[s];
    console.log(
      s.padEnd(14),
      (e?.enabled ? 'yes' : 'no').padEnd(8),
      (e ? '' : 'not set up').padEnd(11),
      (e?.keep || []).join(', ')
    );
  }
}

function cmdSchedule() {
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string>
    <string>cd ${ROOT} &amp;&amp; node ./cli.mjs weekly</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>45</integer></dict>
  <key>StandardOutPath</key><string>${join(ROOT, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(ROOT, 'launchd.err.log')}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`);
  const uid = process.getuid();
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('Could not load the schedule:', r.stderr); process.exit(1); }

  // Daily watchdog as a SEPARATE agent: if the weekly one breaks or is
  // unloaded, something independent still notices the silence.
  const WLABEL = `${LABEL}.watchdog`;
  const wplist = PLIST.replace(`${LABEL}.plist`, `${WLABEL}.plist`);
  writeFileSync(wplist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${WLABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string>
    <string>cd ${ROOT} &amp;&amp; node ./watchdog.mjs</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${join(ROOT, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(ROOT, 'launchd.err.log')}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`);
  spawnSync('launchctl', ['bootout', `gui/${uid}/${WLABEL}`], { stdio: 'ignore' });
  const rw = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, wplist], { encoding: 'utf8' });
  if (rw.status !== 0) console.error('Watchdog did not load:', rw.stderr);

  console.log('Scheduled: weekly run Mondays 11:45, watchdog daily 12:30.');
  console.log('Remove both with:  npm run unschedule');
}
function cmdUnschedule() {
  const uid = process.getuid();
  for (const l of [LABEL, `${LABEL}.watchdog`]) {
    spawnSync('launchctl', ['bootout', `gui/${uid}/${l}`], { stdio: 'ignore' });
  }
  console.log('Schedule removed.');
}

const [cmd, arg] = process.argv.slice(2);
const table = {
  setup: () => cmdSetup(arg), probe: () => cmdProbe(arg),
  evict: cmdEvict, check: cmdCheck, weekly: cmdWeekly,
  schedule: cmdSchedule, unschedule: cmdUnschedule, status: cmdStatus,
};
if (!table[cmd]) {
  console.log(`Usage:
  node cli.mjs setup <service>    sign in once (${SERVICES.join(' | ')})
  node cli.mjs probe <service>    dump the live page to fix selectors
  node cli.mjs evict              run everything now (visible window)
  node cli.mjs check              dry run
  node cli.mjs status             what is configured
  node cli.mjs schedule           weekly backstop, Mondays 11:45`);
  process.exit(1);
}
await table[cmd]();
