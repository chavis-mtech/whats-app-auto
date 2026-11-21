# WhatsApp Auto

A private, local Windows workspace for WhatsApp, with a clean Thai interface, a REST API and persistent scheduled messages. One Node process serves both the UI and API. Tailwind CSS is compiled locally; there is no CDN, separate frontend service, database, Docker requirement or cloud account.

## Start in three steps

1. Extract `WhatsAppAuto-1.0.3-win-x64.zip` into a normal writable folder. **Extract everything first**; do not run from inside the ZIP. The release already contains Node 24.20.0, compiled CSS and runtime dependencies. No Node installation, terminal or build is required.
2. Double-click **Start.cmd**. Open [the local workspace](http://127.0.0.1:4318). Create a local password of at least 12 characters. The launcher starts a hidden process; closing the browser does not stop it.
3. Click **เปิดพื้นที่สาธิต**. Add a sample destination from **ผู้ติดต่อและกลุ่ม**, then try **ส่งข้อความ** or **งานอัตโนมัติ**. Demo messages never leave this application.

Use **Stop.cmd** to stop the app, **Status.cmd** to check it, **Install-Background.cmd** to register startup at Windows sign-in, and **Uninstall-Background.cmd** to remove that registration. Installation is per Windows user and does not install a Windows service. Start the app separately after installation. A company policy may block Task Scheduler registration; the app still works through Start.cmd. Background registration points to the extracted folder: reinstall it after moving the folder.

Automatic connection is **off by default**. To resume unattended after Windows sign-in, first pair manually and verify the expected live account, then enable **เชื่อมต่อบัญชีเดิมอัตโนมัติเมื่อเปิดแอป** in Settings and install background startup. On subsequent process starts, only that previously confirmed, registered linked session may reconnect; enabled jobs can send once it is connected. The app never starts unattended pairing or shows a QR during automatic resume. Missing, expired, logged-out or mismatched credentials disable automatic resume and require manual Connect/pairing. No fallback to demo occurs.

Clicking **Disconnect**, resetting the local session, or changing mode/account **disables automatic resume**. Stop.cmd/process shutdown preserves an existing opt-in so the next start can resume. To stop future unattended sends, pause jobs or use Disconnect before stopping. With automatic resume off, manually click Connect after each restart.

## Features

- Password-protected Thai UI with desktop/mobile layouts and an in-app beginner guide.
- Separate demo and live destinations, messages, contacts and jobs.
- QR linked-device connection, expected account check, default-off automatic resume of a confirmed existing session, bounded reconnect attempts, local session reset, participating groups and synced/observed contacts.
- Read captured text and attachment metadata, send text or a document up to 10 MB.
- A destination allowlist, one-time/interval/daily schedules, IANA timezones and template preview.
- Templates from fixed text, newly observed incoming WhatsApp text, or an allowlisted public HTTPS JSON endpoint.
- Atomic JSON persistence, single-process data lock, global send serialization, durable request IDs and a conservative unknown-outcome policy.
- Browser session isolation from REST bearer authentication, token reveal/rotation with password confirmation, password change, local data export and message clearing.
- Copyable PowerShell/HTTP/JSON examples with a prompted target or explicit current-mode approved contact/group, masked token prompt and UTF-8 Thai message support. Copying does not send.

## Connect a real account

1. Use a dedicated test account and an explicitly approved test recipient first.
2. In **ตั้งค่า**, select live mode and enter the expected account. Version 1.0.3 accepts a Thai 10-digit mobile number beginning `06`, `08` or `09`, or an international number with an optional leading `+`. The app stores canonical international digits: Thai `09…` becomes `669…`, never `6609…`. Other international country numbers retain their country code; unsupported local formats are rejected. Save. Changing to a different canonical account disconnects and pauses jobs; equivalent formatting does not invalidate a confirmed session.
3. Open **เชื่อมต่อ WhatsApp**, click Connect, then use WhatsApp on the phone → Linked devices → Link a device → scan the QR. The QR is private and expires/refreshes with WhatsApp.
4. After connection, refresh groups and allow only the intended recipient. A full phone address book is not available: contacts are only those synced or observed. Group listing contains participating groups the provider can retrieve.
5. Send a unique, synthetic text; check the destination on the phone. Then send a synthetic document. Follow [live acceptance](docs/LIVE-ACCEPTANCE.md) before enabling real schedules.

This app uses **Baileys 7.0.0-rc14**, an unofficial WhatsApp linked-device library, not the official Meta Cloud API. It is a release candidate and protocol changes can break it. Account restrictions and WhatsApp terms apply. Meta offers official business messaging APIs, including a Groups API with eligibility/access constraints; those APIs are a different integration and are not implemented here. This app is not affiliated with WhatsApp or Meta.

If version 1.0.1 reported an account mismatch after a Thai local number was entered, correct the expected setting to `66` plus the number without its first `0` (no `+` in 1.0.1), save and try Connect again **before deleting/unlinking the session**. Version 1.0.3 normalizes saved settings on startup without deleting credentials. It never converts a legacy local-number “confirmation” into trusted identity. A different or unverifiable account remains blocked; check the actual phone account if canonical formatting does not resolve it. The adapter uses exact phone-number JID fields, not numeric LID identifiers or suffix matches.

## Schedule behavior

Create/edit a task in **งานอัตโนมัติ**. New tasks are paused unless the enabled checkbox is selected. Choose:

| Source | Behavior |
| --- | --- |
| Fixed text | Sends the template as written. `{{now}}` inserts an ISO UTC timestamp. |
| Incoming WhatsApp | `{{data}}` contains newly captured, non-history, non-own incoming text from the selected source JID. New/edited tasks start from the current receive sequence. Source and target must differ. At most the earliest 20 messages fitting the 16,000-character output limit are consumed per run. Equal timestamps are handled by persisted receive sequence. No media forwarding occurs; attachment names appear as metadata. |
| JSON API | Fetches a public HTTPS JSON URL. Add its exact hostname in settings first. `{{data}}` renders JSON; `{{json.total}}` or nested own-property paths render a field. Oversized output fails before submission. No arbitrary code, request headers, redirects, local network requests or authentication secrets in URLs are supported. |

Draft preview uses currently stored messages for an example; saving a new/edited inbox task starts with **future** incoming messages. Retention is bounded (default 500 messages across modes); input removed by retention, manual clearing or disconnected periods cannot be processed. Use a suitable retention and interval for the expected volume. The inbox feature is a convenience summary, not a durable message broker or complete WhatsApp archive.

Interval schedules run after the chosen number of minutes; daily schedules use the job's IANA timezone. One-time input in the UI uses the computer's local timezone and is stored as UTC. Missed intervals are coalesced into one run after the process and provider return. No burst of all missed runs occurs. While disconnected/connecting, tasks wait without using their retry budget or advancing their due slot. Once connected, other preparation failures retry after 1 and 2 minutes, then pause after the third failure. The application never retries a provider submission automatically.

| Result | Meaning and action |
| --- | --- |
| `simulated` | A demo operation, stored locally only. |
| `submitted` | Baileys returned a message ID. This is **not** confirmation that the recipient received or read it. Delivery/read updates may later be observed while connected. |
| `unknown` | Timeout, provider error or interrupted process before the result was saved. Inspect WhatsApp and the recipient before deciding whether to create a **new** request. Affected scheduled jobs pause. No automatic replay occurs. |
| `preparation_failed` | No provider call was made; check connection, allowlist, JSON source, size or storage. |
| `not_submitted` | The connection disappeared before provider invocation. No send was attempted; the job keeps its original slot/cursor for a safe later preparation. An identical API send key may be retried. |

Idempotency prevents the app from replaying a saved request key, including after restart; it cannot provide exactly-once delivery across WhatsApp and a local filesystem. Do not delete/edit the ledger to “retry.” A crash between committing an attempt and invoking the provider can conservatively produce `unknown` even if nothing was sent.

## Private data and maintenance

Default state is `%LOCALAPPDATA%\WhatsAppAuto`, separate from the extracted app. The launcher restricts the folder ACL to the current user, SYSTEM and administrators. State and linked-device credentials are plaintext protected by the local account/Windows disk security; they are not encrypted by this app. Other programs running as the same user are outside this trust boundary.

| Path in private folder | Purpose |
| --- | --- |
| `state.json` | Settings, password hash, API token, destination allowlists, jobs, run ledger, contacts and captured messages. |
| `auth\` | Baileys linked-device credentials. Never share or publish. |
| `instance.lock` | Prevents two app processes using one state folder. A stale lock is checked against its recorded PID. |
| `launcher.json` | Launcher process ownership and port. |
| `startup.log`, `error.log` | Minimal startup diagnostics. No message content, QR, password or API token is intentionally logged. |

Before upgrading or backing up, stop the app. Back up the **entire private directory** to a secure location, then extract the new app separately. Do not run two versions against one directory. Export JSON from the UI contains message content and metadata but excludes the password hash, token and linked-device credentials; it is an inspection export, not a restorable backup. The current-mode export and UI show at most 300 recent runs/messages. The full idempotency ledger stays in private state and has a safety cap of 10,000 attempts. At that cap, sending stops; use a separately planned secure archival/migration before continued operation. No destructive ledger-reset button is provided.

Changing the browser password invalidates sessions. Restart also invalidates browser sessions. An API token remains valid until rotated. Forgotten password recovery requires stopping the app and restoring a known secure backup or starting a new private data directory; there is no insecure default/recovery password. A fresh directory requires pairing again and does not inherit old idempotency protection.

Deleting the local session pauses all jobs; also unlink this device in the WhatsApp phone app. Deleting local files alone does not necessarily unlink it on the phone. Uninstall background startup and stop the app before deleting the extracted application. Private data is deliberately retained until you choose to remove it.

## Developer workflow

```powershell
npm ci
npm run build
npx playwright install chromium
npm test
npm start
```

Node 24.x is required. `npm run build` compiles local Tailwind CSS; `npm start` uses the same one-process server as the release. No Vite development server is needed. To choose a different isolated private folder or port:

```powershell
$env:WAA_DATA_DIR = 'C:\MyPrivateTest\WhatsAppAuto'
$env:WAA_PORT = '4319'
npm start
```

The Windows launcher supports `-DataDirectory`, `-Port`, `-NoBrowser`, and `-Action Start|Stop|Status|Install|Uninstall` through `scripts/manage.ps1`. Default `.cmd` files use port 4318. Port collisions fail without altering the existing service. Open the app as `127.0.0.1`, not `localhost`, because Host/Origin checks are exact. Do not proxy or expose it to a LAN/public network.

`npm run release` creates a clean portable stage and ZIP in `release\`, installs only locked production dependencies without install scripts, validates the official Node ZIP SHA256, includes the Node license and file-hash manifest. An existing stage/ZIP is not overwritten. It does not install background tasks, connect WhatsApp, run migrations, publish or upload anything.

See [API](docs/API.md), [architecture and tests](docs/ARCHITECTURE.md), [troubleshooting](docs/TROUBLESHOOTING.md), [live acceptance](docs/LIVE-ACCEPTANCE.md), and [third-party notices](THIRD-PARTY-NOTICES.md).
