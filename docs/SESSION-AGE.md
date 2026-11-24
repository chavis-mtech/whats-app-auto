# Linked-session age and optional reminder

The connection page shows days since an objectively observed fresh QR pairing. At **10 elapsed 24-hour days**, it displays a Thai warning that the session **may disconnect**. This is a local maintenance reminder, not an official WhatsApp expiration date or a prediction of when a device will disconnect. Changing timezone or crossing daylight-saving time does not change elapsed age.

Existing sessions show **unknown age** until a fresh pairing is objectively observed by this app. The app does not infer age from credential-file timestamps, installation time, account creation or a normal reconnect. Keep a working legacy session; there is no need to unlink it solely to obtain an age.

Evidence requires this app to observe a fresh manual QR, pair-success/isNewLogin with signed identity and the verified expected phone account, followed by a matching authenticated open. The pair-success timestamp is persisted before open, so a delayed reconnect or process restart does not move the start date. Incomplete or conflicting identity evidence remains unknown. Routine reconnects preserve the original date. Local session reset clears age and disables reminders.

## Enable a WhatsApp reminder

In **ตั้งค่า**, explicitly enable the session-age notification and choose a destination already allowed in **live mode**. No recipient is selected automatically. Save the settings. Merely viewing the warning does not send anything. A demo allowlist does not authorize a live reminder.

The app checks about once per minute while running. At the threshold, a connected live provider submits one fixed Thai reminder per recorded pairing and destination. The message qualifies that age is not a WhatsApp-confirmed expiry. Reminders share the normal send lane and durable idempotency ledger with jobs and API sends. Opting out, changing destination/account/mode, removing the allowance or resetting the session is checked again before provider invocation.

Offline checks wait without consuming the reminder. A proven `not_submitted` result may retry after readiness returns. A submitted or ambiguous `unknown` result is never automatically repeated, including after restart or switching away from and back to the same destination. Inspect WhatsApp after an unknown result. A newly selected allowed destination is a separate explicit notification intention. No recipient delivery is guaranteed, and an already disconnected session cannot notify through WhatsApp until it reconnects.

The private state stores only the observed pairing metadata and reminder receipts in addition to existing credentials. Protect full-folder backups. Never publish `state.json`, `auth/`, pending outbox contents, real account identifiers or screenshots containing them.
