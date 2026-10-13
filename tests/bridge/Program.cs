using System.Buffers.Binary;
using IntentionLab.Bridge;
using IntentionLab.Devices;
int checks = 0;
void Check(bool ok, string name) { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); checks++; }
var provider = new TestProvider(); await using var bridge = new ByteBridge(provider);
var registry = new DeviceRegistry(provider);
var discovered = registry.Discover().Single();
Check(discovered.ProviderId == provider.ProviderId, "registry preserves provider identity");
using (var registeredSource = registry.Open(discovered, false)) Check(registeredSource.Device.Id == discovered.Id, "registry dispatches to selected provider");
provider.ThreadIds.Clear();
await bridge.Connect("fixture", false); await Task.Delay(50);
var status = bridge.Status(); Check(status.Connected, "one provider connected");
var data = bridge.After(0, out bool gap); Check(!gap && data.Length > 0, "read chunks retained");
Check(data.All(c => c.Data.Length == 5), "partial reads preserve actual lengths");
Check(data.All(c => c.Data.SequenceEqual(new byte[] { 0, 255, 85, 170, 1 })), "binary fixture unchanged");
var bytes = ByteBridge.Encode(data); int offset = 0; long last = 0;
while (offset < bytes.Length) { int length = (int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset + 4)); long seq = BinaryPrimitives.ReadInt64LittleEndian(bytes.AsSpan(offset + 8)); Check(seq == ++last, "monotonic exact sequence " + seq); Check(length == 5, "actual byte length in wire frame"); offset += 56 + length; }
var marker = await bridge.Flush(); Check(marker.Flags == 1 && marker.Flushed == 19, "flush coordinated through owning reader");
Check(provider.ThreadIds.Distinct().Count() == 1, "open/read/flush share a single owner thread");
await bridge.Disconnect(); Check(!bridge.Status().Connected, "disconnect completes and releases reader");
provider.Fail = true; await bridge.Connect("fixture", false); await Task.Delay(50); Check(bridge.Status().Error?.Contains("test disconnection") == true, "device errors surface precisely");
Check(bridge.After(long.Parse(bridge.Status().LastSequence), out _).Length == 0, "no duplicate replay after current cursor");
await bridge.Disconnect(); provider.Fail = false; provider.Burst = true; await bridge.Connect("fixture", false);
var until = DateTime.UtcNow.AddSeconds(10); while (long.Parse(bridge.Status().TotalBytes) < ByteBridge.MaxBufferBytes * 2L && DateTime.UtcNow < until) await Task.Delay(10);
await bridge.Disconnect(); bridge.After(0, out bool overflow);
Check(overflow, "bounded buffer explicitly reports expired cursor");
provider.Burst = false; await bridge.Connect("fixture", false); provider.FailFlush = true;
bool flushFailed = false;
try { await bridge.Flush().WaitAsync(TimeSpan.FromSeconds(3)); }
catch (IOException ex) { flushFailed = ex.Message == "test flush failure"; }
Check(flushFailed, "reader flush failure completes command with a precise error");
await bridge.Disconnect(); provider.FailFlush = false; provider.Slow = true;
await bridge.Connect("fixture", false); await Task.Delay(2400);
Check(bridge.Status().Error?.Contains("scheduling gap exceeded 2 seconds") == true, "reader scheduling stall faults the stream");
await bridge.Disconnect();
// The idle watch on a simulated clock, checked every 5 seconds.
long now = 0; bool streaming = false;
var idle = new IdleWatch(180_000, () => now, () => streaming);
bool After(long ms) { bool expired = false; for (long end = now + ms; now < end;) { now = Math.Min(end, now + 5000); expired = idle.Expired(); } return expired; }
Check(!After(175_000) && After(5_000), "bridge quits once no page has been seen for the idle limit");
idle.Seen(); Check(!After(175_000) && After(5_000), "a page ping restarts the idle wait");
idle.Seen(); streaming = true; Check(!After(600_000), "an open byte stream keeps the bridge running");
streaming = false; Check(!After(175_000) && After(5_000), "the idle wait starts when the stream closes");
idle.Seen(); now += 3_600_000; Check(!idle.Expired() && !After(175_000) && After(5_000), "after the computer sleeps, pages get a full idle window");
// Linux discovery on a fixture that mirrors sysfs: class entries link into the device tree.
string sys = Path.Combine(Path.GetTempPath(), "il-sysfs-" + Guid.NewGuid().ToString("N")), ttyClass = Path.Combine(sys, "class", "tty");
Directory.CreateDirectory(ttyClass);
void Usb(string[] path, string vid, string pid, string product, string? serial = null)
{
    string dir = Path.Combine([sys, "devices", .. path]); Directory.CreateDirectory(dir);
    foreach (var (file, value) in new[] { ("idVendor", vid), ("idProduct", pid), ("bcdDevice", "0100"), ("product", product), ("serial", serial) })
        if (value != null) File.WriteAllText(Path.Combine(dir, file), value + "\n");
}
bool Tty(string name, params string[] path)
{
    string target = Path.Combine([sys, "devices", .. path, "tty", name]); Directory.CreateDirectory(target);
    try { Directory.CreateSymbolicLink(Path.Combine(ttyClass, name), Path.GetRelativePath(ttyClass, target)); return true; }
    catch (Exception ex) when (ex is UnauthorizedAccessException or IOException) { return false; }
}
try
{
    Usb(["pci0000_00", "usb1"], "1d6b", "0002", "xHCI Host Controller");
    Usb(["pci0000_00", "usb1", "1-2"], "04d8", "f5fe", "Random source", "A1B2C3");
    Usb(["pci0000_00", "usb1", "1-3"], "0403", "6001", "FT232R USB UART");
    bool linked = Tty("ttyACM0", "pci0000_00", "usb1", "1-2", "1-2.1.0") & Tty("ttyUSB0", "pci0000_00", "usb1", "1-3", "1-3.1.0", "ttyUSB0")
        & Tty("ttyS0", "platform", "serial8250") & Tty("tty0", "virtual");
    if (!linked) Console.WriteLine("SKIP Linux discovery fixture: symbolic links need Developer Mode on Windows");
    else
    {
        var found = LinuxPorts.Discover(ttyClass, "/dev");
        Check(found.Select(d => d.Port).SequenceEqual(["/dev/ttyACM0", "/dev/ttyUSB0"]), "Linux discovery lists USB serial ports only");
        DeviceInfo rng = found[0], adapter = found[1];
        Check(rng.FamilyHint && rng.DeviceType == PortDiscovery.FamilyType && rng.HardwareIds.Contains(@"USB\VID_04D8&PID_F5FE&REV_0100"), "Linux discovery recognises the family by its USB IDs");
        Check(rng.SerialNumber == "A1B2C3" && rng.Label == "Random source" && rng.UsbRevision == "0100" && rng.InstanceId!.Contains(@"\A1B2C3\"), "Linux discovery keeps the serial number, product and revision");
        Check(!adapter.FamilyHint && adapter.Label == "FT232R USB UART" && adapter.InstanceId!.Contains(@"\1-3\") && adapter.Id != rng.Id, "another USB serial adapter is listed for confirmation by hand");
    }
}
finally { Directory.Delete(sys, true); }
Console.WriteLine($"TOTAL {checks} checks");
class TestProvider : IDeviceProvider
{
    public System.Collections.Concurrent.ConcurrentBag<int> ThreadIds { get; } = []; public bool Fail, Burst, FailFlush, Slow;
    public string ProviderId => "test-only";
    public IReadOnlyList<DeviceInfo> Discover() => [new("fixture", "TEST", "Fixture", null, [], true, true)];
    public IByteSource Open(DeviceInfo device, bool explicitlyConfirmUnidentified) { ThreadIds.Add(Environment.CurrentManagedThreadId); return new FixtureSource(this, device); }
    class FixtureSource(TestProvider owner, DeviceInfo device) : IByteSource
    {
        public DeviceInfo Device => device;
        public int Read(byte[] buffer) { owner.ThreadIds.Add(Environment.CurrentManagedThreadId); if (owner.Burst) { Array.Fill(buffer, (byte)170); return buffer.Length; } Thread.Sleep(owner.Slow ? 2100 : 5); if (owner.Fail) throw new IOException("test disconnection"); new byte[] { 0, 255, 85, 170, 1 }.CopyTo(buffer, 0); return 5; }
        public long Flush() { owner.ThreadIds.Add(Environment.CurrentManagedThreadId); if (owner.FailFlush) throw new IOException("test flush failure"); return 19; }
        public void Dispose() { }
    }
}
