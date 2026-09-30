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
import { ROOT, openForLogin, launch, bodyText } from './core/browser.mjs';
import { runAdapter, log } from './core/engine.mjs';

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

async function cmdSetup(id) {
  requireService(id);
  const a = await loadAdapter(id);
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
  const ctx = await launch(id, { headless: true });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(a.devicesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(a.settleMs || 5000);
    const t = await bodyText(page);
    const signedIn = !a.signedOutRe?.test(t) && !/\/login|\/signin/i.test(page.url());
    if (!signedIn) {
      console.error(`\nSign-in did not stick. Most common cause: closing Chrome with the red button instead of Cmd+Q.`);
      process.exit(1);
    }
    const c = cfg();
    c.services = c.services || {};
    c.services[id] = { enabled: true, keep: c.services[id]?.keep || [] };
    saveCfg(c);
    console.log(`\n${a.name} is set up and enabled.`);
    if (a.mode === 'bulk') {
      console.log('This service uses its bulk sign-out, so ALL devices go, including yours.');
      console.log('That is usually a short re-login on your own TV.');
    }
    console.log('\nNext:  npm run check');
  } finally { await ctx.close().catch(() => {}); }
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
  if (failed.length && !dry) await pingOrReport(c, failed);
  return failed.length ? 1 : 0;
}

// The dead-man's switch only gets a ping when everything succeeded; a partial
// run should not look healthy from the outside.
async function pingOrReport(c, failed) {
  log(`failures: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}`);
}

async function cmdEvict() {
  console.log('\nRunning every enabled service. Approve any verification prompts that appear.\n');
  process.exit(await runMany({ dry: false, headful: true }));
}
const cmdCheck = async () => process.exit(await runMany({ dry: true, headful: false }));
const cmdWeekly = async () => process.exit(await runMany({ dry: false, headful: false }));

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
  console.log('Weekly backstop scheduled: Mondays 11:45.');
}
function cmdUnschedule() {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
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
