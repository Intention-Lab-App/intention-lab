using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace IntentionLab.Bridge;

/// <summary>Portable executable entry behavior; no application or measurement logic.</summary>
internal static class DesktopLauncher
{
    public const string ApplicationId = "IntentionLab.DeviceBridge";

    public static async Task<bool> IsRunning(string origin)
    {
        try
        {
            using var client = new HttpClient(new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false })
            { Timeout = TimeSpan.FromMilliseconds(500), MaxResponseContentBufferSize = 16384 };
            using var response = await client.GetAsync(origin + "/bridge/bootstrap");
            if (!response.IsSuccessStatusCode) return false;
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = json.RootElement;
            return root.TryGetProperty("application", out var name) && name.GetString() == ApplicationId &&
                root.TryGetProperty("protocol", out var protocol) && protocol.TryGetInt32(out int version) && version == 1 &&
                root.TryGetProperty("status", out var status) && status.TryGetProperty("instanceId", out var id) &&
                Guid.TryParse(id.GetString(), out _);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or InvalidOperationException)
        { return false; }
    }

    public static async Task<bool> WaitForRunning(string origin)
    {
        var wait = Stopwatch.StartNew();
        do
        {
            if (await IsRunning(origin)) return true;
            await Task.Delay(100);
        } while (wait.Elapsed < TimeSpan.FromSeconds(3));
        return false;
    }

    public static void OpenBrowser(string origin)
    {
        try { Process.Start(new ProcessStartInfo(origin) { UseShellExecute = true }); }
        catch (Exception ex)
        {
            ShowError("The device bridge is running, but the browser could not be opened.\n\nOpen " + origin + " in your browser.\n\n" + ex.Message, true);
        }
    }

    /// <summary>On the desktop the message stays up until the person closes it.</summary>
    public static void ShowError(string message, bool desktop)
    {
        Console.Error.WriteLine(message);
        if (!desktop) return;
        if (OperatingSystem.IsWindows()) MessageBoxW(IntPtr.Zero, message, "Intention Lab", 0x10 | 0x10000); // Error icon, in front.
        else if (OperatingSystem.IsLinux()) LinuxDialog(message);
    }

    // zenity covers GNOME and most desktops, kdialog KDE, xmessage plain X11.
    static void LinuxDialog(string message)
    {
        string[][] tools =
        [
            ["zenity", "--error", "--no-markup", "--width=460", "--title=Intention Lab", "--text=" + message],
            ["kdialog", "--title", "Intention Lab", "--error", message],
            ["xmessage", "-center", "-buttons", "OK", message],
        ];
        foreach (var tool in tools)
        {
            var start = new ProcessStartInfo(tool[0]) { UseShellExecute = false };
            foreach (var argument in tool[1..]) start.ArgumentList.Add(argument);
            try { using var dialog = Process.Start(start); dialog?.WaitForExit(); return; }
            catch (System.ComponentModel.Win32Exception) { } // Not installed: try the next one.
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);
}
