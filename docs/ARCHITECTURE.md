# Architecture and verification

## Runtime

One Node 24 ESM HTTP process binds only `127.0.0.1`. A fixed static asset map serves the Thai UI, compiled Tailwind CSS and own SVG icons. There is no static directory traversal, CDN/font request, database or frontend runtime. `scripts/build.mjs` compiles Tailwind locally; release dependencies exclude build/test tools.

- `src/server.mjs`: exact Host/Origin and browser fetch boundaries, password/session and bearer API auth, validation and routing.
- `src/security.mjs`: timing-safe secret comparison, scrypt password hash, JID/file checks and DNS-pinned public HTTPS JSON fetch.
- `src/phone.mjs`: canonical expected-phone normalization and exact account PN extraction, rejecting raw LID identifiers and conflicting phone fields.
- `src/store.mjs`: private data directory, exclusive instance lock, queued atomic temp-file rename, persisted run crash recovery. Unreadable state fails closed instead of being silently replaced.
- `src/provider.mjs`: demo/live adapters; Baileys loaded only for live connect; QR and account validation; generation guards on stale sockets/group results; bounded reconnects; bounded incoming message capture with sequence numbers; document/text send and observed delivery updates.
- `src/jobs.mjs`: timezone scheduling, template rendering, incoming-source cursor, persisted attempts and global send lane.
- `public/app.js`: dependency-free UI, escape of untrusted content, local fetch wrapper, responsive navigation and beginner onboarding.
- `public/api-examples.js`: local-origin API examples, current-mode approved recipient selection and PS5-compatible masked token prompts. The build inlines its definitions into app.js so no additional runtime request is required.
- `scripts/manage.ps1`: hidden Windows launcher, per-user mutex, data-folder ACL, exact process ownership validation, optional Task Scheduler registration.

The state JSON is not a relational database and does not create tables, run migrations or contact an HR system. Demo and live destinations/jobs/messages are isolated. Changing mode or account pauses all jobs and disables auto-resume. Startup connection defaults off. After a successful manual connection, a user may explicitly opt in to resuming the confirmed expected live account on future starts; enabled jobs then continue once the provider is ready.

Auto-resume reads only the existing private credential file first and requires `registered: true`, a phone JID matching the configured expected number, and the persisted account confirmation from an earlier successful connection. It rechecks loaded credentials before constructing a socket, retains generation guards, and validates the actual connected sender before exposing ready state. It never creates a socket for an unpaired/mismatched preflight and never exposes unattended QR: a QR-required/logged-out/wrong-account result disables resume and requires manual intervention. No demo fallback exists. Explicit Disconnect or local session reset disables resume; process shutdown preserves opt-in. Network failures retain bounded retry behavior, without pairing fallback.

Expected settings canonicalize Thai 10-digit mobile `06/08/09` national forms to country code 66; optional `+` and simple formatting separators are accepted. Other international numbers are preserved and unsupported local forms are rejected. Existing saved expected settings normalize during load, without editing `auth/` or manufacturing verified confirmation from an old local string. Both manual and resume guards extract exact international phone JIDs (`s.whatsapp.net`, legacy `c.us`, optional device suffix). A LID remains opaque and needs a separate explicit PN-JID field in the same provider account identity. Missing or conflicting PN identity is rejected. No raw-digit, suffix or partial-account comparisons occur.

## Send lifecycle

`prepare → reserve lane → persist submitting attempt + source cursor + next slot → invoke provider → persist simulated/submitted/unknown`.

The lane is reserved before scheduled preparation and held through commit/result so an API send cannot consume its slot. API keys are fingerprinted with target, payload and mode. Identical repeats return their existing receipt; changed content conflicts. A task lock and a tick guard prevent overlap. Only preparation can retry (1-minute, 2-minute then pause). Once provider invocation may have happened, there is no automated retry. A process restart converts persisted `submitting` to `unknown`; the due slot/source cursor were already persisted, so that slot does not replay. Persisted jobs with unknown result are paused during recovery. Delivery updates are opportunistic observations, not a delivery guarantee.

Disconnected/connecting providers are a wait state: ticks and preparation leave due slots/cursors/retry counters unchanged. A readiness recheck after asynchronous rendering catches an offline transition before commit. If disconnection happens during the commit save but before provider invocation, the receipt is `not_submitted` and the job's slot/cursor are restored. A subsequent scheduled preparation uses a fresh deferred-attempt suffix because source data/time may change; API calls can retry the same key and identical content. This safe retry applies only when the provider was never invoked, never to ambiguous provider errors/timeouts.

