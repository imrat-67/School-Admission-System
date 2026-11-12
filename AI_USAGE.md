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
- **500 error on an unknown application id.** The first version of `ConfirmAsync` and `CancelAsync` rolled the transaction back while the database reader was still open. For a hold id that does not exist, this threw an exception and the API returned 500 instead of 404. It was **not** caught by reading the code; it was caught by the automated backend test (`Bad_ids_headers_and_unknown_resources_give_4xx_never_500`), and the backend log showed the cause. Fixed by returning without the manual rollback (the transaction is rolled back when it is disposed). All 13 tests pass after the fix.
- The first documentation draft said that cancelling an expired application returns 204. The code actually returns 409 `HOLD_EXPIRED`. I compared the text with `Program.cs` and corrected the docs.
- The PDF text extraction was garbled, so the AI first wrote a clean summary of the requirements and then checked its work against the original PDF.

## Later review of the UI (more AI mistakes, caught by me while using it)
- The redesigned UI first had a full-page "gate" and a "switch student" page that behaved like a login, although the spec says no login and asks for a box at the top of the page. I noticed it while using the site; it is now a box at the top of every guardian page.
- The AI added things that are not in the assignment (made-up shift timings, an academic year, a receipt/print button). I pointed this out and they were removed.
- A confusing admin form: one form was used for both creating and editing a class. Editing is now a separate dialog.
- The "বাতিল" button was shown disabled on applications that could not be cancelled, which looked broken. It now appears only for a running application.
- I decided that one birth registration number should not hold seats in several classes at the same time. The spec only limits this per class, so the rule was added in the UI only and the API stays exactly as the spec says (see ASSUMPTIONS.md).
- Admin edit/close class endpoints were added on top of the 8 required endpoints; they are covered by 2 extra backend tests (15 in total).

