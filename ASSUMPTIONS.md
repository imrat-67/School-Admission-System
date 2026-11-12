# Assumptions

Where the assignment is silent I decided the following (short reasons included).

1. **Student id.** `X-Student-Id` must be exactly 17 ASCII digits (the birth registration number), otherwise 400. There is no login and no student table; the id is stored with each application. The UI turns Bengali digits typed by parents into 0-9, so one student never appears under two different ids.
2. **A class is one shift.** The name is free text (non-empty, at most 200 characters, no control characters) and does not have to be unique in the API; `totalSeats` is a whole number from 1 to 100000. Anything else gives 400, never 500. The admin page has a name field, and also a button that creates Class 6 to 10 with Morning and Day shift in one click.
3. **One application per student per class** (as in the spec): a second apply to the same class gives 409, and the same student may apply to other classes. In the UI, clicking "আবেদন করুন" for a class where the student already has a running or confirmed application shows a dialog instead of sending the request.
4. **Expiry** is decided by the database clock (`expires_at > clock_timestamp()`), so an expired hold stops counting at once and no API call is needed. `HOLD_DURATION_SECONDS` (default 600) applies to new holds.
5. **Confirm** is idempotent: confirming an already confirmed application of the same student returns 200 and the seat is counted once. Another student's id gives 403; an expired or cancelled application gives 409.
6. **Cancel** (`DELETE /holds/{id}`): own running application → 204 and the seat returns; repeating it is also 204; an expired one gives 409; a confirmed admission cannot be cancelled (409) because the fee is considered paid; another student's id gives 403.
7. **`GET /holds/{id}`** needs no header (the spec lists none) and does not return `studentId`, because it is a child's registration number. `/me/holds` needs the header.
8. **Payment is simulated.** "ভর্তি ফি দিন" directly confirms the application.
9. **No admin login** (the spec has none). The admin page `#/admin` is open to everyone; the guardian pages cannot create, edit or delete classes.
10. `availableSeats = totalSeats − heldSeats − confirmedSeats`, where `heldSeats` counts only HELD applications that have not expired. IDs are short random strings (`c_…`, `h_…`).
11. The student id is kept in the browser's localStorage so applications are still visible after a refresh or after reopening the browser. The browser calls the backend directly at `API_URL`, so the backend allows CORS (and exposes the `Date` header so the countdown uses the server's clock).
12. **Admin edit/close (extra, the 8 required endpoints are unchanged).** `PUT /classes/{id}` changes name and seats, but seats can never go below the held + confirmed seats (409), so rule 1 still holds. `DELETE /classes/{id}` closes a class: it disappears from the lists, takes no new applications, running applications are cancelled, confirmed admissions stay in the database.
13. **Pay flow in the UI:** "ভর্তি ফি দিন" opens a summary page, then "ফি জমা নিশ্চিত করুন" (simulated payment, calls confirm) and a success page. "বাতিল" appears only for a running application; "ভর্তি ফি দিন" is disabled once the time is over.

## Bonus: two backend processes on one database

Nothing about seats is kept in the memory of a backend process, so any number of processes can run side by side. PostgreSQL is the single source of truth and does the locking:

- **Apply:** one transaction first locks the class row (`SELECT … FOR UPDATE`), then counts held + confirmed seats, then inserts. A request from the other process has to wait for that lock, so for one class the check-and-insert steps of all requests run one after another, whichever process they came from. `held + confirmed` can therefore never exceed `totalSeats`.
- **One application per student per class:** also enforced by the database (a partial unique index), not only by code.
- **Confirm:** locks the application row, so repeated or parallel confirms count the seat only once.
- **Expiry** uses the database clock, never a process clock, so two processes cannot disagree about whether a hold has expired.
- **Connections:** each process uses at most 50 connections, and PostgreSQL allows 300, so two (or more) processes do not run out of connections.

How I checked it: `docker-compose.two-backends.yml` starts a second backend on port 8081; `scripts/two-backend-check.sh` sends hundreds of parallel applications alternately to ports 8080 and 8081, and exactly `totalSeats` of them succeed. The backend test `Two_backend_instances_on_one_database_never_exceed_the_seat_limit` does the same with two separate application hosts, each with its own connection pool.
