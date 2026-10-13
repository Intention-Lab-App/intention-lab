namespace IntentionLab.Bridge;

/// <summary>
/// Decides when the bridge has outlived its pages. Open pages ping it, so any
/// request is a sign of life, and so is an open byte stream. Times are
/// milliseconds on a monotonic clock.
/// </summary>
public sealed class IdleWatch(long limitMs, Func<long> clock, Func<bool> streaming)
{
    // A pause this long between checks means the computer slept: pages get a
    // full window to reach the bridge again before it quits.
    public const long SleepMs = 30_000;
    long lastSeen = clock(), lastCheck = clock();

    public void Seen() => Interlocked.Exchange(ref lastSeen, clock());

    /// <summary>Call regularly, at least every few seconds.</summary>
    public bool Expired()
    {
        long now = clock();
        if (streaming() || now - lastCheck > SleepMs) Seen();
        lastCheck = now;
        return now - Interlocked.Read(ref lastSeen) >= limitMs;
    }
}
