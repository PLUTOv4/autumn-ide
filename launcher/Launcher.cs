// Autumn launcher — the Autumn.exe that sits next to the WorkFlow folder.
// It starts the real app (app\Autumn.exe, an Electron program) and passes the arguments through, so the
// Autumn folder stays tidy: Autumn.exe · WorkFlow\ · app\ (· Source\).
// Built by scripts/build.js with the C# compiler that ships with Windows (.NET Framework 4).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Autumn")]
[assembly: AssemblyProduct("Autumn")]
[assembly: AssemblyDescription("Autumn — node-based planning IDE")]
[assembly: AssemblyVersion("1.1.2.0")]
[assembly: AssemblyFileVersion("1.1.2.0")]

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string home = AppDomain.CurrentDomain.BaseDirectory;
        string app = Path.Combine(home, "app", "Autumn.exe");
        if (!File.Exists(app))
        {
            MessageBox.Show("app\\Autumn.exe is missing.\n\nRun Build.bat (in the Source folder) to build Autumn again.", "Autumn", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        try { Directory.CreateDirectory(Path.Combine(home, "WorkFlow")); } catch (Exception) { }
        var psi = new ProcessStartInfo(app) { UseShellExecute = false, WorkingDirectory = home };
        var sb = new StringBuilder();
        foreach (string a in args) { if (sb.Length > 0) sb.Append(' '); sb.Append(Quote(a)); }
        psi.Arguments = sb.ToString();
        Process.Start(psi);
        return 0;
    }

    /// Quote one argument the way the Windows C runtime parses it back
    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        var sb = new StringBuilder("\"");
        int bs = 0;
        foreach (char c in a)
        {
            if (c == '\\') { bs++; continue; }
            if (c == '"') { sb.Append('\\', bs * 2 + 1).Append('"'); bs = 0; continue; }
            sb.Append('\\', bs).Append(c); bs = 0;
        }
        sb.Append('\\', bs * 2).Append('"');
        return sb.ToString();
    }
}
