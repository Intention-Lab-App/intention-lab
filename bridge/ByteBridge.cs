using System.Buffers.Binary;
using System.Diagnostics;
using IntentionLab.Devices;
namespace IntentionLab.Bridge;

public record BridgeStatus(string InstanceId, string? StreamId, DeviceInfo? Device, bool Connected, string? Error,
    double Monotonic, double UtcMs, string FirstSequence, string LastSequence, string TotalBytes, double BitsPerSecond,
    int BufferSeconds, int BufferBytes, int Protocol = 1);
public record WireChunk(long Sequence, double Start, double End, double UtcMs, byte[] Data, uint Flags = 0, long Flushed = 0);

/// <summary>One owning thread; no game, phase, counting, database or filesystem responsibilities.</summary>
public sealed class ByteBridge : IAsyncDisposable
{
    public const int RetentionSeconds = 120, MaxBufferBytes = 64 * 1024 * 1024, MaxChunks = 250_000;
    readonly object gate = new(); readonly Queue<WireChunk> ring = new(); readonly Dictionary<long, WireChunk> bySequence = new();
    readonly Stopwatch uptime = Stopwatch.StartNew(); readonly IDeviceProvider provider;
    CancellationTokenSource? stop; Task? reader; long seq, total; int retained;
    string? stream, error; DeviceInfo? device; bool connected; double began;
    TaskCompletionSource<WireChunk>? pendingFlush;
    public string InstanceId { get; } = Guid.NewGuid().ToString();
    public double Now => uptime.Elapsed.TotalSeconds;
    public ByteBridge(IDeviceProvider provider) => this.provider = provider;
    public IReadOnlyList<DeviceInfo> Discover() => provider.Discover();
    public BridgeStatus Status()
    {
        lock (gate) return new(InstanceId, stream, device, connected, error, Now, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        (ring.TryPeek(out var first) ? first.Sequence : seq + 1).ToString(), seq.ToString(), total.ToString(), Now > began ? total * 8 / (Now - began) : 0, RetentionSeconds, MaxBufferBytes);
    }
    public async Task Connect(string id, bool confirm)
    {
        if (connected) { if (device?.Id == id) return; throw new InvalidOperationException("Disconnect the current device first."); }
        await Disconnect();
        var selected = provider.Discover().SingleOrDefault(d => d.Id == id) ?? throw new ArgumentException("The selected device is no longer present. Refresh discovery.");
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (gate) { ring.Clear(); bySequence.Clear(); retained = 0; seq = total = 0; stream = Guid.NewGuid().ToString(); device = selected; error = null; began = Now; stop = new(); }
        reader = Task.Factory.StartNew(() => Read(selected, confirm, ready, stop.Token), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        await ready.Task;
    }
    void Read(DeviceInfo selected, bool confirm, TaskCompletionSource ready, CancellationToken ct)
    {
        try
        {
            using var source = provider.Open(selected, confirm);
            source.Flush(); lock (gate) connected = true; ready.TrySetResult();
            byte[] buffer = new byte[8192]; double lastMono = Now, lastUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
            while (!ct.IsCancellationRequested)
            {
                TaskCompletionSource<WireChunk>? flush; lock (gate) { flush = pendingFlush; pendingFlush = null; }
                if (flush != null)
                {
                    try { double start = Now; long n = source.Flush(); var marker = Append(start, Now, [], 1, n); flush.TrySetResult(marker); }
                    catch (Exception ex) { flush.TrySetException(ex); throw; }
                }
                double begin = Now; int nRead = source.Read(buffer); double end = Now, utc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
                if (end - lastMono > 2 || Math.Abs((utc - lastUtc) - (end - lastMono)) > 2) throw new IOException("System sleep or reader scheduling gap exceeded 2 seconds.");
                lastMono = end; lastUtc = utc;
                if (nRead < 0 || nRead > buffer.Length) throw new IOException("Provider returned an invalid byte count.");
                // Empty reads are timestamped, too, so the consumer can detect capture gaps.
                Append(begin, end, buffer.AsSpan(0, nRead).ToArray());
            }
        }
        catch (Exception ex) { lock (gate) error = ex.Message; ready.TrySetException(ex); }
        finally { lock (gate) { connected = false; pendingFlush?.TrySetException(new IOException(error ?? "Device disconnected")); pendingFlush = null; } }
    }
    WireChunk Append(double start, double end, byte[] bytes, uint flags = 0, long flushed = 0)
    {
        lock (gate)
        {
            var c = new WireChunk(++seq, start, end, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), bytes, flags, flushed);
            ring.Enqueue(c); bySequence[c.Sequence] = c; retained += bytes.Length + 56; total += bytes.Length;
            while (ring.Count > 0 && (retained > MaxBufferBytes || ring.Count > MaxChunks || end - ring.Peek().End > RetentionSeconds)) { var old = ring.Dequeue(); bySequence.Remove(old.Sequence); retained -= old.Data.Length + 56; }
            return c;
        }
    }
    public Task<WireChunk> Flush() { lock (gate) { if (!connected) throw new IOException("No device connected."); return (pendingFlush ??= new(TaskCreationOptions.RunContinuationsAsynchronously)).Task; } }
    public WireChunk[] After(long cursor, out bool gap)
    { lock (gate) { gap = ring.TryPeek(out var first) && cursor < first.Sequence - 1; if (gap) return []; var result = new List<WireChunk>(); for (long n = cursor + 1; n <= seq && result.Count < 256; n++) if (bySequence.TryGetValue(n, out var c)) result.Add(c); return result.ToArray(); } }
    public static byte[] Encode(WireChunk[] chunks)
    {
        byte[] message = new byte[chunks.Sum(c => 56 + c.Data.Length)]; int offset = 0;
        foreach (var c in chunks)
        {
            var span = message.AsSpan(offset); BinaryPrimitives.WriteUInt32LittleEndian(span, 0x31474E52); // RNG1
            BinaryPrimitives.WriteUInt32LittleEndian(span[4..], (uint)c.Data.Length);
            BinaryPrimitives.WriteInt64LittleEndian(span[8..], c.Sequence);
            BinaryPrimitives.WriteDoubleLittleEndian(span[16..], c.Start);
            BinaryPrimitives.WriteDoubleLittleEndian(span[24..], c.End);
            BinaryPrimitives.WriteDoubleLittleEndian(span[32..], c.UtcMs);
            BinaryPrimitives.WriteUInt32LittleEndian(span[40..], c.Flags);
            BinaryPrimitives.WriteInt64LittleEndian(span[48..], c.Flushed);
            c.Data.CopyTo(span[56..]); offset += 56 + c.Data.Length;
        }
        return message;
    }
    public async Task Disconnect() { stop?.Cancel(); if (reader != null) await reader; stop?.Dispose(); stop = null; reader = null; }
    public ValueTask DisposeAsync() => new(Disconnect());
}
