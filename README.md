# tv-logout

You sign into YouTube on a hotel or Airbnb TV, fly home, and your account is
still sitting there logged in. This signs those sessions out for you, weekly,
without touching the TVs you actually own.

Runs entirely on your own Mac. Nothing is uploaded, no account is "connected"
to any service, and no credentials or cookies ever leave the machine.

## Why it works this way

Google publishes no API for device sessions. None. The only way to revoke one
is through the account page in a signed-in browser, so that is exactly what
this does: it drives a Chrome profile that lives in this folder.

Two consequences worth knowing before you install it:

- **You sign in by hand, once.** Google refuses sign-in inside an automated
  browser, so `setup` opens a normal Chrome window for you.
- **Google sometimes asks to verify it's you.** A background job cannot answer
  a passkey prompt, so when that happens the weekly run stops and tells you,
  and you run `npm run purge` to finish it with one Touch ID tap.

## Install

Requires macOS, Google Chrome, and Node 20+.

```bash
git clone https://github.com/moishemedia/tv-logout.git
cd tv-logout
npm install
npm run setup
```

`setup` signs you in, reads the TV sessions currently on your account, and asks
which ones are yours. Those are kept forever. Everything else gets signed out.

## Use

```bash
npm run check       # preview only, changes nothing
npm run purge       # sign out the strays now (opens a window)
npm run schedule    # run automatically, Mondays at 11:45
npm run unschedule  # stop the schedule
```

## What it will not touch

Only sessions labelled **YouTube on TV** are ever considered. Your phone,
tablet and laptop sessions are out of scope structurally, not just by
configuration. Cast hardware (Chromecast, SHIELD, Assistant speakers) carries a
different label and is never matched either.

Before any sign-out it re-checks the device page it landed on, and it stops
after 25 sign-outs in a run as a runaway guard.

## Files

| Path          | What it is                                                  |
| ------------- | ----------------------------------------------------------- |
| `config.json` | Your account and keep list. Created by `setup`.             |
| `profile/`    | The Chrome profile holding your session. Never commit this. |
| `run.log`     | Rotates at 1 MB, keeps 3 old copies.                        |
| `shots/`      | Before/after screenshots, newest 24 kept.                   |

`profile/` contains a live Google session. It is gitignored for a reason.

## Limits

Google can change the account page at any time, and did exactly that while this
was being written: the old `youtube.com/account_sharing` TV list no longer
exists. If a run reports that the device list did not load, that is probably
what happened.
