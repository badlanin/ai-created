using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class BuqiqiStopper
{
    private const int Port = 3000;
    private const string PidFileName = ".buqiqi-web.pid";

    [STAThread]
    private static void Main()
    {
        try
        {
            StopServer();
        }
        catch (Exception ex)
        {
            MessageBox.Show("关闭失败：\n" + ex.Message, "关闭 BUQIQI");
            Environment.ExitCode = 1;
        }
    }

    private static void StopServer()
    {
        string projectDir = FindProjectDir();
        string pidPath = Path.Combine(projectDir, PidFileName);

        int trackedPid;
        long trackedStartTicks;
        Process trackedProcess;
        if (TryReadPidFile(pidPath, out trackedPid, out trackedStartTicks) &&
            TryGetMatchingProcess(trackedPid, trackedStartTicks, out trackedProcess))
        {
            trackedProcess.Dispose();
            KillProcessTree(trackedPid);
            WaitForTrackedProcessToExit(trackedPid, trackedStartTicks);
            DeletePidFile(pidPath);
            MessageBox.Show("已关闭 BUQIQI Web 端。", "关闭 BUQIQI");
            return;
        }

        DeletePidFile(pidPath);

        int listenerPid;
        bool portHasOtherListener;
        if (!TryFindProjectListener(projectDir, out listenerPid, out portHasOtherListener))
        {
            MessageBox.Show(
                portHasOtherListener
                    ? "3000 端口由其他程序占用，为避免误关，未执行关闭。"
                    : "没有发现正在运行的 BUQIQI Web 服务。",
                "关闭 BUQIQI"
            );
            return;
        }

        int killRootPid = FindNextDevParent(listenerPid);
        KillProcessTree(killRootPid);
        WaitForPortToClose();
        if (IsPortOpen())
        {
            throw new InvalidOperationException("已发送关闭命令，但 3000 端口仍在监听。");
        }

        MessageBox.Show("已关闭 BUQIQI Web 端。", "关闭 BUQIQI");
    }

    private static string FindProjectDir()
    {
        string exeDir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        if (IsProjectDir(exeDir)) return exeDir;

        string child = Path.Combine(exeDir, "week1-mvp");
        if (IsProjectDir(child)) return child;

        throw new DirectoryNotFoundException("请把“一键关闭.exe”放在 ai-created-main 或 week1-mvp 目录中。");
    }

    private static bool IsProjectDir(string path)
    {
        return File.Exists(Path.Combine(path, "package.json")) &&
               Directory.Exists(Path.Combine(path, "app"));
    }

    private static bool TryFindProjectListener(
        string projectDir,
        out int projectListenerPid,
        out bool portHasOtherListener)
    {
        projectListenerPid = 0;
        portHasOtherListener = false;
        foreach (int pid in FindListeningPids())
        {
            portHasOtherListener = true;
            ProcessInfo info = GetProcessInfo(pid);
            if (info != null && BelongsToProject(info.CommandLine, projectDir))
            {
                projectListenerPid = pid;
                return true;
            }
        }
        return false;
    }

    private static HashSet<int> FindListeningPids()
    {
        var pids = new HashSet<int>();
        var startInfo = new ProcessStartInfo
        {
            FileName = "netstat.exe",
            Arguments = "-ano -p tcp",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using (var process = Process.Start(startInfo))
        {
            if (process == null) return pids;
            string output = process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit(5000);
            var pattern = new Regex(
                @"\s+TCP\s+\S+:" + Port + @"\s+\S+\s+LISTENING\s+(\d+)",
                RegexOptions.IgnoreCase
            );
            foreach (Match match in pattern.Matches(output))
            {
                int pid;
                if (int.TryParse(match.Groups[1].Value, out pid)) pids.Add(pid);
            }
        }
        return pids;
    }

    private static bool BelongsToProject(string commandLine, string projectDir)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return false;
        string command = NormalizePath(commandLine);
        string project = NormalizePath(projectDir).TrimEnd('\\') + "\\";
        return command.Contains(project) && command.Contains("node_modules\\next\\");
    }

    private static int FindNextDevParent(int listenerPid)
    {
        ProcessInfo listener = GetProcessInfo(listenerPid);
        if (listener == null || listener.ParentProcessId <= 0) return listenerPid;

        ProcessInfo parent = GetProcessInfo(listener.ParentProcessId);
        if (parent == null) return listenerPid;
        string command = NormalizePath(parent.CommandLine);
        if (string.Equals(parent.Name, "node.exe", StringComparison.OrdinalIgnoreCase) &&
            command.Contains("node_modules\\next\\dist\\bin\\next") &&
            command.Contains(" dev"))
        {
            return parent.ProcessId;
        }
        return listenerPid;
    }

    private static ProcessInfo GetProcessInfo(int pid)
    {
        try
        {
            using (var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, ParentProcessId, Name, CommandLine FROM Win32_Process WHERE ProcessId = " + pid))
            {
                foreach (ManagementObject item in searcher.Get())
                {
                    return new ProcessInfo
                    {
                        ProcessId = Convert.ToInt32(item["ProcessId"]),
                        ParentProcessId = Convert.ToInt32(item["ParentProcessId"]),
                        Name = Convert.ToString(item["Name"]) ?? "",
                        CommandLine = Convert.ToString(item["CommandLine"]) ?? ""
                    };
                }
            }
        }
        catch
        {
        }
        return null;
    }

    private static string NormalizePath(string value)
    {
        return (value ?? "").Replace('/', '\\').ToLowerInvariant();
    }

    private static void KillProcessTree(int pid)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "taskkill.exe",
            Arguments = "/PID " + pid + " /T /F",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using (var taskkill = Process.Start(startInfo))
        {
            if (taskkill == null) throw new InvalidOperationException("无法运行 taskkill.exe。");
            taskkill.StandardOutput.ReadToEnd();
            string error = taskkill.StandardError.ReadToEnd();
            taskkill.WaitForExit(10000);
            if (taskkill.ExitCode != 0 && IsProcessAlive(pid))
            {
                throw new InvalidOperationException(
                    string.IsNullOrWhiteSpace(error) ? "无法终止服务进程。" : error.Trim()
                );
            }
        }
    }

    private static bool TryReadPidFile(string pidPath, out int pid, out long startTicks)
    {
        pid = 0;
        startTicks = 0;
        if (!File.Exists(pidPath)) return false;
        try
        {
            string[] values = File.ReadAllText(pidPath).Trim().Split('|');
            return values.Length == 2 &&
                   int.TryParse(values[0], out pid) &&
                   long.TryParse(values[1], out startTicks);
        }
        catch
        {
            return false;
        }
    }

    private static bool TryGetMatchingProcess(int pid, long startTicks, out Process process)
    {
        process = null;
        try
        {
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

    private static bool IsProcessAlive(int pid)
    {
        try
        {
            return !Process.GetProcessById(pid).HasExited;
        }
        catch
        {
            return false;
        }
    }

    private static void WaitForTrackedProcessToExit(int pid, long startTicks)
    {
        for (int i = 0; i < 30; i++)
        {
            Process process;
            if (!TryGetMatchingProcess(pid, startTicks, out process)) return;
            process.Dispose();
            Thread.Sleep(100);
        }
        Process remaining;
        if (TryGetMatchingProcess(pid, startTicks, out remaining))
        {
            remaining.Dispose();
            throw new InvalidOperationException("服务进程未能及时退出。");
        }
    }

    private static void WaitForPortToClose()
    {
        for (int i = 0; i < 30 && IsPortOpen(); i++) Thread.Sleep(100);
    }

    private static bool IsPortOpen()
    {
        try
        {
            using (var client = new TcpClient())
            {
                var result = client.BeginConnect("127.0.0.1", Port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(300)) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
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

    private sealed class ProcessInfo
    {
        public int ProcessId { get; set; }
        public int ParentProcessId { get; set; }
        public string Name { get; set; }
        public string CommandLine { get; set; }
    }
}
