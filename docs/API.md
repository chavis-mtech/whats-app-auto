# Local REST API

Base URL: `http://127.0.0.1:4318/api`. All application routes require `Authorization: Bearer <token>` or the authenticated local browser cookie, except health/auth/setup/login. No CORS access is granted. Browser mutation requests require an exact Origin; command-line bearer clients can omit Origin. Tokens are revealed/rotated only in a signed-in browser after password confirmation.

Send `Content-Type: application/json` for JSON bodies. Errors use an HTTP status and `{ "error": "message" }`: 400 validation, 401 authentication, 403 forbidden host/origin/recipient, 404 missing resource, 409 busy/conflict, 413 size, 415 content type, 429 login cooldown, 500 internal operation failure.

## Authenticate and inspect

Reveal the token from **เชื่อมต่อ API** in the UI; never hardcode it into source.

```powershell
$secureToken = Read-Host 'Local API token' -AsSecureString
$token = [Net.NetworkCredential]::new('', $secureToken).Password
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod 'http://127.0.0.1:4318/api/state' -Headers $headers
Invoke-RestMethod 'http://127.0.0.1:4318/api/groups' -Headers $headers
```

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/health` | Public app/version health only. |
| GET | `/auth` | Public setup/authenticated booleans; no secrets. |
| POST | `/setup`, `/login` | Local browser password flow. Setup is available only before a password exists. Password length 12–128. |
| POST | `/logout` | Invalidates the current browser session. |
| GET | `/state` | Current mode's UI state; no secrets. Recent 300 runs/messages. |
| PUT | `/settings` | Complete `{mode, timezone, allowedHosts, retention, expectedPhone, autoResume}`. `expectedPhone` accepts a Thai 10-digit mobile `06/08/09` national form or international digits with optional `+`; it is stored as international digits. Different canonical accounts pause jobs/disconnect/disable resume; equivalent formatting does not. `autoResume` defaults false; enabling requires a successfully connected/confirmed expected live account. Retention 50–5000. |
| POST | `/connect` | Explicit connection; demo initializes synthetic samples, live starts QR flow. |
| POST | `/disconnect` | Disconnects the provider and disables startup auto-resume. Does not revoke linked-device credentials. |
| DELETE | `/session` | Pauses all jobs, disables startup auto-resume, clears confirmed account and removes local linked-device credentials. Also unlink on the phone. |
| GET | `/qr` | Authenticated private SVG of currently available QR; otherwise 404. |
| GET | `/contacts` | `{scope,items}` from sync/observation; never claims the full address book. |
| GET | `/groups` | Current participating-group cache. |
| POST | `/groups/refresh` | Refresh participating groups while connected. |
| GET | `/messages?jid=...` | Captured current-mode messages; optional exact JID filter, up to 300 recent entries. Media is metadata only. |
| DELETE | `/messages` | Clears local message capture across modes; never deletes WhatsApp messages or the run ledger. |
| POST | `/targets` | Allow `{jid,name}` in the current mode. A phone JID is `internationaldigits@s.whatsapp.net`; use actual discovered group/LID values. |
| DELETE | `/targets/:encodedJid` | Removes current-mode destination and pauses jobs that use it. |
| POST | `/send` | Text or base64 document. Requires `Idempotency-Key`. |
| GET/POST | `/jobs` | List/create current-mode jobs. Maximum 200 across modes. |
| PUT/DELETE | `/jobs/:id` | Replace editable job fields/delete. Editing resets inbox cursor to now. |
| POST | `/jobs/preview` | Draft fields → `{text,skip,cursor}`. Does not send. Draft inbox preview can use current stored messages. |
| POST | `/jobs/:id/run` | Explicit immediate run, even for paused jobs. File tasks require a fresh same-config `previewToken` in the JSON body. Each deliberate call is a new manual attempt; do not auto-retry this endpoint after a timeout. |
| POST | `/jobs/:id/toggle` | Enable/pause. Rejects expired one-time dates. To enable a file task, use preview + PUT instead. |
| GET | `/runs` | Recent 300 run receipts across modes; UI filters to the active mode. No request key/hash is exposed. |
| GET | `/export` | Current-mode inspection JSON attachment; no token/hash/password/credentials. Not a backup. |
| POST | `/token` | Browser-only `{password,rotate:false}` reveals token; true rotates immediately. |
| PUT | `/password` | `{current,password}` changes password and invalidates sessions. |
| POST | `/demo/incoming` | Demo-only synthetic `{jid,text}` injection; forbidden in live mode. |

## Send text with idempotency

Allow the recipient and connect the provider first. Use a new key for a new intended message. Reusing a key with identical payload returns its persisted receipt without submitting again, even if disconnected after restart. Changed content with the same key returns 409. Keys remain reserved in the ledger; do not recycle them.

For the simplest test, open **เชื่อมต่อ API** in the app:

1. Use demo mode first, connect it and allow a synthetic contact/group in **ผู้ติดต่อและกลุ่ม**.
2. Leave the example recipient blank to be prompted for its JID in PowerShell, or explicitly select one of the current mode's allowed contacts/groups. The app never selects a live recipient by default. Selection resets when the mode or allowlist changes.
3. Click **คัดลอก PowerShell**, open Windows PowerShell 5.1 or later and paste the snippet. Enter the API token at its masked prompt, the recipient JID if prompted, and a test message (Thai is supported). The snippet converts JSON to UTF-8 bytes. Names and typed message content are not injected into executable code.
4. Copying only changes the clipboard. Running the script submits a request in the current application mode; live mode sends to the selected/typed approved destination. Check its returned receipt and the app history. The generated URL uses the actual page port, including a custom port.
5. To revisit the **same request**, run only `Invoke-RestMethod @request` again in the same PowerShell window. That retains the same headers, Idempotency-Key and body. Do not paste/run the whole snippet again as a retry: it generates a new key. An `unknown` outcome must be inspected before deciding on a new intended send. A new message needs a deliberately new key.

**คัดลอก HTTP** provides the real POST URL, headers and JSON schema for a REST client; replace `<token>` and `<unique-key-keep-for-retry>`. **คัดลอก JSON** copies only the `{target,text}` payload. With no selected recipient its target is `<recipient-jid>`, which must be replaced before sending. Generated examples never include the user's actual token. A selected recipient inserts only its validated JID, not its display name.

```powershell
$target = Read-Host 'Recipient JID'
$text = Read-Host 'Message text (Thai supported)'
$key = [guid]::NewGuid().ToString()
$headers = @{ Authorization="Bearer $token"; 'Idempotency-Key'=$key }
$body = @{ target=$target; text=$text } | ConvertTo-Json
$request = @{
  Uri='http://127.0.0.1:4318/api/send'
  Method='Post'
  Headers=$headers
  ContentType='application/json; charset=utf-8'
  Body=[Text.Encoding]::UTF8.GetBytes($body)
}
Invoke-RestMethod @request
```

HTTP/JSON shape (use the actual port shown by your app):

```http
POST http://127.0.0.1:4318/api/send
Authorization: Bearer <token>
Idempotency-Key: <unique-key-keep-for-retry>
Content-Type: application/json; charset=utf-8

