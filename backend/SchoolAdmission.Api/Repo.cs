using Npgsql;

namespace SchoolAdmission.Api;

public enum Outcome { Ok, NotFound, Forbidden, SeatsFull, Duplicate, Expired, Cancelled, Confirmed }

public record ClassRow(string Id, string Name, int TotalSeats);
public record ClassStats(string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);
public record HoldRow(string HoldId, string ClassId, string StudentId, string Status, DateTime ExpiresAt);
public record MyHoldRow(string HoldId, string ClassId, string ClassName, string Status, DateTime ExpiresAt);

/// <summary>Mutable so tests can shorten the hold time without restarting the app.</summary>
public class HoldSettings
{
    public HoldSettings(int seconds) { Seconds = seconds; }
    public int Seconds { get; set; }
}

public class Repo
{
    private readonly NpgsqlDataSource _ds;
    private readonly HoldSettings _settings;
    private readonly ILogger<Repo> _log;

    public Repo(NpgsqlDataSource ds, HoldSettings settings, ILogger<Repo> log)
    {
        _ds = ds; _settings = settings; _log = log;
    }

    private static string NewId(string prefix) => prefix + Guid.NewGuid().ToString("N")[..12];

    private static NpgsqlCommand Cmd(NpgsqlConnection c, NpgsqlTransaction? t, string sql, params (string, object)[] ps)
    {
        var cmd = new NpgsqlCommand(sql, c, t);
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v);
        return cmd;
    }

    // ---------- schema ----------
    public async Task InitAsync()
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var c = await _ds.OpenConnectionAsync();
                // advisory lock: two instances starting together must not race on DDL
                await using (var l = Cmd(c, null, "SELECT pg_advisory_lock(727001)")) await l.ExecuteNonQueryAsync();
                const string ddl = @"
