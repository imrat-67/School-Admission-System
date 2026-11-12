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
                 ?? "Host=localhost;Port=5432;Database=admission_test;Username=admission;Password=admission;Maximum Pool Size=200";
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
    public async Task Admin_can_edit_a_class_but_never_below_the_seats_already_used()
    {
        var cid = await NewClass(5);
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", NewStudent())).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", NewStudent())).StatusCode);
        var low = await _http.PutAsJsonAsync("/classes/" + cid, new { name = "Class 7 Day Shift", totalSeats = 1 });
        Assert.Equal(HttpStatusCode.Conflict, low.StatusCode);
        var ok = await _http.PutAsJsonAsync("/classes/" + cid, new { name = "Class 7 Day Shift", totalSeats = 8 });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var s = await Stats(cid);
        Assert.Equal("Class 7 Day Shift", s.GetProperty("name").GetString());
        Assert.Equal(8, s.GetProperty("totalSeats").GetInt32());
        Assert.Equal(6, s.GetProperty("availableSeats").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await _http.PutAsJsonAsync("/classes/" + cid, new { name = "", totalSeats = 3 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.PutAsJsonAsync("/classes/nope", new { name = "X", totalSeats = 3 })).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_class_hides_it_stops_applications_and_keeps_confirmed_admissions()
    {
        var cid = await NewClass(3);
        var a = NewStudent(); var b = NewStudent();
        var hA = (await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", a))).GetProperty("holdId").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, $"/holds/{hA}/confirm", a)).StatusCode);
        var hB = (await Json(await Send(HttpMethod.Post, $"/classes/{cid}/holds", b))).GetProperty("holdId").GetString()!;
        Assert.Equal(HttpStatusCode.NoContent, (await _http.DeleteAsync("/classes/" + cid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.GetAsync("/classes/" + cid)).StatusCode);
        Assert.DoesNotContain((await Json(await _http.GetAsync("/classes"))).EnumerateArray(), c => c.GetProperty("id").GetString() == cid);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Post, $"/classes/{cid}/holds", NewStudent())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.DeleteAsync("/classes/" + cid)).StatusCode);
        Assert.Equal("CONFIRMED", (await Json(await _http.GetAsync("/holds/" + hA))).GetProperty("status").GetString());
        Assert.Equal("CANCELLED", (await Json(await _http.GetAsync("/holds/" + hB))).GetProperty("status").GetString());
    }
}
