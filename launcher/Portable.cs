// Autumn portable: a single Autumn.exe that carries the whole app.
// The first start unpacks the app into %LOCALAPPDATA%\Autumn\app (and again only when the version changes),
// then starts it. Projects are kept in Documents\Autumn\WorkFlow.
// Built by "node scripts/build.js portable": the packaged app is embedded as the resource "Autumn.app.zip".
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Autumn")]
[assembly: AssemblyProduct("Autumn")]
[assembly: AssemblyDescription("Autumn, a node-based planning tool")]
[assembly: AssemblyVersion("1.1.2.0")]
[assembly: AssemblyFileVersion("1.1.2.0")]

static class Portable
{
    const string Resource = "Autumn.app.zip";

    [STAThread]
    static int Main(string[] args)
    {
        string version = Assembly.GetExecutingAssembly().GetName().Version.ToString();
        string root = Environment.GetEnvironmentVariable("AUTUMN_APPDIR");
        if (string.IsNullOrEmpty(root)) root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Autumn");
        string app = Path.Combine(root, "app"), exe = Path.Combine(app, "Autumn.exe"), stamp = Path.Combine(root, "app.version");
        try
        {
            bool ready = File.Exists(exe) && File.Exists(stamp) && File.ReadAllText(stamp).Trim() == version;
            if (!ready && !Unpack(root, app, stamp, version)) return 1;

            var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = app, Arguments = Join(args) };
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AUTUMN_HOME")))
                psi.EnvironmentVariables["AUTUMN_HOME"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Autumn");
            Process.Start(psi);
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("Autumn could not start.\n\n" + e.Message, "Autumn", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    /// <summary>Unpacks the embedded app next to a small progress window. Returns false if it failed.</summary>
    static bool Unpack(string root, string app, string stamp, string version)
    {
        Exception error = null;
        var form = new Form
        {
            Text = "Autumn", Width = 380, Height = 130, FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterScreen, MaximizeBox = false, MinimizeBox = false, ControlBox = false,
            BackColor = Color.FromArgb(32, 22, 16), ForeColor = Color.FromArgb(240, 222, 204),
        };
        try { form.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
        var label = new Label { Text = "Preparing Autumn. This happens only on the first start.", AutoSize = false, Left = 18, Top = 18, Width = 330, Height = 22 };
        var bar = new ProgressBar { Left = 18, Top = 48, Width = 330, Height = 14, Minimum = 0, Maximum = 1000 };
        form.Controls.Add(label);
        form.Controls.Add(bar);

        var worker = new Thread(() =>
        {
            try
            {
                Directory.CreateDirectory(root);
                string tmp = app + ".new", tmpFull = Path.GetFullPath(tmp) + Path.DirectorySeparatorChar;
                if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(Resource))
                using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    int total = zip.Entries.Count, done = 0;
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        string dest = Path.GetFullPath(Path.Combine(tmp, e.FullName));
                        if (!dest.StartsWith(tmpFull, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Bad path in the package: " + e.FullName);
                        if (e.FullName.EndsWith("/")) Directory.CreateDirectory(dest);
                        else { Directory.CreateDirectory(Path.GetDirectoryName(dest)); e.ExtractToFile(dest, true); }
                        if (++done % 10 == 0 || done == total)
                        {
                            int v = (int)(1000L * done / Math.Max(1, total));
                            form.BeginInvoke((Action)(() => bar.Value = v));
                        }
                    }
                }
                if (Directory.Exists(app))
                {
                    try { Directory.Delete(app, true); }
                    catch (IOException) { throw new IOException("An older Autumn is still running. Close it and start Autumn again."); }
                    catch (UnauthorizedAccessException) { throw new IOException("An older Autumn is still running. Close it and start Autumn again."); }
                }
                Directory.Move(tmp, app);
                File.WriteAllText(stamp, version, new UTF8Encoding(false));
            }
            catch (Exception ex) { error = ex; }
            form.BeginInvoke((Action)(() => form.Close()));
        });
        worker.IsBackground = true;
        form.Shown += (s, e) => worker.Start();
        Application.EnableVisualStyles();
        Application.Run(form);

        if (error == null) return true;
        MessageBox.Show("Autumn could not be prepared.\n\n" + error.Message, "Autumn", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return false;
    }

    /// <summary>Command-line arguments, quoted again for the app</summary>
    static string Join(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) { sb.Append(a); continue; }
            sb.Append('"');
            int slashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
                else { sb.Append('\\', slashes); sb.Append(c); }
                slashes = 0;
            }
            sb.Append('\\', slashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }
}
