# CDCMS Auto-Canceller

> Cancel cash memos and confirm deliveries in bulk on the HP Gas CDCMS
> portal — import from Excel, and the tool works through the list for
> you.

![Version](https://img.shields.io/badge/version-1.1.1-blue)
![Manifest](https://img.shields.io/badge/manifest-V3-green)
![License](https://img.shields.io/badge/license-LicenseWala%20Subscription-purple)

---

## What it does

Two repetitive CDCMS jobs eat up a distributor's day: cancelling cash
memos, and confirming deliveries (punching) one by one. **CDCMS
Auto-Canceller** automates both:

- **Cash Memo Cancellation** — cancels cash memos in bulk on the
  `CashMemoCancellation.aspx` page.
- **Delivery Confirmation (Punching)** — confirms deliveries in bulk on
  the `DeliveryConfirmation.aspx` page, in batches of 20.
- **Built for 50+ runs** — every item has its own error handling, so a
  slow row-add or a failed batch submit can no longer freeze the run
  or silently skip items.

## Features

- **Excel import** — import your work list from an Excel file (reader
  bundled with the extension, no setup needed).
- **Bulk cancel + punch** — run cancellations and delivery
  confirmations across long lists without touching each row by hand.
- **Per-item error handling** — a failed item is logged as an error
  and the run advances to the next item, instead of stalling.
- **Batch-submit safety** — if a 20-item batch submit fails, the tool
  rewinds and retries once, then reports per-item errors — items are
  never silently skipped.
- **Configurable delay** — the delay between steps is honoured, so the
  portal is never hammered.
- **Live popup dashboard** — progress, status, and logs while a run is
  going, with a layout that fits narrow popup widths.
- **License protected** — the tool activates with a LicenseWala
  subscription license key and locks automatically when the license
  expires, is revoked, or is blocked by the administrator.

## Installation

1. Download this repository (Code → Download ZIP) and extract it, or
   clone it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the extracted folder.
5. Click the extension icon, activate it with your LicenseWala license
   key, import your Excel list, and start.

> Manual installs do not auto-update. After a new release, download the
> new version and reload the extension from `chrome://extensions`.

## Incognito mode

The tool also works in Incognito windows:

1. Open `chrome://extensions`, find this extension, and turn on
   **Allow in Incognito**. (Chrome keeps this off by default, and no
   extension can turn it on by itself.)
2. That's it — the license you activated in a normal window works in
   Incognito too, because the extension shares one license state
   (`"incognito": "spanning"` in the manifest).

## License activation

A valid **LicenseWala subscription license** is required. Keys are
issued from the LicenseWala portal
([licensescript.netlify.app](https://licensescript.netlify.app/)).

- Enter your key in the popup → **Activate**.
- The key is verified online against the LicenseWala server, together
  with an anonymous device identifier (one device per license).
- The license is re-verified every 30 minutes during runs, and the run
  is gated on a valid license before it starts. If the license expires,
  is revoked, or is blocked by the administrator, the tool locks
  immediately and shows a renewal prompt.
- Network problems do not lock you out instantly: a short grace period
  (max 24 hours from the last successful verification) covers temporary
  outages.

## Privacy

- Your work lists and run logs are processed on the CDCMS portal pages
  only; they are stored locally in your browser.
- No data is sold, no advertisers, no third-party tracking.
- Only the license key and an anonymous device identifier are sent to
  the LicenseWala server, solely for license verification.

## Project layout

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest (permissions, content scripts, popup). |
| `popup.html` / `popup.js` | Toolbar popup: license activation, Excel import, run controls, logs. |
| `content.js` | Automation on the Cash Memo Cancellation and Delivery Confirmation pages. |
| `inject.js` | Page-context bridge for portal interactions. |
| `xlsx.full.min.js` | Bundled Excel reader (do not modify). |

No build step. Edit the files and reload the extension.

## Changelog

### v1.1.1

- License hardening: popup license cache trust reduced from 12 hours
  to 1 hour, runs are gated on a valid license before starting, and
  content scripts re-verify every 30 minutes during runs (a
  server-invalid verdict stops the run).

### v1.1.0

- License verification moved to LicenseWala — the old placeholder
  setup (dummy Supabase URL, localhost fallback, and a sandbox mode
  that activated any key) is removed entirely.
- Fixed the 50+ run stall: the punch path had no handler for a slow
  row-add step, so runs froze forever. Items now fail with an error
  and the run advances.
- Batch-submit failures no longer silently skip 20 items (rewind and
  retry once, then per-item errors); cancel-path infinite retries
  fixed; configured delays honoured.
- Design polish: popup grid overflow, header truncation, log table
  layout, narrow-screen clamping, and focus rings.

### v1.0.0

- Initial release: bulk cash memo cancellation and delivery
  confirmation/punching on CDCMS, with Excel import.

## Support

- License keys and subscriptions: [LicenseWala portal](https://licensescript.netlify.app/)
- WhatsApp: [+91 75649 48617](https://wa.me/917564948617)
- Email: [life.rahulg@gmail.com](mailto:life.rahulg@gmail.com)

---

Built for LPG distributors running HP Gas CDCMS.
