using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class BuqiqiLauncher
{
    private const int Port = 3000;
    private const string AppUrl = "http://127.0.0.1:3000/login";
    private const string PidFileName = ".buqiqi-web.pid";
    private const string LogFileName = "web-server.log";

    [STAThread]
    private static void Main()
    {
        using (var mutex = new Mutex(false, @"Local\BUQIQI_AI_CREATED_WEB_LAUNCHER"))
        {
            if (!mutex.WaitOne(0, false))
            {
                MessageBox.Show("启动程序已经在运行，请稍候。", "启动 BUQIQI");
                return;
            }

            try
            {
                StartOrOpen();
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：\n" + ex.Message, "启动 BUQIQI");
                Environment.ExitCode = 1;
            }
            finally
            {
                mutex.ReleaseMutex();
            }
        }
    }

    private static void StartOrOpen()
    {
        string projectDir = FindProjectDir();
        string pidPath = Path.Combine(projectDir, PidFileName);
        string logPath = Path.Combine(projectDir, LogFileName);

        Process trackedProcess;
        if (TryGetTrackedProcess(pidPath, out trackedProcess))
        {
            if (WaitForApp(trackedProcess, 90))
            {
                OpenUrl();
                return;
            }

            MessageBox.Show("服务进程存在，但页面未能启动。\n请查看日志：\n" + logPath, "启动 BUQIQI");
            return;
        }

        DeletePidFile(pidPath);

        if (IsAppReady())
        {
            OpenUrl();
            return;
        }

        if (IsPortOpen())
        {
            MessageBox.Show("3000 端口正被其他程序占用，未启动 BUQIQI。", "启动 BUQIQI");
            return;
        }

        string nodeExe = FindNode();
        string nextScript = Path.Combine(projectDir, "node_modules", "next", "dist", "bin", "next");
        if (!File.Exists(nextScript))
        {
            MessageBox.Show("项目依赖尚未安装：\n" + nextScript, "启动 BUQIQI");
            return;
        }

        Directory.CreateDirectory(Path.Combine(projectDir, "data"));
        File.AppendAllText(logPath, "\r\n[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] Starting BUQIQI\r\n");

        var startInfo = new ProcessStartInfo
        {
            FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
            Arguments = "/d /c \"\"" + nodeExe + "\" \"" + nextScript + "\" dev -H 127.0.0.1 -p " + Port + " >> \"" + logPath + "\" 2>&1\"",
            WorkingDirectory = projectDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        startInfo.EnvironmentVariables["DATA_DIR"] = Path.Combine(projectDir, "data");

        Process process = Process.Start(startInfo);
        if (process == null)
        {
            throw new InvalidOperationException("无法创建 Web 服务进程。");
        }

        process.Refresh();
        File.WriteAllText(pidPath, process.Id + "|" + process.StartTime.ToUniversalTime().Ticks);

        if (!WaitForApp(process, 90))
        {
            MessageBox.Show("本地页面没有及时启动。\n请查看日志：\n" + logPath, "启动 BUQIQI");
            return;
        }

        OpenUrl();
    }

    private static string FindProjectDir()
    {
        string exeDir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        if (IsProjectDir(exeDir)) return exeDir;

        string child = Path.Combine(exeDir, "week1-mvp");
        if (IsProjectDir(child)) return child;

        throw new DirectoryNotFoundException("请把“一键启动.exe”放在 week1-mvp 项目目录中。");
    }

    private static bool IsProjectDir(string path)
    {
        return File.Exists(Path.Combine(path, "package.json")) &&
               Directory.Exists(Path.Combine(path, "app"));
    }

    private static string FindNode()
    {
        string[] preferred =
        {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            @"C:\Users\pftnm\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        };

        foreach (string path in preferred)
        {
            if (File.Exists(path)) return path;
        }

        string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string directory in pathValue.Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(directory)) continue;
            string candidate = Path.Combine(directory.Trim(), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }

        throw new FileNotFoundException("找不到 Node.js。请安装 Node.js 后重试。");
    }

    private static bool TryGetTrackedProcess(string pidPath, out Process process)
    {
        process = null;
        if (!File.Exists(pidPath)) return false;

        try
        {
            string[] values = File.ReadAllText(pidPath).Trim().Split('|');
            int pid;
            long startTicks;
            if (values.Length != 2 || !int.TryParse(values[0], out pid) || !long.TryParse(values[1], out startTicks))
            {
                return false;
            }

            var candidate = Process.GetProcessById(pid);
            if (candidate.HasExited || candidate.StartTime.ToUniversalTime().Ticks != startTicks)
            {
                candidate.Dispose();
                return false;
            }

            process = candidate;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool WaitForApp(Process process, int seconds)
    {
        int attempts = seconds * 2;
        for (int i = 0; i < attempts; i++)
        {
            if (IsAppReady()) return true;
            if (process.HasExited) return false;
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
            request.Timeout = 1500;
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
                var result = client.BeginConnect("127.0.0.1", Port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(500)) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void OpenUrl()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = AppUrl,
            UseShellExecute = true
        });
    }

    private static void DeletePidFile(string pidPath)
    {
        try
        {
            if (File.Exists(pidPath)) File.Delete(pidPath);
        }
        catch
        {
        }
    }
}
