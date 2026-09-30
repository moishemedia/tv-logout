#!/usr/bin/env node
// tv-logout CLI:  setup | check | purge | schedule | unschedule

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  ROOT, PROFILE, CONFIG, loadConfig, log, notify,
  launch, confirmAccount, readTvRows, assertProfileFree, run,
} from './signout.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LABEL = 'com.tvlogout.weekly';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const ask = async (q) => {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
};

function requireChrome() {
  if (existsSync(CHROME)) return;
  console.error('Google Chrome is required and was not found at:\n  ' + CHROME);
  process.exit(1);
}

// Opens a real Chrome window. Google blocks sign-in inside an automated
// browser, so this step cannot be scripted - by design.
async function manualLogin() {
  requireChrome();
  assertProfileFree();
  mkdirSync(PROFILE, { recursive: true });
  console.log(`
-------------------------------------------------------------
A Chrome window will open on a profile used only by this tool.

  1. Sign into the Google account whose TVs you want managed
  2. Wait until the page finishes loading
  3. Quit Chrome with Cmd+Q  (NOT the red close button)

Cmd+Q matters: Chrome only writes the session to disk on a
clean quit. Nothing is uploaded anywhere; the profile stays
in this folder on your machine.
-------------------------------------------------------------
`);
  spawnSync(CHROME, [
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://myaccount.google.com/device-activity',
  ], { stdio: 'ignore' });
}

async function cmdSetup() {
  await manualLogin();

  console.log('\nVerifying the session...');
  assertProfileFree();
  let ctx = await launch({ headless: true });
  let page = ctx.pages()[0] || (await ctx.newPage());
  const acct = await confirmAccount(page, null);
  if (!acct.ok) {
    await ctx.close();
    console.error(`\nSign-in did not stick (${acct.reason}).`);
    console.error('Most common cause: Chrome was closed with the red button instead of Cmd+Q.');
    console.error('Run setup again.');
    process.exit(1);
  }
  console.log(`Signed in as ${acct.email}\n`);
  await ctx.close();

  // Reading the device list often trips Google's "verify it's you" challenge,
  // so this pass is visible and waits for the person to clear it.
  console.log('Opening your device list. If Google asks to verify it is you, approve it.\n');
  assertProfileFree();
  ctx = await launch({ headless: false });
  page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://myaccount.google.com/device-activity', { waitUntil: 'domcontentloaded', timeout: 45000 });

  const deadline = Date.now() + 180000;
  let ready = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const t = await page.innerText('body').catch(() => '');
    if (/your devices/i.test(t)) { ready = true; break; }
  }
  if (!ready) {
    await ctx.close();
    console.error('Timed out waiting for the device list. Run setup again.');
    process.exit(1);
  }

  const scopeLabel = 'YouTube on TV';
  const rows = await readTvRows(page, scopeLabel);
  await ctx.close();

  if (!rows.length) {
    console.log('No "YouTube on TV" sessions found on this account right now.');
    console.log('That is fine - setup will still finish with an empty keep list.\n');
  }

  const names = [...new Set(rows.map((r) => r.text.split(/\s{2,}|,/)[0].trim()).filter(Boolean))];
  let keep = [];
  if (names.length) {
    console.log('TV sessions currently signed into your account:\n');
    names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
    console.log(`
Which of these are YOUR OWN devices? Those are kept forever.
Everything else gets signed out on each run.
`);
    const a = await ask('Numbers to KEEP (e.g. 1,3) or blank for none: ');
    keep = a
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => n >= 1 && n <= names.length)
      .map((n) => names[n - 1]);
  }

  // Cast hardware never carries the "YouTube on TV" label, so it is already
  // out of scope, but keeping the names is harmless and self-documenting.
  const cfg = { account: acct.email, scopeLabel, keep };
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

  console.log('\nSaved config.json');
  console.log(`  account: ${cfg.account}`);
  console.log(`  keeping: ${keep.length ? keep.join(', ') : '(nothing)'}`);
  console.log('\nNext:  npm run check    (preview, changes nothing)');
  console.log('       npm run purge    (sign out the strays)');
  console.log('       npm run schedule (weekly, Mondays 11:45)');
}

async function cmdCheck() {
  const { exitCode } = await run({ dry: true, headful: false, cfg: loadConfig() });
  process.exit(exitCode);
}

async function cmdPurge() {
  console.log('\nA Chrome window will open. Approve the Google prompt if it appears.\n');
  const { exitCode } = await run({ dry: false, headful: true, cfg: loadConfig() });
  process.exit(exitCode);
}

// Headless path used by the scheduler: no human, so a challenge is a failure.
// A laptop that was shut or off wifi at the scheduled minute should not lose
// its whole week, so a dead network is retried rather than treated as final.
async function cmdWeekly() {
  const cfg = loadConfig();
  for (let attempt = 0; ; attempt++) {
    const { exitCode, failReason } = await run({ dry: false, headful: false, cfg });
    const offline = failReason && /network|ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN/i.test(failReason);
    if (offline && attempt < 2) {
      log(`no network - retrying in 5 minutes (attempt ${attempt + 1} of 2)`);
      await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
      continue;
    }
    if (exitCode !== 0) notify('tv-logout', `${failReason}. Run: npm run purge`);
    process.exit(exitCode);
  }
}

function cmdSchedule() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd ${ROOT} &amp;&amp; node ./cli.mjs weekly</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>11</integer>
    <key>Minute</key><integer>45</integer>
  </dict>
  <key>StandardOutPath</key><string>${join(ROOT, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(ROOT, 'launchd.err.log')}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
  writeFileSync(PLIST, plist);
  const uid = process.getuid();
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('Could not load the schedule:', r.stderr); process.exit(1); }
  console.log('Scheduled: every Monday at 11:45. Runs on wake if the lid was shut.');
  console.log('Remove it with:  npm run unschedule');
}

function cmdUnschedule() {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
  console.log('Schedule removed.');
}

const cmd = process.argv[2];
const table = {
  setup: cmdSetup, check: cmdCheck, purge: cmdPurge,
  weekly: cmdWeekly, schedule: cmdSchedule, unschedule: cmdUnschedule,
};
if (!table[cmd]) {
  console.log('Usage: node cli.mjs <setup|check|purge|schedule|unschedule>');
  process.exit(1);
}
await table[cmd]();
