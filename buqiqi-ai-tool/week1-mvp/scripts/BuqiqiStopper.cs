using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal static class BuqiqiStopper
{
    private const int Port = 3000;

    [STAThread]
    private static void Main()
    {
        try
        {
            string projectDir = FindProjectDir();
            var listenerPids = FindListeningPids(Port);
            if (listenerPids.Count == 0)
            {
                MessageBox.Show("没有发现正在占用 3000 端口的 BUQIQI 本地服务。", "关闭 BUQIQI");
                return;
            }

            var killed = new List<int>();
            var skipped = new List<int>();

            foreach (int pid in listenerPids)
            {
                string commandLine = GetCommandLine(pid);
                if (!BelongsToProject(commandLine, projectDir))
                {
                    skipped.Add(pid);
                    continue;
                }

                foreach (int childPid in FindChildPids(pid))
                {
                    KillProcess(childPid, killed);
                }

                KillProcess(pid, killed);
            }

            if (killed.Count > 0)
            {
                MessageBox.Show("已关闭 BUQIQI 本地服务。", "关闭 BUQIQI");
                return;
            }

            if (skipped.Count > 0)
            {
                MessageBox.Show(
                    "3000 端口正在被其它程序占用，未关闭它。\nPID: " + string.Join(", ", skipped),
                    "关闭 BUQIQI"
                );
                return;
            }

            MessageBox.Show("没有需要关闭的 BUQIQI 本地服务。", "关闭 BUQIQI");
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "关闭 BUQIQI");
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

    private static HashSet<int> FindListeningPids(int port)
    {
        var pids = new HashSet<int>();
        var output = RunCommand("netstat.exe", "-ano -p tcp");
        var pattern = new Regex(@"\s+TCP\s+\S+:" + port + @"\s+\S+\s+LISTENING\s+(\d+)", RegexOptions.IgnoreCase);

        foreach (Match match in pattern.Matches(output))
        {
            int pid;
            if (int.TryParse(match.Groups[1].Value, out pid))
            {
                pids.Add(pid);
            }
        }

        return pids;
    }

    private static string RunCommand(string fileName, string arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        using (var process = Process.Start(startInfo))
        {
            if (process == null) return "";
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);
            return output + Environment.NewLine + error;
        }
    }

    private static bool BelongsToProject(string commandLine, string projectDir)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return false;

        string normalizedCommand = commandLine.ToLowerInvariant();
        string normalizedProject = projectDir.ToLowerInvariant();

        return normalizedCommand.Contains(normalizedProject) ||
            normalizedCommand.Contains(@"node_modules\next\dist\bin\next");
    }

    private static string GetCommandLine(int pid)
    {
        using (var searcher = new ManagementObjectSearcher(
            "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid))
        {
            foreach (ManagementObject process in searcher.Get())
            {
                return Convert.ToString(process["CommandLine"]) ?? "";
            }
        }

        return "";
    }

    private static IEnumerable<int> FindChildPids(int parentPid)
    {
        var children = new List<int>();
        using (var searcher = new ManagementObjectSearcher(
            "SELECT ProcessId FROM Win32_Process WHERE ParentProcessId = " + parentPid))
        {
            foreach (ManagementObject process in searcher.Get())
            {
                int childPid;
                if (int.TryParse(Convert.ToString(process["ProcessId"]), out childPid))
                {
                    children.Add(childPid);
                }
            }
        }

        return children;
    }

    private static void KillProcess(int pid, ICollection<int> killed)
    {
        try
        {
            var process = Process.GetProcessById(pid);
            if (process.HasExited) return;
            process.Kill();
            process.WaitForExit(3000);
            killed.Add(pid);
        }
        catch
        {
        }
    }
}
