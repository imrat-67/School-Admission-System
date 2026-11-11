# Assumptions

1. **Student id**: `X-Student-Id` must be exactly 17 digits (birth registration number). Anything else gives 400. No login, no student table; the id is just stored with each application.
2. **Class = one shift.** Class names are not required to be unique. Name must be non-empty (max 200 chars) and `totalSeats` a whole number from 1 to 100000; otherwise 400.
3. **One student, one active seat per class.** A second apply while a HELD (not expired) or CONFIRMED application exists gives 409. After a cancel or expiry the student may apply again. The same student may apply in different classes.
4. **Expiry** is decided by the database clock (`expires_at > now()`), so an expired hold stops counting at once. Confirming an expired hold gives 409 and the row becomes EXPIRED. Hold duration comes from `HOLD_DURATION_SECONDS` (default 600) and applies to new holds only.
5. **Confirm** is idempotent: confirming an already CONFIRMED application by its owner returns 200 and the seat is counted once. Another student's confirm gives 403. Confirming a CANCELLED or EXPIRED application gives 409.
6. **Cancel** (`DELETE /holds/{id}`) works on the student's own HELD application (204, seat returns). Cancelling an already CANCELLED one is also 204 (safe to repeat); an expired one gives 409 `HOLD_EXPIRED`. A CONFIRMED admission cannot be cancelled (409) because the fee is considered paid. Another student's id gives 403.
7. **`GET /holds/{id}`** needs no header (the spec lists no header for it); hold ids are random, so they are hard to guess. `/me/holds` needs the header.
8. **Payment** is simulated: pressing "ভর্তি ফি দিন" simply calls confirm.
9. **Admin**: there is no admin login; the "create class" form is open to everyone, as the spec asks for no authentication.
10. **IDs** are short random strings (`c_...`, `h_...`).
11. **Seat counts**: `heldSeats` counts only non-expired HELD rows; `availableSeats = totalSeats - heldSeats - confirmedSeats`.
12. **Frontend** stores the student id in the browser's localStorage so applications are still visible after refresh or reopening the browser. The browser talks to the backend directly at `API_URL` (default `http://localhost:8080`); backend allows CORS.
13. **Ports**: backend 8080, frontend 3000, database is not exposed to the host.
