using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using SchoolAdmission.Api;
using Xunit;

namespace SchoolAdmission.Tests;

/// <summary>Starts the real API in-process against a real PostgreSQL (see docker-compose.test.yml).</summary>
public class ApiFixture : WebApplicationFactory<Program>
{
    public ApiFixture()
    {
        var cs = Environment.GetEnvironmentVariable("TEST_DB_CONNECTION")
                 ?? "Host=localhost;Port=5432;Database=admission_test;Username=admission;Password=admission;Maximum Pool Size=50";
        Environment.SetEnvironmentVariable("DB_CONNECTION_STRING", cs);
        Environment.SetEnvironmentVariable("HOLD_DURATION_SECONDS", "600");
    }
    public HoldSettings Hold => Services.GetRequiredService<HoldSettings>();
}

public class AdmissionApiTests : IClassFixture<ApiFixture>
{
    private readonly ApiFixture _f;
    private readonly HttpClient _http;
    public AdmissionApiTests(ApiFixture f) { _f = f; _http = f.CreateClient(); }

    private static string NewStudent() => string.Concat(Enumerable.Range(0, 17).Select(_ => Random.Shared.Next(10)));

    private async Task<string> NewClass(int seats)
    {
        var r = await _http.PostAsJsonAsync("/classes", new { name = "Class 6 Morning " + Guid.NewGuid().ToString("N")[..6], totalSeats = seats });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private Task<HttpResponseMessage> Send(HttpMethod m, string url, string? student)
    {
        var req = new HttpRequestMessage(m, url);
        if (student != null) req.Headers.Add("X-Student-Id", student);
        return _http.SendAsync(req);
    }

    private async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();
    private async Task<JsonElement> Stats(string classId) => await Json(await _http.GetAsync("/classes/" + classId));

    [Fact]
    public async Task Concurrent_applications_never_exceed_total_seats()
    {
        const int seats = 5, students = 60;
        var cid = await NewClass(seats);
        var results = await Task.WhenAll(Enumerable.Range(0, students)
            .Select(_ => Task.Run(() => Send(HttpMethod.Post, $"/classes/{cid}/holds", NewStudent()))));
        var codes = results.Select(r => r.StatusCode).ToList();
        Assert.Equal(seats, codes.Count(c => c == HttpStatusCode.Created));
        Assert.Equal(students - seats, codes.Count(c => c == HttpStatusCode.Conflict));
        Assert.DoesNotContain(codes, c => (int)c >= 500);
        var s = await Stats(cid);
        Assert.Equal(seats, s.GetProperty("heldSeats").GetInt32());
        Assert.Equal(0, s.GetProperty("availableSeats").GetInt32());
    }

    [Fact]
    public async Task Confirm_twice_counts_the_seat_only_once_and_only_owner_can_confirm()
    {
        var cid = await NewClass(3);
        var me = NewStudent();
        var hold = await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", me));
        var hid = hold.GetProperty("holdId").GetString()!;
        Assert.Equal("HELD", hold.GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Post, $"/holds/{hid}/confirm", NewStudent())).StatusCode);
        for (var i = 0; i < 3; i++)
        {
            var c = await Send(HttpMethod.Post, $"/holds/{hid}/confirm", me);
            Assert.Equal(HttpStatusCode.OK, c.StatusCode);
            Assert.Equal("CONFIRMED", (await Json(c)).GetProperty("status").GetString());
        }
        var s = await Stats(cid);
        Assert.Equal(1, s.GetProperty("confirmedSeats").GetInt32());
        Assert.Equal(0, s.GetProperty("heldSeats").GetInt32());
        Assert.Equal(2, s.GetProperty("availableSeats").GetInt32());
    }

    [Fact]
    public async Task Same_student_cannot_hold_twice_in_one_class_but_can_in_another()
    {
        var a = await NewClass(5); var b = await NewClass(5);
        var me = NewStudent();
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, $"/classes/{a}/holds", me)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Post, $"/classes/{a}/holds", me)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, $"/classes/{b}/holds", me)).StatusCode);
        Assert.Equal(2, (await Json(await Send(HttpMethod.Get, "/me/holds", me))).GetArrayLength());
    }

    [Fact]
    public async Task Hold_expires_automatically_and_returns_the_seat()
    {
        var old = _f.Hold.Seconds;
        _f.Hold.Seconds = 1;
        try
        {
            var cid = await NewClass(1);
            var me = NewStudent();
            var hid = (await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", me))).GetProperty("holdId").GetString()!;
            Assert.Equal(0, (await Stats(cid)).GetProperty("availableSeats").GetInt32());

            await Task.Delay(2500); // no API call in between: expiry must happen on its own
            Assert.Equal(1, (await Stats(cid)).GetProperty("availableSeats").GetInt32());
            Assert.Equal("EXPIRED", (await Json(await _http.GetAsync("/holds/" + hid))).GetProperty("status").GetString());
            Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Post, $"/holds/{hid}/confirm", me)).StatusCode);
            // another student can now take the seat
            Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", NewStudent())).StatusCode);
        }
        finally { _f.Hold.Seconds = old; }
    }

    [Fact]
    public async Task Cancel_releases_the_seat_and_confirmed_admission_cannot_be_cancelled()
    {
        var cid = await NewClass(2);
        var me = NewStudent();
        var hid = (await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", me))).GetProperty("holdId").GetString()!;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Delete, $"/holds/{hid}", NewStudent())).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"/holds/{hid}", me)).StatusCode);
        Assert.Equal(2, (await Stats(cid)).GetProperty("availableSeats").GetInt32());
        Assert.Equal("CANCELLED", (await Json(await _http.GetAsync("/holds/" + hid))).GetProperty("status").GetString());

        var hid2 = (await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", me))).GetProperty("holdId").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, $"/holds/{hid2}/confirm", me)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Delete, $"/holds/{hid2}", me)).StatusCode);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"name\":\"  \",\"totalSeats\":10}")]
    [InlineData("{\"name\":\"X\",\"totalSeats\":0}")]
    [InlineData("{\"name\":\"X\",\"totalSeats\":-5}")]
    [InlineData("{\"name\":\"X\",\"totalSeats\":\"many\"}")]
    [InlineData("{\"name\":\"X\",\"totalSeats\":2.5}")]
    [InlineData("{\"name\":\"X\",\"totalSeats\":\"10\"}")]            // a string is not a number
    [InlineData("{\"name\":\"a\\u0000b\",\"totalSeats\":5}")]         // NUL character: used to be a 500
    [InlineData("{\"name\":\"line1\\nline2\",\"totalSeats\":5}")]     // control character
    [InlineData("not json at all")]
    public async Task Bad_class_input_gives_4xx_never_500(string body)
    {
        var r = await _http.PostAsync("/classes", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.InRange((int)r.StatusCode, 400, 499);
    }

    [Fact]
    public async Task Bad_ids_headers_and_unknown_resources_give_4xx_never_500()
    {
        var cid = await NewClass(1);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", "123")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", "abcdefghijklmnopq")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Get, "/me/holds", "")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Post, "/classes/nope/holds", NewStudent())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.GetAsync("/classes/nope")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.GetAsync("/holds/nope")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Post, "/holds/nope/confirm", NewStudent())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Delete, "/holds/nope", NewStudent())).StatusCode);
    }

    [Fact]
    public async Task Bengali_digits_are_not_accepted_as_a_student_id()
    {
        var cid = await NewClass(3);
        var bengali = "১২৩৪৫৬৭৮৯০১২৩৪৫৬৭"; // 17 Bengali digits
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", bengali)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Get, "/me/holds", bengali)).StatusCode);
    }

    [Fact]
    public async Task Hold_status_does_not_leak_the_student_id_and_has_the_documented_fields()
    {
        var cid = await NewClass(2);
        var hold = await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", NewStudent()));
        var read = await Json(await _http.GetAsync("/holds/" + hold.GetProperty("holdId").GetString()));
        Assert.False(read.TryGetProperty("studentId", out _));
        foreach (var f in new[] { "holdId", "classId", "status", "expiresAt" }) Assert.True(read.TryGetProperty(f, out _), f);
        Assert.EndsWith("Z", read.GetProperty("expiresAt").GetString());
    }

    [Fact]
    public async Task Browser_may_read_the_Date_header_of_the_server()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/classes");
        req.Headers.Add("Origin", "http://localhost:3000");
        var r = await _http.SendAsync(req);
        Assert.Contains("Date", r.Headers.GetValues("Access-Control-Expose-Headers").SelectMany(v => v.Split(',')).Select(v => v.Trim()));
    }

    /// <summary>
    /// Bonus (spec 1.6): two separate backend instances, each with its own connection pool, work on the SAME database.
    /// The seat limit is enforced by the database (row lock on the class), not by memory inside one process, so it must still hold.
    /// </summary>
    [Fact]
    public async Task Two_backend_instances_on_one_database_never_exceed_the_seat_limit()
    {
        await using var second = new ApiFixture();
        var other = second.CreateClient();
        var cid = await NewClass(30);
        var tasks = Enumerable.Range(0, 400).Select(async i =>
        {
            var client = i % 2 == 0 ? _http : other; // alternate between instance 1 and instance 2
            var req = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cid}/holds");
            req.Headers.Add("X-Student-Id", NewStudent());
            return (int)(await client.SendAsync(req)).StatusCode;
        }).ToArray();
        var codes = await Task.WhenAll(tasks);
        Assert.Equal(30, codes.Count(c => c == 201));
        Assert.Equal(370, codes.Count(c => c == 409));
        var s = await Json(await other.GetAsync("/classes/" + cid));
        Assert.Equal(30, s.GetProperty("heldSeats").GetInt32());
        Assert.Equal(0, s.GetProperty("availableSeats").GetInt32());
    }
}
