# Troubleshooting

| Symptom | What to check |
| --- | --- |
| Start.cmd reports an error | Extract everything first. Use a writable local folder. Windows security policy may block downloaded executables/scripts; review the ZIP/runtime hashes and organizational policy. No administrator installation is normally required. |
| Port is occupied | Do not stop the unknown listener. Use Status.cmd for this app, or launch `scripts/manage.ps1 -Action Start -Port 4319`; use the same port/data directory for its background registration. |
| Browser says forbidden Host | Use `http://127.0.0.1:4318`, not localhost or a machine hostname. Do not use a proxy. |
| App already running | Use Start.cmd to reopen the owned running process. A second independent CLI start against its state is refused. |
| Data directory “already in use” after crash | Check whether the PID in instance.lock belongs to a live process. The app removes the lock automatically only when that PID no longer exists. Never delete a lock while the app is active. A reused unrelated PID fails conservatively; an operator may inspect and remove only the stale instance.lock after verifying no app process uses that directory. |
| Incorrect password | Verify the local password. API token is different. Five wrong attempts trigger a one-minute cooldown. There is no default admin password. |
| QR does not appear | Use live mode, enter the expected international account, then click Connect. Check internet/firewall. No WhatsApp session is required before pairing. |
| Wrong account error | Check the expected number format and the phone's actual WhatsApp account first. In 1.0.1, use `66` plus a Thai mobile number without its leading `0`, no `+`; save and manually Connect again, retaining the session initially. In 1.0.2, Thai `06/08/09` 10-digit mobile forms and optional `+` international forms normalize automatically, including saved settings. Do not unlink/reset just because the message appears. If the canonical account is genuinely different, choose the intended expected account or deliberately unlink/reset and pair the approved account. |
| Account phone cannot be verified / LID | LID digits are opaque identifiers, not phone numbers. The app requires an exact phone-number JID from the authenticated account identity or its explicit PN field; it never compares suffixes or treats raw LID digits as a phone. Check the phone's account and retry while retaining the session initially. An unavailable identity remains blocked safely. |
| Logged out | Unlink/remove stale device on the phone and reset the local session before pairing anew. |
| Background app starts but does not connect | Auto-resume defaults off. First connect and confirm the expected live account, then enable the Thai automatic-resume option in Settings. Disconnect/reset/mode or account change disables it. Missing/expired/mismatched/unconfirmed sessions require manual Connect; unattended QR/pairing is blocked. |
| Group/contact missing | Click refresh after connection. Only participating groups and synced/observed contacts are known; full historical phonebook/history synchronization is not promised. You can add a verified international phone JID manually. |
| Send is refused | Connect the provider, verify active mode, allow the destination in that mode, check payload size and use a valid unique idempotency key. A demo allowlist does not authorize live sends. |
| Submission unknown | Inspect the WhatsApp destination. Do not blindly resend or change idempotency key. An affected job pauses. A returned message ID means submitted, not delivered. |
| Job did not send | App/machine must be awake and connected; verify enabled state, job mode, destination, timezone and due time. Preparation failures pause after three attempts. Inbox tasks need new non-own/non-history messages after save; old data is skipped. |
| JSON source fails | Add the exact public hostname. Only public HTTPS GET port 443, no URL credentials, redirects or headers, valid JSON up to 1 MB, 10-second timeout. Narrow large rendered outputs to specific fields. |
| Latest-file job waits | Check the folder on the machine running the app, Windows permissions, extension filter, newest matching file size and stability age. Cache OneDrive files with Always keep on this device. The app waits instead of silently sending an older report. See LATEST-FILE.md. |
| File job skips a document | Changed-version suppression defaults on. The same path/content version already recorded for this job/destination/mode is skipped, including an unknown attempt. Inspect the prior result before deliberately enabling repeat sends. |
| File task cannot enable/run | Click preview for the same saved/intended configuration, inspect filename/caption and use it within five minutes. Changing fields invalidates preview. A missing/unavailable file cannot produce approval. |
| Caption year is wrong | Use BB/BBBB for Buddhist year; YY/YYYY are Gregorian. Check the job timezone and default actual-run date basis. DD.MM.BB produces dates such as 20.11.69 for November 2026. |
| Background task blocked | A Windows/company Task Scheduler policy may prohibit registration. Read the displayed PowerShell error. Use Start.cmd manually or ask the local administrator to review policy. No UAC elevation or credential collection is implemented. |
| ZIP does not run on another architecture | This portable release is Windows x64 only. ARM64 Windows may use x64 emulation but has not been validated; 32-bit Windows is unsupported. |
| State file unreadable | Stop the app and restore a secure full-folder backup. The app deliberately does not replace a damaged file with a new empty state. |

Private logs are `%LOCALAPPDATA%\WhatsAppAuto\startup.log` and `error.log` when launched with Start.cmd. They intentionally omit message content and credentials. Redact paths/account identifiers before sharing diagnostics. Do not attach the private state or auth folder to bug reports.

## Multi-file and session-age outcomes

- Fewer files than requested: the count is a maximum, restricted by the newest matching file’s calendar date in the job timezone unless across-days is selected. The preview reports shortfall; older days are not silently added. Already-recorded versions may reduce actual sends further.
- Batch paused/unknown: inspect the recipient first. Open the job’s pending-batch dialog and explicitly skip reviewed unknown items to send only never-started items, or cancel the remainder. Unknown items are never replayed by resume. A completion with reviewed unknowns does not assert delivery of those items.
- Pending snapshot unavailable/corrupt: the job pauses; it never rereads a changed source as a replacement for the frozen plan. Restore a consistent full-folder backup or explicitly cancel after reviewing receipts.
- TXT waits/fails: use a nonempty UTF-8 file (optional BOM), at most 65,536 bytes, no NUL, and final output at most 16,000 characters. Convert legacy ANSI/UTF-16 explicitly; the app does not guess encodings or truncate content.
- Session age unknown: normal for a session paired before observation was introduced. Reconnect is not fresh pairing. Preserve a working session; do not reset solely to get an age.
- No age reminder: opt in, choose an allowed live destination, keep the app connected and wait for the minute check. Unknown or submitted reminders are not repeated. The warning is a maintenance heuristic, not an official expiry. See SESSION-AGE.md.
