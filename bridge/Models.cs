using System.Security.Cryptography;
using System.Text;
namespace IntentionLab.Devices;
// Transport identities, never experimental records.
public record DeviceInfo(string Id, string? Port, string Label, string? InstanceId, string[] HardwareIds,
    bool FamilyHint, bool Present, string? SerialNumber = null, string? FirmwareVersion = null, string? UsbRevision = null,
    string? DriverProblem = null, string? UserLabel = null, string DeviceType = "Unidentified serial device", string ProviderId = "serial-byte-source-v1");
public static class Json { public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant(); }
