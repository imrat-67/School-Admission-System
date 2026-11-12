# AI usage

**Tool:** Claude (Anthropic), used through chat with file and terminal access on my laptop, over several sessions.

## What the AI did
- Wrote most of the code from my instructions: the .NET 8 backend, the React frontend, the Dockerfiles and compose files, the backend and frontend tests, and the first drafts of README and ASSUMPTIONS.
- Built and ran the project with Docker, called the endpoints with `curl`, ran the tests and a load check.

## What I did
- Gave the assignment and the rules, and decided what the project should look like: the two-part UI (admin / guardian), what to keep and what to change after reviewing it, and which assumptions to accept.
- Used the UI myself and pointed out what was wrong or confusing.
- Decided that the earlier UI should stay and that the rest should follow the PDF as closely as possible.

## Where the AI made mistakes and how they were found
- **500 error for an unknown application id** (confirm/cancel rolled back a transaction while a reader was still open). Found by a backend test, fixed.
- **UI problems:** a login-like gate page although the spec has no login, invented content (shift timings, academic year, receipt), a form that mixed create and edit, and a disabled-looking cancel button. I found these while using the site and they were fixed.
- **The PDF text was extracted badly** (garbled, and it dropped the first Bonus bullet about two backend processes). Found by rendering the PDF pages as images; the Bonus part was added afterwards.
- **Problems found by a review and a load test:** a NUL character in a class name gave 500; Bengali digits were accepted as a student id; two backend processes together could use more database connections than PostgreSQL allows; the browser could not read the server clock for the countdown; `totalSeats` as a string was accepted. All fixed and covered by tests.

Some of these fixes and the Bonus were done after the submission deadline (11 Nov 23:59:59); the commit times show this.
