using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Npgsql;
using SchoolAdmission.Api;

var builder = WebApplication.CreateBuilder(args);

var connStr = builder.Configuration["DB_CONNECTION_STRING"]
    ?? "Host=localhost;Port=5432;Database=admission;Username=postgres;Password=postgres";
var holdSeconds = int.TryParse(builder.Configuration["HOLD_DURATION_SECONDS"], out var hs) && hs > 0 ? hs : 600;

builder.Services.AddSingleton(new NpgsqlDataSourceBuilder(connStr).Build());
builder.Services.AddSingleton(new HoldSettings(holdSeconds));
builder.Services.AddSingleton<Repo>();
builder.Services.AddHostedService<ExpirySweeper>();
// The browser (frontend :3000) calls this API (:8080) directly. "Date" is exposed so the UI can read the
// server clock for its countdown (browsers hide it from JavaScript otherwise).
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Date")));
// numbers must really be JSON numbers: "totalSeats":"10" is rejected with 400
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.NumberHandling = JsonNumberHandling.Strict);

var app = builder.Build();
await app.Services.GetRequiredService<Repo>().InitAsync();

app.UseCors();

// Any unexpected problem is turned into a JSON error. Bad client input is always 4xx, never 500.
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (BadHttpRequestException)
    {
        if (ctx.Response.HasStarted) throw;
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new ErrorBody("Request body is not valid JSON or has wrong field types.", "INVALID_REQUEST"));
    }
    catch (PostgresException ex) when (ex.SqlState != null && ex.SqlState.StartsWith("22"))
    {
        // class 22 = "data exception" (e.g. NUL character in text): the client sent bad data, not a server fault
        if (ctx.Response.HasStarted) throw;
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new ErrorBody("The request contains characters or values that are not allowed.", "INVALID_REQUEST"));
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled error");
        if (ctx.Response.HasStarted) throw;
        ctx.Response.StatusCode = 500;
        await ctx.Response.WriteAsJsonAsync(new ErrorBody("Unexpected server error.", "SERVER_ERROR"));
    }
});

// ASCII digits only. (.NET "\d" would also accept Bengali digits, which would let one student appear under two different ids.)
var studentIdRegex = new Regex("^[0-9]{17}$", RegexOptions.Compiled);

static string Iso(DateTime d) => d.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
static IResult Err(int status, string code, string msg) => Results.Json(new ErrorBody(msg, code), statusCode: status);

// returns null if OK, otherwise an error response
IResult? ReadStudent(HttpRequest req, out string studentId)
{
    studentId = "";
    if (!req.Headers.TryGetValue("X-Student-Id", out var v) || string.IsNullOrWhiteSpace(v.ToString()))
        return Err(400, "MISSING_STUDENT_ID", "X-Student-Id header is required.");
    var s = v.ToString().Trim();
    if (!studentIdRegex.IsMatch(s))
        return Err(400, "INVALID_STUDENT_ID", "X-Student-Id must be the 17-digit birth registration number.");
    studentId = s;
    return null;
}

IResult OutcomeError(Outcome o) => o switch
{
    Outcome.NotFound => Err(404, "NOT_FOUND", "Not found."),
    Outcome.Forbidden => Err(403, "NOT_OWNER", "This application belongs to another student."),
    Outcome.SeatsFull => Err(409, "SEATS_FULL", "No seats available in this class."),
    Outcome.Duplicate => Err(409, "ALREADY_APPLIED", "This student already has an active or confirmed application in this class."),
    Outcome.Expired => Err(409, "HOLD_EXPIRED", "The hold has expired."),
    Outcome.Cancelled => Err(409, "HOLD_CANCELLED", "The application was cancelled."),
    Outcome.Confirmed => Err(409, "ALREADY_CONFIRMED", "A confirmed admission cannot be cancelled."),
    _ => Err(500, "SERVER_ERROR", "Unexpected server error.")
};

