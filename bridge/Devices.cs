using System.ComponentModel;
using System.IO.Ports;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace IntentionLab.Devices;

/// <summary>A provider discovers devices but never opens one during discovery.</summary>
public interface IDeviceProvider
{
    string ProviderId { get; }
    IReadOnlyList<DeviceInfo> Discover();
    IByteSource Open(DeviceInfo device, bool explicitlyConfirmUnidentified);
}
/// <summary>Owned exclusively by the acquisition thread. Read returns the actual number of binary bytes.</summary>
public interface IByteSource : IDisposable
{
    DeviceInfo Device { get; }
    int Read(byte[] buffer);
    long Flush();
}
/// <summary>Register additional providers here without changing byte delivery or the JS app.</summary>
public sealed class DeviceRegistry(params IDeviceProvider[] providers) : IDeviceProvider
{
    public string ProviderId => "registry-v1";
    public IReadOnlyList<DeviceInfo> Discover() => providers.SelectMany(p =>
        p.Discover().Select(d => d with { ProviderId = p.ProviderId })).ToArray();
    public IByteSource Open(DeviceInfo device, bool explicitlyConfirmUnidentified) =>
        (providers.SingleOrDefault(p => p.ProviderId == device.ProviderId)
            ?? throw new InvalidOperationException("Device provider is not registered.")).Open(device, explicitlyConfirmUnidentified);
}
public sealed class TrueRngProvider : IDeviceProvider
{
    public string ProviderId => PortDiscovery.FamilyProvider;
    public IReadOnlyList<DeviceInfo> Discover() => PortDiscovery.Discover();
    public IByteSource Open(DeviceInfo device, bool explicitlyConfirmUnidentified)
    {
        if (device.Port == null || !device.Present) throw new InvalidOperationException("The device has no serial port. Reconnect it. On Windows, install the manufacturer's driver if Device Manager shows an unknown device.");
        if (!device.FamilyHint && !explicitlyConfirmUnidentified) throw new InvalidOperationException("This port is unidentified. Select and explicitly confirm it before connecting.");
        return new SerialByteSource(device);
    }
}
public sealed class SerialByteSource : IByteSource
{
    readonly SerialPort port;
    public DeviceInfo Device { get; }
    public SerialByteSource(DeviceInfo device)
    {
        Device = device;
        port = new SerialPort(device.Port!, 115200, Parity.None, 8, StopBits.One)
        {
            Handshake = Handshake.None,
            DtrEnable = true,
            RtsEnable = false,
            DiscardNull = false,
            ReadTimeout = 100,
            WriteTimeout = 100,
            ReadBufferSize = 65536
        };
        try { port.Open(); }
        catch (UnauthorizedAccessException ex) { port.Dispose(); throw new IOException(Denied(device.Port!), ex); }
        catch (Exception ex) when (ex is IOException or ArgumentException) { port.Dispose(); throw new IOException("Cannot open " + device.Port + ". Check the USB connection and that no other program is using it: " + ex.Message, ex); }
    }
    // Linux gives serial ports to a group: dialout on Debian, Ubuntu and Fedora, uucp on Arch.
    static string Denied(string port) => OperatingSystem.IsWindows()
        ? "Cannot open " + port + ". Another program may be using it, or Windows denied access. Close other serial tools and reconnect."
        : "Cannot open " + port + ". Another program may be using it, or your account may not have access to serial ports. To get access, run: sudo usermod -aG dialout $USER (on Arch Linux the group is uucp), then log out and back in.";
    public int Read(byte[] buffer)
    {
        try { return port.Read(buffer, 0, buffer.Length); }
        catch (TimeoutException) { return 0; }
    }
    public long Flush() { long observed = port.BytesToRead; port.DiscardInBuffer(); return observed; }
    public void Dispose() => port.Dispose();
}

