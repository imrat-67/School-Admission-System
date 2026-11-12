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

1. Type the student's 17-digit birth registration number in the box at the top (it is remembered in the browser).
2. Admin part: create a class (name + total seats).
3. Class list: see total / held / confirmed / available seats (auto-refreshes every few seconds). Press **আবেদন করুন** to apply.
4. Application status: live countdown, **ভর্তি ফি দিন** (confirm) and **বাতিল** (cancel).
5. My applications: all applications of this student, still there after a page refresh.

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
| PUT | `/classes/{classId}` | extra (admin): 200 `{id,name,totalSeats}`; 409 if seats < held+confirmed |
| DELETE | `/classes/{classId}` | extra (admin): 204, class is closed (soft delete) |

Errors are always 4xx with `{ "error": "...", "code": "..." }` (never a 500 for bad input).

## Tests

Backend tests (xUnit, run against a real PostgreSQL, includes a concurrency test). Needs only Docker:

```bash
docker compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down -v
```

## How seats stay safe (short)

Applying runs in one database transaction that first locks the class row (`SELECT ... FOR UPDATE`), then counts active holds + confirmed seats, then inserts. So many students applying at the same moment are handled one at a time per class and `held + confirmed <= totalSeats` always holds. Expiry uses the database clock (`expires_at > now()`), so an expired hold stops counting immediately without any API call; a background job also marks old rows `EXPIRED`.

See also: [ASSUMPTIONS.md](ASSUMPTIONS.md), [AI_USAGE.md](AI_USAGE.md).

Frontend tests (bonus, Vitest + React Testing Library: countdown, auto-disable of the pay button after expiry, friendly error texts). Needs Node 20+:

```bash
cd frontend
npm install
npm test
```