Inbox jobs ignore own/history items, disallow equal source/destination and process oldest unconsumed receive-sequence batches. Each batch includes at most 20 messages fitting the rendered limit; only included sequences advance the cursor. This prevents same-second ties and silent batch dropping. Message retention remains bounded and can discard unprocessed old input; this is documented as a convenience summary rather than a guaranteed message transport. Multiple separate jobs can intentionally consume the same source independently. They cannot echo messages sent by this app because own messages are excluded.

## Trust boundaries

Browser sessions are random HttpOnly SameSite=Strict cookies, expire after 8 hours, live only in process memory, and require exact application Origin for mutations. API tokens are random persisted 256-bit secrets, revealed only by signed-in browser + password confirmation. Neither token nor password hash appears in ordinary state/export responses. Passwords use salted scrypt; wrong-password attempts have a five-attempt one-minute cooldown. No request payload/QR/session-secret logging is enabled.

The launcher restricts private directory ACLs. Direct CLI users must protect their own directory. Windows account compromise, administrators, same-user malware, disk theft without OS encryption, filesystem tampering and compromised upstream WhatsApp/npm infrastructure remain outside the application boundary. Local HTTP is chosen for loopback-only use; remote reverse proxies, LAN binding and multi-user server hosting are unsupported.

## Automated checks

Run `npm test` after `npm ci`, `npm run build` and `npx playwright install chromium`.

`test/core.test.mjs` covers validation and secret hashing, blocked local/DNS-rebinding JSON targets, timezone scheduling, request idempotency, changed-payload conflict, no missed-interval burst, own/history exclusion, JSON own-property paths, bounded preparation retry, unknown-result and timeout non-replay, task overlap, 21 equal-timestamp messages, competing API-vs-inbox commit, exclusive state locking, crash receipt recovery, Baileys import, and a real loopback HTTP synthetic end-to-end flow including text/file sends/jobs/export/restart/mode isolation.

`test/browser.test.mjs` runs headless Chromium through real local HTTP: initial password setup, demo connect, destination approval, Thai text and attachment send, job preview/create/manual run, inbox/history, desktop/mobile screenshots, overflow check, mobile logout visibility, and a live-mode settings transition **without connecting**. It checks page errors. Private test state is created under the OS temp folder and removed; screenshots contain synthetic data only.

`test/resume.test.mjs` uses injected fake Baileys module/socket functions and synthetic credential files. It covers default/opted-out/demo startup, missing/unpaired/unconfirmed/mismatched/LID credentials, session swaps after preflight, unattended QR suppression, logout/wrong sender, opted-in restart and due jobs, persistent opt-out after intentional Disconnect, and settings/reset gates. It never invokes the real live adapter or sends to WhatsApp.

`test/phone.test.mjs` covers Thai/local/international formats, rejection of unsupported local/invalid forms, exact phone identity versus LID, device suffixes, conflicting fields, same/different/unverified manual account, saved local-setting migration without auth changes, confirmed-account resume and equivalent-format settings that preserve an existing session. Tests use only synthetic fixtures and injected modules.

`test/api-examples.test.mjs` verifies prompted defaults, exact selected contact/group literals, invalid/unallowed targets, safe origin and allowlist/mode scope changes. `test/api-ui.test.mjs` verifies actual browser clipboard output (allowing Windows CRLF conversion), empty/current-mode-only recipient selection, HTML escaping, no send merely from copy, and reset after allowlist/mode change. It executes the copied PowerShell through Windows PowerShell 5.1 against an isolated demo server, including masked-token input replacement, Thai/quoted message text and a same-key retry. It also submits the displayed HTTP JSON body and confirms idempotent receipts. No real user token, account or WhatsApp send is used.

No automated check pairs an account, contacts WhatsApp, sends to a real person/group, installs persistent startup registration, or modifies HR. A dependency import and synthetic tests do not establish live WhatsApp interoperability. Follow `LIVE-ACCEPTANCE.md` with authorized recipients for that final boundary.

Primary references: [Baileys quick start](https://github.com/WhiskeySockets/docs/blob/main/quickstart.mdx), [Baileys group implementation](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/groups.ts), [Tailwind Node package](https://github.com/tailwindlabs/tailwindcss/tree/main/packages/%40tailwindcss-node), [Node releases](https://nodejs.org/dist/v24.20.0/), [Task Scheduler cmdlets](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/).
