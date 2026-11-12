# School Admission System

Seat-hold based admission system. A student applies for a seat in a class (shift); the seat is **held** for a limited time, and the student must "pay the admission fee" (simulated) to **confirm** it. If the hold expires, the seat returns to the pool automatically.

- Backend: .NET 8 minimal API + PostgreSQL 17 (port 8080)
- Frontend: React 18 + Vite, served by nginx (port 3000)
- Only **Docker** is needed on your machine.

## Run

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080 (e.g. `GET http://localhost:8080/classes`)

Data is stored in a Docker volume, so it survives `docker compose down` and `docker compose up`.
(To wipe it: `docker compose down -v`.)

### Configuration (environment variables)

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `DB_CONNECTION_STRING` | backend | set in docker-compose.yml | PostgreSQL connection string |
| `HOLD_DURATION_SECONDS` | backend | `600` | How long a seat is held |
| `API_URL` | frontend | `http://localhost:8080` | Backend URL used by the **browser** |

Example, 30-second holds (handy for seeing expiry in the UI):

```bash
HOLD_DURATION_SECONDS=30 docker compose up --build
```

## How to use the UI

Everything is done from the browser at http://localhost:3000 (no Postman, no database access). A **student-number box is at the top of every page** (no login).

1. **ক্লাস তৈরি (স্কুল অ্যাডমিন)**, `#/admin`: type the class **name** (e.g. `Class 6 Morning Shift`) and the number of seats. A fresh database has no classes, so start here.
2. **ক্লাস তালিকা**, the home page: every class with total / held / confirmed / available seats (refreshes by itself every few seconds) and an **আবেদন করুন** button. First type the student's 17-digit birth registration number in the box at the top and press **সংরক্ষণ করুন** (it is remembered in the browser; **নম্বর পরিবর্তন** switches to another student).
3. **আবেদনের অবস্থা**: status, live countdown to expiry, **ভর্তি ফি দিন** and **বাতিল**. When the time is over the status changes to "সময় শেষ" and the pay button is disabled, without a reload. Paying is simulated (it simply confirms the admission).
4. **আমার আবেদন**: all applications of this student; they are still there after a page refresh or after closing the browser.

## API

All requests/responses are JSON. Student identity is the `X-Student-Id` header (17-digit birth registration number).

| Method | Path | Success |
|---|---|---|
| POST | `/classes` | 201 `{id,name,totalSeats}` |
| GET | `/classes` | 200 list with `heldSeats, confirmedSeats, availableSeats` |
| GET | `/classes/{classId}` | 200 |
| POST | `/classes/{classId}/holds` | 201 `{holdId,classId,studentId,status:"HELD",expiresAt}`; 409 if no seat |
| GET | `/holds/{holdId}` | 200 `{holdId,classId,status,expiresAt}` |
| POST | `/holds/{holdId}/confirm` | 200 `{holdId,status:"CONFIRMED"}` |
| DELETE | `/holds/{holdId}` | 204 |
| GET | `/me/holds` | 200 list |
| GET | `/health` | extra, 200 `{status:"ok"}` |

Errors are always 4xx with `{ "error": "...", "code": "..." }` (never a 500 for bad input).

## Tests

**Backend** (xUnit, run against a real PostgreSQL; 20 tests, including concurrency tests, a two-backend test, expiry, idempotent confirm and bad-input tests). Needs only Docker:

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down -v
```

**Frontend** (bonus; Vitest + React Testing Library, 17 tests: countdown, the pay button switching off by itself after expiry, friendly error texts, class list, create-class form, Bengali digits). Needs Node 20+:

```bash
cd frontend
npm install
npm test
```

(If your shell has `NODE_ENV=production` set, use `NODE_ENV=test npm test`.)

## Two backend processes on one database (bonus)

```bash
docker compose -f docker-compose.yml -f docker-compose.two-backends.yml up --build -d
sh scripts/two-backend-check.sh      # parallel applications to :8080 and :8081; seats never exceed the limit
```

## How seats stay safe (short)

Applying runs in one database transaction that first locks the class row (`SELECT ... FOR UPDATE`), then counts active holds + confirmed seats, then inserts. So many students applying at the same moment are handled one at a time per class and `held + confirmed <= totalSeats` always holds. Expiry uses the database clock (`expires_at > now()`), so an expired hold stops counting immediately without any API call; a background job also marks old rows `EXPIRED`.

See also: [ASSUMPTIONS.md](ASSUMPTIONS.md) (including how two processes stay safe) and [AI_USAGE.md](AI_USAGE.md).
