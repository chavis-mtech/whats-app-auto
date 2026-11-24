# Scheduled latest-file documents

The **ไฟล์ล่าสุดจากโฟลเดอร์** source selects the most recently modified matching regular file and sends it as a WhatsApp **document with its caption in the same message**. A PDF is sent with `mimetype: application/pdf`; it is not sent as a separate text followed by a file. WhatsApp/Baileys and the recipient's client control thumbnail/preview rendering, so a particular PDF thumbnail appearance is not promised.

## Set up in the Thai UI

1. Connect demo mode and explicitly allow a synthetic recipient first. Open **งานอัตโนมัติ → สร้างงานอัตโนมัติ**. The destination starts blank; choose an allowed contact/group yourself.
2. Choose **ไฟล์ล่าสุดจากโฟลเดอร์**. Paste the absolute folder path on the computer running the app, for example `C:/Reports/Daily`. Explorer's quoted “Copy as path” value is accepted. A browser on another computer does not make that computer's folder available to the server. User-selected accessible UNC paths also work; the Windows account running the app needs permission.
3. Enter extensions such as `pdf` or `pdf,png,jpg`. PDF is the default. Extension matching is case insensitive. Files sort by newest modification timestamp first; equal timestamps use ascending ordinal filename order for a deterministic tie. Selection does not recurse into subfolders, ignores symlinks/directories and `~$` lock files, and examines at most 5,000 entries. A mixed folder's newer PNG/TXT/MD/HTML files do not win when only PDF is selected.
4. Set a stability age (default 30 seconds, range 5–3600). The newest matching file must be nonempty, at most 10 MB and old enough. The app waits if that newest file is unavailable/changing; it does **not** silently substitute an older report.
5. Customize the caption. The example button inserts `Ai สรุปงาน <date.format(DD.MM.BB)>`. For a run on 20 November 2026 in the selected timezone, that becomes `Ai สรุปงาน 20.11.69` (`BB` is the two-digit Buddhist year). The default date basis is the **actual run/preparation time**, not the nominal missed schedule time or file date. The optional modified-date basis uses the selected file's modification timestamp instead.
6. Set the schedule and IANA timezone, for example `Asia/Bangkok`. The timezone affects both daily scheduling and formatted caption dates. Choose Thai or English for month/weekday names.
7. Click **ดูตัวอย่าง** and inspect filename, size, modified timestamp and final caption. The preview shows metadata/caption, not document bytes or a rendered PDF page. A successful preview is required before enabling or manually running a file task; it is valid for five minutes and the same configuration. Changing inputs requires a new preview. Saving paused is allowed without one.
8. Enable and save only when the preview is correct. Preview approval checks the configuration; it does not freeze today's selected file forever. Every scheduled run selects the latest matching stable file afresh. Test in demo first, then use an explicitly approved real recipient when ready.

## Date formats

Use `<date.format(DD.MM.BB)>` or its alias `{{date:DD.MM.BB}}`. Optional quotes inside `format(...)` are accepted. Formats are bounded tokens, not JavaScript or executable expressions.

| Token | Meaning | Example for 20 November 2026 |
| --- | --- | --- |
| `YYYY` / `YY` | Gregorian year / two digits | `2026` / `26` |
| `BBBB` / `BB` | Buddhist year / two digits | `2569` / `69` |
| `MM` / `M` | Month, padded / unpadded | `11` / `11` |
| `DD` / `D` | Day, padded / unpadded | `20` / `20` |
| `MMMM` / `MMM` | Month name, full / short | Thai or English according to the job setting |
| `dddd` / `ddd` | Weekday name, full / short | Thai or English according to the job setting |
| `HH` / `H` | 24-hour clock hour | `09` / `9` |
| `mm` / `m`, `ss` / `s` | Minute and second | `05`, `30` |
| `[text]` | Literal text within a date format | `DD [เดือน] MMMM BBBB` |

`yyyy`, `yy`, `dd` and `d` are numeric aliases. Case matters: `MM` is month and `mm` is minute. Each pattern is at most 120 characters, each bracketed literal at most 40, and there are at most 20 date substitutions per caption. Unknown formats fail before sending. Caption output is limited to 4,000 characters.

Additional placeholders are `{{file.name}}` (literal selected filename), `{{file.modified}}` (ISO UTC modification timestamp), and the existing `{{now}}` (ISO UTC current timestamp). Filename and external data substitutions are not parsed recursively as template instructions.

## Waiting, deduplication and snapshots

With **ส่งเฉพาะเมื่อไฟล์เปลี่ยน** checked (default), a previously recorded file version is not sent again for this job, destination and mode. Version identity uses canonical path plus SHA256 content; merely touching the same bytes does not create a new version, and returning to an earlier recorded version is also skipped. A new destination or separately created task is a distinct intended workflow. Uncheck the option only if you deliberately want the same file on every occurrence.

