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
| Background task blocked | A Windows/company Task Scheduler policy may prohibit registration. Read the displayed PowerShell error. Use Start.cmd manually or ask the local administrator to review policy. No UAC elevation or credential collection is implemented. |
| ZIP does not run on another architecture | This portable release is Windows x64 only. ARM64 Windows may use x64 emulation but has not been validated; 32-bit Windows is unsupported. |
| State file unreadable | Stop the app and restore a secure full-folder backup. The app deliberately does not replace a damaged file with a new empty state. |

Private logs are `%LOCALAPPDATA%\WhatsAppAuto\startup.log` and `error.log` when launched with Start.cmd. They intentionally omit message content and credentials. Redact paths/account identifiers before sharing diagnostics. Do not attach the private state or auth folder to bug reports.