app.MapPost("/classes", async (CreateClassRequest? body, Repo repo) =>
{
    var name = body?.Name?.Trim();
    if (string.IsNullOrEmpty(name)) return Err(400, "INVALID_NAME", "name is required.");
    if (name.Length > 200 || name.Any(char.IsControl))
        return Err(400, "INVALID_NAME", "name must be at most 200 characters and contain no control characters.");
    if (body!.TotalSeats is null || body.TotalSeats < 1 || body.TotalSeats > 100000)
        return Err(400, "INVALID_SEATS", "totalSeats must be a whole number between 1 and 100000.");
    var row = await repo.CreateClassAsync(name, body.TotalSeats.Value);
    return Results.Json(new { id = row.Id, name = row.Name, totalSeats = row.TotalSeats }, statusCode: 201);
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/classes", async (Repo repo) => Results.Ok(await repo.ListClassesAsync()));

app.MapGet("/classes/{classId}", async (string classId, Repo repo) =>
{
    var c = await repo.GetClassAsync(classId);
    return c is null ? Err(404, "NOT_FOUND", "Class not found.") : Results.Ok(c);
});

app.MapPost("/classes/{classId}/holds", async (string classId, HttpRequest req, Repo repo) =>
{
    var bad = ReadStudent(req, out var sid);
    if (bad is not null) return bad;
    var (o, h) = await repo.CreateHoldAsync(classId, sid);
    if (o != Outcome.Ok) return OutcomeError(o);
    return Results.Json(new { holdId = h!.HoldId, classId = h.ClassId, studentId = h.StudentId, status = h.Status, expiresAt = Iso(h.ExpiresAt) }, statusCode: 201);
});

app.MapGet("/holds/{holdId}", async (string holdId, Repo repo) =>
{
    var h = await repo.GetHoldAsync(holdId);
    return h is null
        ? Err(404, "NOT_FOUND", "Application not found.")
        : Results.Ok(new { holdId = h.HoldId, classId = h.ClassId, status = h.Status, expiresAt = Iso(h.ExpiresAt) });
});

app.MapPost("/holds/{holdId}/confirm", async (string holdId, HttpRequest req, Repo repo) =>
{
    var bad = ReadStudent(req, out var sid);
    if (bad is not null) return bad;
    var (o, h) = await repo.ConfirmAsync(holdId, sid);
    return o == Outcome.Ok ? Results.Ok(new { holdId = h!.HoldId, status = h.Status }) : OutcomeError(o);
});

app.MapDelete("/holds/{holdId}", async (string holdId, HttpRequest req, Repo repo) =>
{
    var bad = ReadStudent(req, out var sid);
    if (bad is not null) return bad;
    var o = await repo.CancelAsync(holdId, sid);
    return o == Outcome.Ok ? Results.NoContent() : OutcomeError(o);
});

app.MapGet("/me/holds", async (HttpRequest req, Repo repo) =>
{
    var bad = ReadStudent(req, out var sid);
    if (bad is not null) return bad;
    var list = await repo.MyHoldsAsync(sid);
    return Results.Ok(list.Select(h => new { holdId = h.HoldId, classId = h.ClassId, className = h.ClassName, status = h.Status, expiresAt = Iso(h.ExpiresAt) }));
});

app.MapFallback(() => Err(404, "NOT_FOUND", "Route not found."));

app.Run();

public record CreateClassRequest(string? Name, int? TotalSeats);
public record ErrorBody(string Error, string Code);

public class ExpirySweeper : BackgroundService
{
    private readonly Repo _repo; private readonly ILogger<ExpirySweeper> _log;
    public ExpirySweeper(Repo repo, ILogger<ExpirySweeper> log) { _repo = repo; _log = log; }
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await Task.Delay(TimeSpan.FromSeconds(5), ct); await _repo.SweepExpiredAsync(); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _log.LogWarning("Expiry sweep failed: {M}", ex.Message); }
        }
    }
}

public partial class Program { }
