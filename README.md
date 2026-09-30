# tv-logout

You sign into your streaming accounts on a hotel or Airbnb TV, fly home, and
every one of them is still logged in. This evicts you from all of them with one
command, and keeps a weekly run as a backstop.

Everything happens on your own Mac. No account is "connected" to any service,
and no credentials or cookies ever leave the machine.

## Services

| Service | Mode | State |
|---|---|---|
| YouTube | per-device | Working. Keeps your own TVs via a keep list. |
| Disney+ | per-device | Working. Scoped to TV hardware, current device excluded. |
| Netflix | per-device | Blocked: only a bulk control is offered, which signs this tool out too. Needs a re-probe once a TV is signed in. |
| Spotify | bulk | Set up, disabled. Same self-signout risk, untested live. |
| HBO Max | - | Unsupported: no device management exists in the web app. |

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
