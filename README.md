# tv-logout

You sign into your streaming accounts on a hotel or Airbnb TV, fly home, and
every one of them is still logged in. This evicts you from all of them with one
command, and keeps a weekly run as a backstop.

Everything happens on your own Mac. No account is "connected" to any service,
and no credentials or cookies ever leave the machine.

## Services

| Service | Mode | Status |
|---|---|---|
| YouTube | per-device | **Working.** Keeps your own TVs via a keep list. |
| Disney+ | per-device | **Working.** Scoped to TV hardware, current device excluded. |
| Netflix | per-device | **In progress.** Adapter written; needs a re-probe with a TV signed in. |
| Spotify | bulk | **In progress.** Adapter written and the control is matched; not yet verified live. |
| HBO Max | — | **Investigating.** No device management exists in the web app from this region. |

### What the in-progress ones are waiting on

**Netflix** only rendered a bulk "Sign Out of All Devices" button, which would
sign out this tool's own browser and force a fresh login plus an emailed code
every run. Per-device controls are expected to appear once the account actually
has a TV signed in, since Netflix renders per-row actions only when there is
something to act on. That is the re-probe.

**Spotify** exposes a single "Sign out everywhere". The adapter finds it, but
that control almost certainly signs this tool out too, which would break the
stored session each run. It stays disabled until that is tested and either
confirmed harmless or reworked.

**HBO Max** is the hard one. `max.com` is geo-blocked outright from some
regions, and the working domain `play.hbomax.com` exposes only playback,
subtitle and parental settings — no device list at all. `/settings/devices`
errors. There may be a fuller site behind a US connection, which is the next
thing to check.

**per-device** walks the device list and skips anything on your keep list, so
your own TV survives. **bulk** uses the service's own "sign out everywhere"
button: far more robust, but it signs out your own devices too, which is
usually a short re-login at home.

Amazon Prime is deliberately absent. Its device pages sit behind aggressive bot
detection and CAPTCHAs, which cannot be automated responsibly.

## Why it works this way

None of these services publish an API for device sessions. The only way to
revoke one is through the account page in a signed-in browser, so that is what
this drives: one Chrome profile per service, stored in this folder.

Two consequences:

- **You sign in by hand, once per service.** They block sign-in inside an
  automated browser, by design.
- **Some services periodically ask to verify it's you.** A background job
  cannot answer a passkey or an SMS code, so the weekly run stops and says so.
  `evict` runs in a visible window and waits for you.

## Install

Requires macOS, Google Chrome, and Node 20+.

```bash
npm install
npm run setup youtube     # repeat per service
npm run check             # dry run, changes nothing
```

## Use

```bash
npm run evict       # THE command. Run it when you get home.
npm run check       # preview only
npm run status      # what is configured
npm run schedule    # weekly backstop, Mondays 11:45
```

## Fixing a broken service

These companies change their settings pages without warning. When a service
starts failing, dump what the page actually looks like now:

```bash
npm run probe netflix
```

That prints the live page text, every visible clickable, and whether the
adapter's expectations still match. Adapters are ~15 lines in `adapters/`, so
correcting one is a small edit rather than a rewrite.

## What it will not touch

YouTube runs in per-device mode scoped to sessions labelled **YouTube on TV**,
so phones, tablets and laptops are out of reach structurally, not just by
configuration. Every run stops after 25 sign-outs as a runaway guard, and
per-device mode re-checks the page it landed on before anything destructive.

Profiles under `profiles/` hold live sessions. They are gitignored for a reason.
