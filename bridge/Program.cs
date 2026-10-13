using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using IntentionLab.Bridge;
using IntentionLab.Devices;
using Microsoft.Extensions.FileProviders;

bool openBrowser = !args.Contains("--no-browser", StringComparer.OrdinalIgnoreCase);
try
{
    int port = int.TryParse(Environment.GetEnvironmentVariable("INTENTIONLAB_PORT"), out int configured) ? configured : 29871;
    if (port < 1024 || port > 65535) throw new ArgumentException("Choose a port from 1024 to 65535.");
    // Quit this long after the last page has gone; 0 keeps running until shut down.
    int idleSeconds = int.TryParse(Environment.GetEnvironmentVariable("INTENTIONLAB_IDLE_SECONDS"), out int idleSetting) ? idleSetting : 180;
    if (idleSeconds < 0) throw new ArgumentException("INTENTIONLAB_IDLE_SECONDS is a number of seconds, or 0 to keep running.");
    string origin = $"http://127.0.0.1:{port}";
    if (await DesktopLauncher.IsRunning(origin))
    {
        if (openBrowser) DesktopLauncher.OpenBrowser(origin);
        return;
    }
    string appPath = Environment.GetEnvironmentVariable("INTENTIONLAB_APP_DIR") ?? Path.Combine(AppContext.BaseDirectory, "app");
    if (!Directory.Exists(appPath)) throw new DirectoryNotFoundException("App folder not found: " + appPath);
    string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    // The package version from Directory.Build.props, with the commit when built from git.
    string version = typeof(Bootstrap).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
    var builder = WebApplication.CreateSlimBuilder(args.Where(a => !a.Equals("--no-browser", StringComparison.OrdinalIgnoreCase)).ToArray());
    // Failures reach the person as messages; a terminal stays quiet otherwise.
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(k => { k.Listen(IPAddress.Loopback, port); k.Limits.MaxRequestBodySize = 16384; });
    builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, BridgeJson.Default));
    builder.Services.AddSingleton<IDeviceProvider>(_ => new DeviceRegistry(new TrueRngProvider())); builder.Services.AddSingleton<ByteBridge>();
    await using var app = builder.Build(); var bridge = app.Services.GetRequiredService<ByteBridge>();
    var controlGate = new SemaphoreSlim(1, 1);
    // Only one stream subscriber at a time. Open pages also ping every 30 seconds.
    int subscribed = 0;
    var idle = new IdleWatch(idleSeconds * 1000L, () => Environment.TickCount64, () => Volatile.Read(ref subscribed) != 0);
    app.Use(async (context, next) =>
    {
        if (context.Request.Host.Value != $"127.0.0.1:{port}" || (context.Request.Headers.Origin.Count > 0 && context.Request.Headers.Origin != origin)) { context.Response.StatusCode = 403; return; }
        idle.Seen();
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Content-Security-Policy"] = $"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
        if (context.Request.Path.StartsWithSegments("/bridge")) context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method != "GET" && context.Request.Headers["X-Bridge-Token"] != token) { context.Response.StatusCode = 403; return; }
        try { await next(); } catch (Exception ex) when (ex is not OperationCanceledException) { if (!context.Response.HasStarted) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new BridgeError(ex.Message), BridgeJson.Default.BridgeError); } }
    });
    app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
    var files = new PhysicalFileProvider(Path.GetFullPath(appPath));
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files }); app.UseStaticFiles(new StaticFileOptions { FileProvider = files, OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "no-cache" });
    app.MapGet("/bridge/bootstrap", () => new Bootstrap(token, bridge.Status(), 1, version));
    app.MapGet("/bridge/devices", () => bridge.Discover().ToArray());
    app.MapGet("/bridge/status", () => bridge.Status());
    app.MapPost("/bridge/connect", async (ConnectRequest r) => { await controlGate.WaitAsync(); try { await bridge.Connect(r.DeviceId, r.ConfirmUnidentified); return bridge.Status(); } finally { controlGate.Release(); } });
    app.MapPost("/bridge/disconnect", async () => { await controlGate.WaitAsync(); try { await bridge.Disconnect(); return bridge.Status(); } finally { controlGate.Release(); } });
    app.MapPost("/bridge/flush", async () => { var c = await bridge.Flush(); return new FlushResult(c.Sequence.ToString(), c.End, c.Flushed.ToString()); });
    app.MapPost("/bridge/shutdown", () => { app.Lifetime.StopApplication(); return new BridgeError("Bridge stopped"); });
    // Auth is the first WS message: no credential in URLs/logs.
    app.Map("/bridge/stream", async context =>
    {
        if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = 400; return; }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, app.Lifetime.ApplicationStopping);
        stop.CancelAfter(TimeSpan.FromSeconds(5)); var buffer = new byte[8192];
        var auth = await socket.ReceiveAsync(buffer.AsMemory(), stop.Token);
        if (!auth.EndOfMessage || auth.MessageType != WebSocketMessageType.Text) return;
        var hello = JsonSerializer.Deserialize(buffer.AsSpan(0, auth.Count), BridgeJson.Default.Subscribe);
        if (hello?.Token != token) return;
        if (Interlocked.CompareExchange(ref subscribed, 1, 0) != 0) { await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Stream already owned", CancellationToken.None); return; }
        stop.CancelAfter(Timeout.InfiniteTimeSpan);
        try
        {
            var status = bridge.Status();
            await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(status, BridgeJson.Default.BridgeStatus), WebSocketMessageType.Text, true, stop.Token);
            if (hello.StreamId != null && hello.StreamId != status.StreamId) { await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Stream changed; recovery unavailable", stop.Token); return; }
            long cursor = hello.After == null ? long.Parse(status.LastSequence) : long.Parse(hello.After);
            if (cursor > long.Parse(status.LastSequence)) throw new IOException("Cursor is ahead of this stream.");
            // Consume acknowledgments concurrently; retention is bounded by time/memory, never by ACK arrival.
            var receiver = Task.Run(async () => { try { while (socket.State == WebSocketState.Open) { var r = await socket.ReceiveAsync(buffer.AsMemory(), stop.Token); if (r.MessageType == WebSocketMessageType.Close) break; if (!r.EndOfMessage) throw new IOException("Oversized command"); } } catch (OperationCanceledException) { } catch (WebSocketException) { } finally { stop.Cancel(); } });
            double lastStatus = 0;
            try
            {
                while (!stop.IsCancellationRequested && socket.State == WebSocketState.Open)
                {
                    var batch = bridge.After(cursor, out bool gap);
                    if (gap) { await socket.CloseOutputAsync(WebSocketCloseStatus.PolicyViolation, "Recovery buffer expired or overflowed", stop.Token); break; }
                    if (batch.Length > 0) { await socket.SendAsync(ByteBridge.Encode(batch), WebSocketMessageType.Binary, true, stop.Token); cursor = batch[^1].Sequence; }
                    if (bridge.Now - lastStatus >= .25) { lastStatus = bridge.Now; await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(bridge.Status(), BridgeJson.Default.BridgeStatus), WebSocketMessageType.Text, true, stop.Token); }
                    if (batch.Length == 0) await Task.Delay(10, stop.Token);
                }
            }
            finally { stop.Cancel(); try { await receiver; } catch (OperationCanceledException) { } }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        finally { Interlocked.Exchange(ref subscribed, 0); }
    });
    try { await app.StartAsync(); }
    catch (IOException ex)
    {
        // Simultaneous double-clicks can both pass the first probe. Only the process
        // that binds loopback owns the bridge; the other opens the existing app.
        if (await DesktopLauncher.WaitForRunning(origin))
        {
            if (openBrowser) DesktopLauncher.OpenBrowser(origin);
            return;
        }
        throw new IOException($"Intention Lab cannot use port {port}: another program is using it, or the system has reserved it.\n\nClose that program and start Intention Lab again. Your history belongs to {origin}, so another port would open with an empty history.\n\n{ex.Message}", ex);
    }
    if (idleSeconds > 0) _ = QuitWhenIdle(app.Lifetime, idle, TimeSpan.FromSeconds(Math.Clamp(idleSeconds / 4.0, .25, 5)));
    if (openBrowser) DesktopLauncher.OpenBrowser(origin);
    await app.WaitForShutdownAsync();
}
catch (Exception ex)
{
    DesktopLauncher.ShowError(ex.Message, openBrowser);
    Environment.ExitCode = 1;
}

// Stopping disposes the bridge, which disconnects the device.
static async Task QuitWhenIdle(IHostApplicationLifetime life, IdleWatch idle, TimeSpan every)
{
    try { while (!idle.Expired()) await Task.Delay(every, life.ApplicationStopping); life.StopApplication(); }
    catch (OperationCanceledException) { }
}

record Bootstrap(string Token, BridgeStatus Status, int Protocol, string Version, string Application = DesktopLauncher.ApplicationId);
record BridgeError(string Error);
record ConnectRequest(string DeviceId, bool ConfirmUnidentified = false);
record FlushResult(string Sequence, double Monotonic, string Bytes);
record Subscribe(string Token, string? StreamId = null, string? After = null);
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(Bootstrap))]
[JsonSerializable(typeof(BridgeStatus))]
[JsonSerializable(typeof(DeviceInfo[]))]
[JsonSerializable(typeof(BridgeError))]
[JsonSerializable(typeof(ConnectRequest))]
[JsonSerializable(typeof(FlushResult))]
[JsonSerializable(typeof(Subscribe))]
internal partial class BridgeJson : JsonSerializerContext { }