Missing/inaccessible/empty/oversized/fresh/changing files enter **รอไฟล์พร้อมใช้งาน**, preserve the due slot and do not consume preparation retry budget. They are revisited after 30 seconds while connected. Connection loss also waits. A slow filesystem preparation returns a waiting outcome after about 15 seconds; the app avoids starting another read of that pending folder and caps background pending preparations. Windows can still finish an already-issued filesystem operation later; the app discards canceled results instead of sending them.

The app reads a bounded snapshot once, checks identity/size/mtime/ctime before and after reading, and passes those exact bytes to the provider. It does not reopen a selected path later for sending. A file changed after the verified snapshot can be selected on a later run; the current attempt uses its verified snapshot. Single-file receipts persist metadata/hashes. Multi-file runs additionally persist private snapshot bytes under `outbox/` until the batch completes or is explicitly canceled; protect that folder with the rest of private state.

The file version is committed with the durable submission attempt before provider I/O. Unknown outcomes pause the job and are never automatically replayed. If connection loss is proven before provider invocation, the version/slot are restored and can be prepared again safely. Check the recipient before deliberately resending an unknown attempt; disabling changed-file suppression is an explicit override, not a delivery guarantee.

## OneDrive and producer completion

Use **Always keep on this device** for the source folder. Online-only OneDrive files may need connectivity/hydration; Windows permission/network/cloud errors result in waiting rather than sending an older file. See [Microsoft's Files On-Demand guide](https://support.microsoft.com/en-us/onedrive/save-disk-space-with-onedrive-files-on-demand-for-windows).

No timestamp rule can prove an arbitrary writer has finished. For reliable producers, write to a temporary/nonmatching extension, close it, then atomically rename it to the final PDF name. Pick a stability age longer than normal writing/sync delays. This app cannot guarantee producer completion or the recipient's visual thumbnail. Private app state/auth storage is blocked as a source; other user-selected accessible filesystem folders are supported. Folder paths and filenames are sensitive metadata in the user's private job state/export; do not publish a real configuration or screenshot.

## Several recent files from the same day

Set **จำนวนไฟล์ล่าสุด (สูงสุด)** to 1–10. The default period selects the calendar date of the **newest matching file’s modification time** in the job’s IANA timezone, then takes the newest N files within that date. It does not mean today, the schedule date, a rolling 24 hours or the date embedded in a filename. DST days can have 23 or 25 hours. Choose the across-days option when that restriction is unwanted. Equal modification times use ordinal filename ordering; no locale-dependent tie is used.

The preview lists chosen names, sizes, modification dates, requested/available count, selected day and any shortfall. N is a maximum: if only two eligible files exist, a request for five selects two and explicitly reports three missing; it does not borrow older days. Changed-version suppression may then skip already-recorded files. The selector does not backfill with older versions. Limits are 10 MB per document and 50 MB total snapshots, at most 5,000 matching regular files inspected. A selected fresh/unavailable file makes preparation wait rather than silently substituting older material.

For a multi-file run, all selected snapshots and rendered captions are frozen before the first provider call, then sent sequentially as **one document message per file with its own caption**. This is not a WhatsApp album or one combined PDF. Caption dates share actual preparation/run time by default; the optional modified basis uses each selected file’s mtime. A restart resumes the existing frozen plan, never picks new source files for its remaining items. Back up outbox/ with state.json; do not edit either while running.

Each item is durably pending, submitting, submitted/simulated or unknown. A crash during submitting becomes unknown. Accepted and unknown items are never replayed. The job pauses at an unknown item; opening its pending-batch dialog allows **ตรวจสอบแล้ว ข้ามรายการไม่ทราบผลและส่งที่ยังไม่เริ่ม** only after checking the recipient, or cancellation of the remainder. Reviewed unknowns remain visibly unknown in history; final completion is qualified accordingly. Offline pending items wait and keep the due slot. Only when the whole plan finishes does the schedule advance. Global submission serialization prevents concurrent API/job/reminder sends from overlapping. Editing/deleting a job with a pending plan is blocked until explicit continuation/cancel.

Completed/canceled snapshot folders are cleaned up. A process failure before the state plan is committed can leave an orphan private outbox directory; it is never automatically sent. Do not remove folders referenced by pendingBatch in state. Private disk usage can grow with pending jobs, so monitor storage and retain secure consistent backups. Old single-file tasks default to count one and preserve their previous execution behavior.

## Latest TXT as WhatsApp text

Choose **ข้อความจาก TXT ล่าสุด** (the TXT source option) to read only the latest stable .txt. This source always selects one file. The template must contain {{data}}, which becomes the literal UTF-8 contents; date and filename placeholders apply only to the configured template, never recursively to file contents. This is a text message, without a document attachment.

Use UTF-8, optionally with BOM; CRLF becomes LF. Maximum input is 65,536 bytes and final rendered output is 16,000 characters. Empty/whitespace-only, NUL-containing, invalid UTF-8 and oversized inputs are refused without truncation, guessing ANSI/UTF-16 or splitting messages. The same stability, preview, changed-version and unknown-outcome protections apply. Document and TXT-text outputs are distinct version identities. Preview shows text; review sensitive content locally and do not share real preview screenshots.
