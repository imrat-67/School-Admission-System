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

Everything is done from the browser (no Postman, no database access). There are two separate parts:

**School admin: http://localhost:3000/#/admin** (no login, as the spec has no login). On a fresh database there are no classes yet, so start here:
- **সব ক্লাস যোগ করুন** creates Class 6 to 10, each with Morning and Day shift (10 classes) in one click, or add one class by typing its name and seats.
- The table lists total / held / confirmed / available seats. **সম্পাদনা** edits a class (seats cannot go below the seats already held or confirmed), **মুছুন** closes a class.

**Guardian: http://localhost:3000**
1. Type the student's 17-digit birth registration number in the box at the top and press **সংরক্ষণ করুন** (it is remembered in the browser; **নম্বর পরিবর্তন** switches to another student).
2. Class list: pick a class tab, see total / held / confirmed / available seats (auto-refreshes every few seconds), press **আবেদন করুন**.
3. Application status page: live countdown, **ভর্তি ফি দিন** (summary page, then **ফি জমা নিশ্চিত করুন**, then a success page) and **বাতিল**. When the time is over the status changes to expired and the pay button is disabled, without a reload.
4. **আমার আবেদন**: all applications of this student, still there after a page refresh or after closing the browser.
5. If the student already has a running or confirmed application in a class, clicking **আবেদন করুন** for the same class shows a dialog (the API gives 409); other classes are not affected.

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
| PUT / DELETE | `/classes/{classId}` | extra (admin edit / close), see ASSUMPTIONS.md |

Errors are always 4xx with `{ "error": "...", "code": "..." }` (never a 500 for bad input).

## Tests

**Backend** (xUnit, run against a real PostgreSQL; 22 tests, including concurrency tests, a two-backend test, expiry, idempotent confirm and bad-input tests). Needs only Docker:

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down -v
```

**Frontend** (bonus; Vitest + React Testing Library, 10 tests, see `frontend/src/App.test.jsx`). Needs Node 20+:

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

Applying runs in one database transaction that first locks the class row (`SELECT ... FOR UPDATE`), then counts active holds + confirmed seats, then inserts. So many students applying at the same moment are handled one at a time per class and `held + confirmed <= totalSeats` always holds. Expiry uses the database clock (`expires_at > clock_timestamp()`), so an expired hold stops counting immediately without any API call; a background job also marks old rows `EXPIRED`.

See also: [ASSUMPTIONS.md](ASSUMPTIONS.md) (including how two processes stay safe) and [AI_USAGE.md](AI_USAGE.md).
