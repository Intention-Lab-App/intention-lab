namespace IntentionLab.Devices;

/// <summary>
/// USB serial ports from sysfs. Each /sys/class/tty entry links to its place
/// under /sys/devices, where the USB device above it carries the vendor and
/// product IDs. Discovery reads those files and never opens a port.
/// </summary>
public static class LinuxPorts
{
    public static IReadOnlyList<DeviceInfo> Discover(string ttyClass = "/sys/class/tty", string devices = "/dev")
    {
        var result = new List<DeviceInfo>();
        if (!Directory.Exists(ttyClass)) return result;
        foreach (var entry in Directory.EnumerateFileSystemEntries(ttyClass).Order())
        {
            string name = Path.GetFileName(entry), tty;
            try { tty = Path.GetFullPath(Path.Combine(ttyClass, new DirectoryInfo(entry).LinkTarget ?? name)); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
            string? usb = UsbDevice(tty);
            if (usb == null) continue; // Built-in, virtual and Bluetooth ports
            string Read(string file)
            {
                try { return File.ReadAllText(Path.Combine(usb, file)).Trim(); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return ""; }
            }
            string vid = Read("idVendor").ToUpperInvariant(), pid = Read("idProduct").ToUpperInvariant(),
                revision = Read("bcdDevice"), serial = Read("serial"), product = Read("product");
            string[] ids = [$@"USB\VID_{vid}&PID_{pid}&REV_{revision}", $@"USB\VID_{vid}&PID_{pid}"];
            bool family = PortDiscovery.IsFamily(ids);
            // Like a Windows instance ID: the serial number, else the USB port path, then the interface.
            string usbInterface = Path.GetRelativePath(usb, tty).Split(Path.DirectorySeparatorChar)[0];
            string instance = $@"USB\VID_{vid}&PID_{pid}\{(serial.Length > 0 ? serial : Path.GetFileName(usb))}\{usbInterface[(usbInterface.IndexOf(':') + 1)..]}";
            result.Add(new("usb:" + Json.Hash(instance)[..24], devices.TrimEnd('/') + "/" + name, product.Length > 0 ? product : "USB serial device",
                instance, ids, family, true, SerialNumber: serial.Length > 0 ? serial : null, UsbRevision: revision.Length > 0 ? revision : null,
                DeviceType: family ? PortDiscovery.FamilyType : "Serial byte source", ProviderId: family ? PortDiscovery.FamilyProvider : "serial-byte-source-v1"));
        }
        return result;
    }

    // The nearest directory above the tty with USB vendor and product IDs.
    static string? UsbDevice(string tty)
    {
        for (string? d = Path.GetDirectoryName(tty); d != null; d = Path.GetDirectoryName(d))
            if (File.Exists(Path.Combine(d, "idVendor")) && File.Exists(Path.Combine(d, "idProduct"))) return d;
        return null;
    }
}
