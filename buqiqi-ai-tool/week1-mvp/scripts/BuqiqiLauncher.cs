using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class BuqiqiLauncher
{
    private const string BundledNode = @"C:\Users\pftnm\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe";
    private const string AppUrl = "http://127.0.0.1:3000/";

    [STAThread]
    private static void Main()
    {
        try
        {
            string projectDir = FindProjectDir();
            string logPath = Path.Combine(projectDir, "launcher.log");

            if (!Directory.Exists(projectDir))
            {
                MessageBox.Show("找不到项目目录，请把启动器放在 BUQIQI（连接shopify初级）文件夹内。", "启动 BUQIQI");
                return;
            }

            if (!IsAppReady() && !IsPortOpen())
            {
                StartDevServer(projectDir, logPath);
            }

            if (!WaitForApp())
            {
                MessageBox.Show(
                    "本地页面没有及时启动。\n请查看日志：\n" + logPath,
                    "启动 BUQIQI"
                );
                return;
            }

            OpenUrl(AppUrl);
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "启动 BUQIQI");
            Environment.Exit(1);
        }
    }

    private static string FindProjectDir()
    {
        string launcherDir = AppDomain.CurrentDomain.BaseDirectory;
        string direct = Path.Combine(launcherDir, "buqiqi-ai-tool", "week1-mvp");
        if (Directory.Exists(direct)) return direct;

        string parent = Directory.GetParent(launcherDir.TrimEnd(Path.DirectorySeparatorChar)) == null
            ? launcherDir
            : Directory.GetParent(launcherDir.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        string sibling = Path.Combine(parent, "buqiqi-ai-tool", "week1-mvp");
        if (Directory.Exists(sibling)) return sibling;

        return direct;
    }

    private static void StartDevServer(string projectDir, string logPath)
    {
        string nodeExe = File.Exists(BundledNode) ? BundledNode : "node";
        string nextScript = Path.Combine(projectDir, "node_modules", "next", "dist", "bin", "next");

        if (!File.Exists(nextScript))
        {
            MessageBox.Show(
                "找不到 Next.js 启动文件，请确认依赖已安装。",
                "启动 BUQIQI"
            );
            return;
        }

        File.AppendAllText(logPath, "\r\n[" + DateTime.Now + "] Starting BUQIQI from " + projectDir + "\r\n");

        var startInfo = new ProcessStartInfo
        {
            FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
            Arguments = "/c \"\"" + nodeExe + "\" \"" + nextScript + "\" dev -H 127.0.0.1 -p 3000 >> \"" + logPath + "\" 2>&1\"",
            WorkingDirectory = projectDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        Process.Start(startInfo);
    }

    private static bool WaitForApp()
    {
        for (int i = 0; i < 80; i++)
        {
            if (IsAppReady())
            {
                return true;
            }

            Thread.Sleep(500);
        }

        return false;
    }

    private static bool IsAppReady()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(AppUrl);
            request.Method = "GET";
            request.Timeout = 1200;
            request.AllowAutoRedirect = false;

            using (var response = (HttpWebResponse)request.GetResponse())
            {
                int statusCode = (int)response.StatusCode;
                return statusCode >= 200 && statusCode < 500;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool IsPortOpen()
    {
        try
        {
            using (var client = new TcpClient())
            {
                var result = client.BeginConnect("127.0.0.1", 3000, null, null);
                bool success = result.AsyncWaitHandle.WaitOne(500);
                if (!success) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = url,
            UseShellExecute = false,
            CreateNoWindow = true,
        });
    }
}
