# AI usage

**Tool used:** Claude (Anthropic), working through Desktop Commander on my laptop, in several chat sessions that continued each other's work. I am the one who submits this project and I take responsibility for it.

## What AI did
- Read the assignment and wrote a short summary of the requirements and the endpoint list.
- Proposed the design: .NET 8 minimal API with raw SQL (Npgsql), PostgreSQL, and a row lock on the class (`SELECT ... FOR UPDATE`) inside a transaction to keep seats safe under concurrent requests.
- Wrote the first version of the backend, the Dockerfiles, `docker-compose.yml`, the React frontend, the xUnit tests, the small Vitest frontend tests, and the README / ASSUMPTIONS files.
- Ran the Docker builds, called every endpoint with `curl`, and ran the tests.

## What I did
- Gave the assignment, the rules and the deadline, and decided which assumptions to accept.
- Reviewed and ran the result, and I will read the code before I explain or defend it in an interview.

## Where AI made mistakes and how they were caught
- **500 error on an unknown application id.** The first version of `ConfirmAsync` and `CancelAsync` rolled the transaction back while the database reader was still open. For a hold id that does not exist, this threw an exception and the API returned 500 instead of 404. It was **not** caught by reading the code; it was caught by the automated backend test (`Bad_ids_headers_and_unknown_resources_give_4xx_never_500`), and the backend log showed the cause. Fixed by returning without the manual rollback (the transaction is rolled back when it is disposed). All tests passed after the fix (13 at that time; now 20).
- The first documentation draft said that cancelling an expired application returns 204. The code actually returns 409 `HOLD_EXPIRED`. I compared the text with `Program.cs` and corrected the docs.
- The PDF text extraction was garbled, so the AI first wrote a clean summary of the requirements and then checked its work against the original PDF.

## Later review of the UI (more AI mistakes, caught by me while using it)
- The redesigned UI first had a full-page "gate" and a "switch student" page that behaved like a login, although the spec says no login and asks for a box at the top of the page. I noticed it while using the site; it is now a box at the top of every guardian page.
- The AI added things that are not in the assignment (made-up shift timings, an academic year, a receipt/print button). I pointed this out and they were removed.
- A confusing admin form: one form was used for both creating and editing a class. Editing is now a separate dialog.
- The "বাতিল" button was shown disabled on applications that could not be cancelled, which looked broken. It now appears only for a running application.
- I decided that one birth registration number should not hold seats in several classes at the same time. The spec only limits this per class, so the rule was added in the UI only and the API stays exactly as the spec says (see ASSUMPTIONS.md).
- Admin edit/close class endpoints were added on top of the 8 required endpoints (extras; the 8 required contracts are untouched).

## Second review and fixes, after the deadline (12 Nov)
These changes were made **after the submission deadline** (11 Nov 23:59:59); the commit times show it. They are listed here so the history stays honest.

An independent review by another Claude session (it cloned the repo, ran it with Docker, load-tested it and clicked through the UI) and a new check of the PDF page images found these problems. All were AI-made or AI-missed:
- **A class name containing a NUL character gave a 500.** Fixed: control characters give 400, and database "data exception" errors are mapped to 400.
- **Bengali digits were accepted as a student id** (the .NET regex `\d` matches them). Fixed with `[0-9]{17}`; the UI converts Bengali digits to 0-9 instead.
- **Two backend processes under load gave some 500s**: each process allowed 200 connections, together more than PostgreSQL's 300. Pool size is now 50. Checked again with 1200 parallel requests on two processes: exactly the seat count succeeded, no 5xx.
- **The countdown could not use the server clock**, because CORS did not expose the `Date` header. Fixed.
- **`totalSeats` given as a string was accepted.** Fixed (strict JSON numbers).
- **`GET /holds/{id}` returned the student id** (a child's registration number). Removed from that response.
- **The PDF text extraction was incomplete.** It dropped the first Bonus bullet (two backend processes on one database, explained in ASSUMPTIONS.md) and contained a line about "4xx, never 500" that is not visible on the page. I caught this only by rendering the PDF pages to images and reading them. So the Bonus part (a `docker-compose.two-backends.yml`, `scripts/two-backend-check.sh`, a two-instance test, an explanation in ASSUMPTIONS.md) was added late.
- **Things beyond the PDF.** The review pointed out what the UI does beyond the PDF (admin edit/close of classes, a rule that stops a student from applying in a second class, extra payment/success pages, a Class 6-10 / Morning-Day selector instead of a free class name). The AI first removed them all. I looked at the result and preferred the earlier UI, so I asked to restore it; the only changes kept are the ones that are not about looks (backend fixes, tests, bonus, docs). These extras are listed openly in ASSUMPTIONS.md (points 2, 3, 9, 12, 13). The API still has exactly the 8 required endpoints with the documented fields, plus the admin PUT/DELETE and /health as extras.
- ASSUMPTIONS.md was shortened and made consistent (it had contradicting points); it was updated again when the earlier UI was restored.
- Tests: backend 22, frontend 9 (both pass).