CREATE TABLE IF NOT EXISTS classes(
  id text PRIMARY KEY,
  name text NOT NULL,
  total_seats int NOT NULL CHECK (total_seats > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS holds(
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES classes(id),
  student_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('HELD','CONFIRMED','EXPIRED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL);
-- DB-level guarantee: one active/confirmed application per student per class
CREATE UNIQUE INDEX IF NOT EXISTS ux_holds_active ON holds(class_id, student_id) WHERE status IN ('HELD','CONFIRMED');
CREATE INDEX IF NOT EXISTS ix_holds_class ON holds(class_id, status);
CREATE INDEX IF NOT EXISTS ix_holds_student ON holds(student_id, created_at DESC);";
                await using (var d = Cmd(c, null, ddl)) await d.ExecuteNonQueryAsync();
                await using (var u = Cmd(c, null, "SELECT pg_advisory_unlock(727001)")) await u.ExecuteNonQueryAsync();
                return;
            }
            catch (Exception ex) when (attempt < 40)
            {
                _log.LogWarning("Database not ready (attempt {A}): {M}", attempt, ex.Message);
                await Task.Delay(2000);
            }
        }
    }

    // ---------- classes ----------
    public async Task<ClassRow> CreateClassAsync(string name, int totalSeats)
    {
        var id = NewId("c_");
        await using var c = await _ds.OpenConnectionAsync();
        await using var cmd = Cmd(c, null, "INSERT INTO classes(id,name,total_seats) VALUES (@i,@n,@t)",
            ("i", id), ("n", name), ("t", totalSeats));
        await cmd.ExecuteNonQueryAsync();
        return new ClassRow(id, name, totalSeats);
    }

    private const string StatsSql = @"
SELECT c.id, c.name, c.total_seats,
  COALESCE(SUM(CASE WHEN h.status='HELD' AND h.expires_at > clock_timestamp() THEN 1 ELSE 0 END),0)::int AS held,
  COALESCE(SUM(CASE WHEN h.status='CONFIRMED' THEN 1 ELSE 0 END),0)::int AS confirmed
FROM classes c LEFT JOIN holds h ON h.class_id = c.id
{WHERE}
GROUP BY c.id, c.name, c.total_seats, c.created_at
ORDER BY c.created_at, c.id";

    private static ClassStats ReadStats(NpgsqlDataReader r)
    {
        var total = r.GetInt32(2); var held = r.GetInt32(3); var conf = r.GetInt32(4);
        return new ClassStats(r.GetString(0), r.GetString(1), total, held, conf, Math.Max(0, total - held - conf));
    }

    public async Task<List<ClassStats>> ListClassesAsync()
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var cmd = Cmd(c, null, StatsSql.Replace("{WHERE}", ""));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<ClassStats>();
        while (await r.ReadAsync()) list.Add(ReadStats(r));
        return list;
    }

    public async Task<ClassStats?> GetClassAsync(string id)
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var cmd = Cmd(c, null, StatsSql.Replace("{WHERE}", "WHERE c.id = @id"), ("id", id));
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? ReadStats(r) : null;
    }

    // ---------- holds ----------
    public async Task<(Outcome, HoldRow?)> CreateHoldAsync(string classId, string studentId)
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var tx = await c.BeginTransactionAsync();

        // 1) lock the class row: all applications for one class are serialised here,
        //    so "count used seats, then insert" can never interleave between requests.
        int total;
        await using (var q = Cmd(c, tx, "SELECT total_seats FROM classes WHERE id=@id FOR UPDATE", ("id", classId)))
        {
            var o = await q.ExecuteScalarAsync();
            if (o is null) { await tx.RollbackAsync(); return (Outcome.NotFound, null); }
            total = (int)o;
        }

        // 2) release seats of holds whose time is over
        await using (var e = Cmd(c, tx,
            "UPDATE holds SET status='EXPIRED' WHERE class_id=@id AND status='HELD' AND expires_at <= clock_timestamp()", ("id", classId)))
            await e.ExecuteNonQueryAsync();

        // 3) same student, same class: only one active/confirmed application
        await using (var d = Cmd(c, tx,
            "SELECT count(*) FROM holds WHERE class_id=@id AND student_id=@s AND status IN ('HELD','CONFIRMED')",
            ("id", classId), ("s", studentId)))
        {
            if ((long)(await d.ExecuteScalarAsync())! > 0) { await tx.RollbackAsync(); return (Outcome.Duplicate, null); }
        }

        // 4) seats left?
        await using (var u = Cmd(c, tx,
            "SELECT count(*) FROM holds WHERE class_id=@id AND status IN ('HELD','CONFIRMED')", ("id", classId)))
        {
            if ((long)(await u.ExecuteScalarAsync())! >= total) { await tx.RollbackAsync(); return (Outcome.SeatsFull, null); }
        }

        var holdId = NewId("h_");
        DateTime expires;
        await using (var ins = Cmd(c, tx,
            "INSERT INTO holds(id,class_id,student_id,status,expires_at) VALUES (@h,@c,@s,'HELD', clock_timestamp() + make_interval(secs => @secs)) RETURNING expires_at",
            ("h", holdId), ("c", classId), ("s", studentId), ("secs", (double)_settings.Seconds)))
        {
            expires = (DateTime)(await ins.ExecuteScalarAsync())!;
        }
        await tx.CommitAsync();
        return (Outcome.Ok, new HoldRow(holdId, classId, studentId, "HELD", expires));
    }

    public async Task<HoldRow?> GetHoldAsync(string holdId)
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var cmd = Cmd(c, null, @"
SELECT id, class_id, student_id,
  CASE WHEN status='HELD' AND expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE status END,
  expires_at FROM holds WHERE id=@id", ("id", holdId));
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return null;
        return new HoldRow(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetFieldValue<DateTime>(4));
    }

    public async Task<(Outcome, HoldRow?)> ConfirmAsync(string holdId, string studentId)
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var tx = await c.BeginTransactionAsync();
        string classId, owner, status; DateTime expires; bool over;
        await using (var q = Cmd(c, tx,
            "SELECT class_id, student_id, status, expires_at, expires_at <= clock_timestamp() FROM holds WHERE id=@id FOR UPDATE",
            ("id", holdId)))
        await using (var r = await q.ExecuteReaderAsync())
        {
            if (!await r.ReadAsync()) return (Outcome.NotFound, null); // tx is rolled back on dispose
            classId = r.GetString(0); owner = r.GetString(1); status = r.GetString(2);
            expires = r.GetFieldValue<DateTime>(3); over = r.GetBoolean(4);
        }
        if (owner != studentId) { await tx.RollbackAsync(); return (Outcome.Forbidden, null); }

        // already confirmed -> idempotent success, nothing is incremented again
        if (status == "CONFIRMED") { await tx.RollbackAsync(); return (Outcome.Ok, new HoldRow(holdId, classId, owner, "CONFIRMED", expires)); }
        if (status == "CANCELLED") { await tx.RollbackAsync(); return (Outcome.Cancelled, null); }
        if (status == "EXPIRED" || over)
        {
            await using (var u = Cmd(c, tx, "UPDATE holds SET status='EXPIRED' WHERE id=@id AND status='HELD'", ("id", holdId)))
                await u.ExecuteNonQueryAsync();
            await tx.CommitAsync();
            return (Outcome.Expired, null);
        }
        await using (var u = Cmd(c, tx, "UPDATE holds SET status='CONFIRMED' WHERE id=@id", ("id", holdId)))
            await u.ExecuteNonQueryAsync();
        await tx.CommitAsync();
        return (Outcome.Ok, new HoldRow(holdId, classId, owner, "CONFIRMED", expires));
    }

    public async Task<Outcome> CancelAsync(string holdId, string studentId)
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var tx = await c.BeginTransactionAsync();
        string owner, status; bool over;
        await using (var q = Cmd(c, tx,
            "SELECT student_id, status, expires_at <= clock_timestamp() FROM holds WHERE id=@id FOR UPDATE", ("id", holdId)))
        await using (var r = await q.ExecuteReaderAsync())
        {
            if (!await r.ReadAsync()) return Outcome.NotFound; // tx is rolled back on dispose
            owner = r.GetString(0); status = r.GetString(1); over = r.GetBoolean(2);
        }
        if (owner != studentId) { await tx.RollbackAsync(); return Outcome.Forbidden; }
        if (status == "CANCELLED") { await tx.RollbackAsync(); return Outcome.Ok; }      // idempotent
        if (status == "CONFIRMED") { await tx.RollbackAsync(); return Outcome.Confirmed; } // fee paid: cannot cancel here
        if (status == "EXPIRED" || over)
        {
            await using (var u = Cmd(c, tx, "UPDATE holds SET status='EXPIRED' WHERE id=@id AND status='HELD'", ("id", holdId)))
                await u.ExecuteNonQueryAsync();
            await tx.CommitAsync();
            return Outcome.Expired;
        }
        await using (var u = Cmd(c, tx, "UPDATE holds SET status='CANCELLED' WHERE id=@id", ("id", holdId)))
            await u.ExecuteNonQueryAsync();
        await tx.CommitAsync();
        return Outcome.Ok;
    }

    public async Task<List<MyHoldRow>> MyHoldsAsync(string studentId)
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var cmd = Cmd(c, null, @"
SELECT h.id, h.class_id, c.name,
  CASE WHEN h.status='HELD' AND h.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE h.status END,
  h.expires_at
FROM holds h JOIN classes c ON c.id = h.class_id
WHERE h.student_id=@s ORDER BY h.created_at DESC", ("s", studentId));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<MyHoldRow>();
        while (await r.ReadAsync())
            list.Add(new MyHoldRow(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetFieldValue<DateTime>(4)));
        return list;
    }

    /// <summary>Periodic clean-up so the stored status also becomes EXPIRED (reads already compute it live).</summary>
    public async Task<int> SweepExpiredAsync()
    {
        await using var c = await _ds.OpenConnectionAsync();
        await using var cmd = Cmd(c, null, "UPDATE holds SET status='EXPIRED' WHERE status='HELD' AND expires_at <= clock_timestamp()");
        return await cmd.ExecuteNonQueryAsync();
    }
}