/// <summary>Every serial port, with the recognised random number generator family marked by its USB IDs.</summary>
public static class PortDiscovery
{
    // Recorded with each session; the app shows these names only in Lab mode.
    public const string FamilyUsbId = "VID_04D8&PID_F5FE", FamilyType = "ubld.it TrueRNG V1/V2/V3 family", FamilyProvider = "ubld.it.truerng.serial-v1";
    public static bool IsFamily(IEnumerable<string> hardwareIds) => hardwareIds.Any(x => x.Contains(FamilyUsbId, StringComparison.OrdinalIgnoreCase));
    public static IReadOnlyList<DeviceInfo> Discover()
    {
        var result = new List<DeviceInfo>();
        if (OperatingSystem.IsWindows()) WindowsPorts.Discover(result);
        else if (OperatingSystem.IsLinux()) result.AddRange(LinuxPorts.Discover());
        // Any other serial port can still be chosen and confirmed by hand.
        foreach (var p in SerialPort.GetPortNames().Distinct().Order()) if (result.All(x => x.Port != p)) result.Add(new("serial:" + p, p, "Unidentified serial port", null, [], false, true));
        return result.OrderByDescending(x => x.FamilyHint).ThenBy(x => x.Port).ToArray();
    }
}

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
static class WindowsPorts
{
    public static void Discover(List<DeviceInfo> result)
    {
        IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, 6); // PRESENT | ALLCLASSES
        if (set == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows device discovery failed.");
        try
        {
            for (uint index = 0; ; index++)
            {
                var info = new SpDevInfo { Size = (uint)Marshal.SizeOf<SpDevInfo>() };
                if (!SetupDiEnumDeviceInfo(set, index, ref info)) break;
                string[] ids = Property(set, ref info, 1).Split('\0', StringSplitOptions.RemoveEmptyEntries);
                bool family = PortDiscovery.IsFamily(ids);
                string? port = null;
                IntPtr key = SetupDiOpenDevRegKey(set, ref info, 1, 0, 1, 0x20019);
                if (key != new IntPtr(-1))
                {
                    using var reg = RegistryKey.FromHandle(new SafeRegistryHandle(key, true));
                    port = reg.GetValue("PortName") as string;
                }
                if (port?.StartsWith("COM", StringComparison.OrdinalIgnoreCase) != true) port = null;
                if (port == null && !family) continue;
                var id = new StringBuilder(2048);
                SetupDiGetDeviceInstanceIdW(set, ref info, id, id.Capacity, out _);
                string instance = id.ToString();
                string name = Property(set, ref info, 12).TrimEnd('\0');
                if (string.IsNullOrWhiteSpace(name)) name = Property(set, ref info, 0).TrimEnd('\0');
                string? revision = ids.SelectMany(x => x.Split('&')).FirstOrDefault(x => x.StartsWith("REV_"))?[4..];
                result.Add(new("usb:" + Json.Hash(instance)[..24], port, name, instance, ids, family, true,
                    UsbRevision: revision, DeviceType: family ? PortDiscovery.FamilyType : "Serial byte source", ProviderId: family ? PortDiscovery.FamilyProvider : "serial-byte-source-v1", DriverProblem: port == null ? "Present USB device has no COM port; check the manufacturer's driver in Device Manager." : null));
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
    }
    static string Property(IntPtr set, ref SpDevInfo info, uint property)
    {
        var bytes = new byte[8192];
        return SetupDiGetDeviceRegistryPropertyW(set, ref info, property, out _, bytes, (uint)bytes.Length, out uint required)
            ? Encoding.Unicode.GetString(bytes, 0, (int)Math.Min(required, bytes.Length)) : "";
    }
    [StructLayout(LayoutKind.Sequential)] struct SpDevInfo { public uint Size; public Guid ClassGuid; public uint DevInst; public UIntPtr Reserved; }
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(IntPtr guid, string? enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref SpDevInfo info);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr set, ref SpDevInfo info, uint property, out uint type, byte[] buffer, uint size, out uint required);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref SpDevInfo info, StringBuilder id, int size, out int required);
    [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiOpenDevRegKey(IntPtr set, ref SpDevInfo info, uint scope, uint profile, uint type, int access);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
}