{
  "target": "<recipient-jid>",
  "text": "ทดสอบ API จาก WhatsApp Auto"
}
```

Example response (receipt fields vary):

```json
{"id":"receipt-uuid","name":"Manual/API","mode":"demo","status":"simulated","delivery":"unconfirmed","messageId":"demo-message-uuid"}
```

For live, `submitted` means the adapter returned a message ID; it does not assert a server ACK or recipient delivery. `delivery` may change to `delivered`/`read` from observed updates. `unknown` means inspect WhatsApp before deciding on a new send. Never blindly retry with a new key.

`not_submitted` is distinct: a readiness check proved the provider was never invoked after connection loss during local persistence. The same key and identical payload can safely be retried. Tasks restore their unconsumed slot/cursor and wait for connection without consuming preparation retries.

## Send a document

```powershell
$file = 'C:\TestFiles\synthetic.txt'
$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
$body = @{
  target='66800000001@s.whatsapp.net'
  file=@{
    base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
    fileName=[IO.Path]::GetFileName($file)
    mimetype='text/plain'
    caption='Synthetic document'
  }
} | ConvertTo-Json -Depth 4
$request.Body=[Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod @request
```

File payloads are decoded in memory and sent as a WhatsApp document, max 10 MB. File bytes are not persisted in application state. The complete JSON request limit is about 14.5 MB. Do not log base64 request bodies or tokens.

## Create a persistent job

```json
{
  "name": "Daily report",
  "target": "120363000000002@g.us",
  "source": "json",
  "url": "https://api.example.com/report",
  "template": "Total: {{json.total}}\nGenerated: {{now}}",
  "schedule": "daily",
  "time": "09:00",
  "timezone": "Asia/Bangkok",
  "minutes": 60,
  "enabled": false
}
```

POST that object to `/jobs`. `source` is `text`, `json` or `inbox`; inbox also requires `inboxJid` different from target. `schedule` is `interval` (minutes 1–10080), `daily` (HH:mm + IANA timezone), or `once` (`at` future ISO timestamp, including explicit offset or `Z`). Provide a nonempty template up to 12,000 characters. Rendered output must fit 16,000 characters; no silent JSON/message truncation occurs. Add `api.example.com` to `settings.allowedHosts` before preview or run. Exact hostname matching is used, not wildcards. Redirects and nonpublic addresses are refused, DNS answers are validated and one validated answer is pinned to the HTTPS request.

Templates support `{{data}}`, `{{now}}`, and own-property dot paths such as `{{json.report.total}}`. Missing values become empty strings, object values are JSON. There is no expression execution. Fetching is public HTTPS GET only, 10-second timeout and 1 MB response limit. URLs with embedded credentials are rejected. Authentication headers/private API gateways are not supported by this build.

Manual task execution is intentionally explicit and creates a distinct attempt per call. To build a retrying integration, use `/send` with a fixed Idempotency-Key after rendering your own data, or check `/runs` before a deliberate manual re-run. Busy responses occur before a provider call and are safe to revisit with the same send key.

## Latest-file task

```json
{
  "name": "Daily document",
  "target": "<approved-recipient-jid>",
  "source": "file",
  "folder": "C:/Reports/Daily",
  "extensions": [".pdf"],
  "settleSeconds": 30,
  "sendOnlyChanged": true,
  "dateBasis": "now",
  "dateLocale": "th-TH",
  "template": "Ai สรุปงาน <date.format(DD.MM.BB)>",
  "schedule": "daily",
  "time": "09:00",
  "timezone": "Asia/Bangkok",
  "enabled": false
}
```

POST the draft to `/jobs/preview`. A successful file preview returns `{text,file,previewToken}` with filename, size, modifiedAt, SHA256 and version fingerprint, never document bytes. An unavailable source returns `{waiting:true,reason}` without a token. Use the returned token in the same draft plus `enabled:true` when creating/replacing the job. It expires after five minutes and is consumed once; configuration/mode changes require another preview. Saving paused does not require it. A manual `/jobs/:id/run` likewise takes `{previewToken}` from a fresh preview of the saved configuration.

Extension filters accept an array or comma-separated string, normalize to lowercase dotted forms, and require 1–16 entries. `settleSeconds` is 5–3600. Dates use the job timezone; `dateBasis: "now"` means actual run/preparation time, while `"modified"` explicitly chooses the selected file timestamp. `BB` is two-digit Buddhist year, `BBBB` full Buddhist year and `YYYY` Gregorian year. `dateLocale` is `th-TH` or `en-GB` for textual month/weekdays. The file is sent as a single document with `caption`; a PDF uses application/pdf. Visual PDF thumbnails are client/provider controlled.

`waiting_for_file` preserves the due slot and failure budget; the connected scheduler revisits after 30 seconds. `file_unchanged` skips a previously recorded version for this job/destination/mode when `sendOnlyChanged` is true. File receipts include metadata/hash, not document bytes. Unknown submission rules remain unchanged. See [the full date/stability/OneDrive guide](LATEST-FILE.md).

## Multi-file plans and TXT source (1.0.5)

Latest-file drafts also accept fileCount (integer 1–10, default 1) and filePeriod ("latestDay", default, or "any"). latestDay means the newest matching modification date in the job timezone. N is a maximum; no older-day backfill occurs. Multi-file preview returns files[] metadata, selection {requestedCount,availableCount,day,shortfall} and previewToken, with no payload bytes. Single-file response retains file for compatibility. See LATEST-FILE.md for exact limits and stability semantics.

For latest TXT text use source: "fileText", folder and a template containing {{data}}. Extensions are forced to .txt and count to one. Strict UTF-8 input is limited to 65,536 bytes and output to 16,000 characters. Preview approval is required for enabling, toggling on or manually running both file and fileText sources. Saved paused drafts remain allowed.

Jobs with pendingBatch cannot be edited/deleted. POST /jobs/:id/resume-batch with {"reviewedUnknown":true} explicitly skips unknown items after operator review and sends only pending snapshots. It never retries unknown items. POST /jobs/:id/cancel-batch with {"confirm":true} cancels remaining items and pauses the job. Receipt history remains. Each batch item carries batchId/batchIndex and its own status; batch_complete_reviewed means completion includes reviewed unknown outcomes, not verified delivery. Never modify private batch files or the ledger to retry.

## Session age and notification settings

GET /state includes sessionAge {known,days,pairedAt,warn,thresholdDays,notice}. Legacy/incomplete evidence returns known:false and days:null. Age counts elapsed 24-hour days from observed pair-success subsequently authenticated as the expected account, not reconnect time. Ten days is a local maintenance threshold, not an official expiry.

PUT /settings additionally accepts sessionNotifyEnabled (boolean, default false) and sessionNotifyTarget (an explicitly allowed live JID, blank by default). Enabling requires live mode and a valid allowed target. Mode/account changes or local reset disable reminders. Reset also clears the observed age. The monitor waits offline, rechecks consent/identity/allowance before invocation and uses a durable per-session/target idempotency key. Submitted/unknown notifications are not repeated after restart. See SESSION-AGE.md.

The server now uses Fastify 5 with early auth/Host/Origin checks, bounded JSON parsing and trusted static schemas. Existing route shapes, bearer/cookie separation and idempotency requirements are retained. File bytes are never in API previews/exports; pending multi-file snapshots live in the private outbox directory and must accompany full-folder backups.
