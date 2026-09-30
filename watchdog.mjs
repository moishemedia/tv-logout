#!/usr/bin/env node
// Dead-man's switch, local half. The scheduled run emails when a RUN fails, but
// nothing notices when the job stops running at all: an unloaded launchd agent,
// a moved path, a Mac that was off all month. This runs daily and complains if
// too long has passed since the last fully successful run.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './core/browser.mjs';
import { log } from './core/engine.mjs';
import { notify, readState, writeState, emailFailure } from './core/notify.mjs';

const MAX_QUIET_DAYS = 9;  // weekly cadence plus slack
const RENOTIFY_DAYS = 7;   // complain once, not daily

const cfgPath = join(ROOT, 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const state = readState();

const last = state.lastSuccess ? new Date(state.lastSuccess) : null;
const days = last ? (Date.now() - last.getTime()) / 86400000 : Infinity;

if (days < MAX_QUIET_DAYS) {
  log(`watchdog: ok - last success ${days.toFixed(1)}d ago`);
  process.exit(0);
}
const warnedDays = state.lastWarned
  ? (Date.now() - new Date(state.lastWarned).getTime()) / 86400000 : Infinity;
if (warnedDays < RENOTIFY_DAYS) {
  log('watchdog: still stale, but already warned');
  process.exit(0);
}

const human = days === Infinity ? 'never' : `${Math.floor(days)} days ago`;
log(`watchdog: STALE - last success ${human}; alerting`);
notify('tv-logout watchdog', `No successful run in ${human}.`);
if (await emailFailure(cfg, `no successful run since ${human} - the schedule may have stopped`)) {
  writeState({ ...state, lastWarned: new Date().toISOString() });
}
