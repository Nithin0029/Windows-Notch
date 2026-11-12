# Background helper for the notch: now playing, volume, brightness, mic/camera in use,
# battery presence and fullscreen detection. Talks JSON lines over stdio.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$out.AutoFlush = $true
$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)

function Emit($o) { $out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)) }

# ---------------------------------------------------------------- fullscreen detection, album-art resizing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class WinNative {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);

  // Per-monitor DPI awareness: all coordinates are real pixels on every monitor (needed so the app can
  // tell which display a fullscreen window is on when monitors use different scaling).
  public static void Init() {
    try { if (SetProcessDpiAwarenessContext((IntPtr)(-4))) return; } catch { }
    SetProcessDPIAware();
  }

  /// <summary>If the foreground window covers its whole monitor (game, video, presentation), returns that
  /// monitor as "x,y,w,h" in physical pixels; otherwise null.</summary>
  public static string FullscreenMonitor() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return null;
    StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return null;
    if (IsZoomed(h)) return null;
    RECT r; if (!GetWindowRect(h, out r)) return null;
    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return null;
    RECT m = mi.rcMonitor;
    if (r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B) return m.L + "," + m.T + "," + (m.R - m.L) + "," + (m.B - m.T);
    return null;
  }

  public static string SquareJpeg(byte[] data, int size) {
    using (MemoryStream ms = new MemoryStream(data))
    using (Image img = Image.FromStream(ms))
    using (Bitmap bmp = new Bitmap(size, size))
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      int s = Math.Min(img.Width, img.Height);
      g.DrawImage(img, new Rectangle(0, 0, size, size), new Rectangle((img.Width - s) / 2, (img.Height - s) / 2, s, s), GraphicsUnit.Pixel);
      using (MemoryStream o = new MemoryStream()) { bmp.Save(o, ImageFormat.Jpeg); return Convert.ToBase64String(o.ToArray()); }
    }
  }
}
"@
[WinNative]::Init()

# ---------------------------------------------------------------- volume, brightness, battery, mic/camera in use
Add-Type -ReferencedAssemblies System.Management -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
using Microsoft.Win32;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl1(); [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out int c);
  int SetMasterVolumeLevel(float f, Guid g); int SetMasterVolumeLevelScalar(float f, Guid g);
  int GetMasterVolumeLevel(out float f); int GetMasterVolumeLevelScalar(out float f);
  int SetChannelVolumeLevel(uint n, float f, Guid g); int SetChannelVolumeLevelScalar(uint n, float f, Guid g);
  int GetChannelVolumeLevel(uint n, out float f); int GetChannelVolumeLevelScalar(uint n, out float f);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute(out bool m);
}

public static class SysNative {
  // ---- volume (default output device; re-resolved periodically so device switches are followed)
  static IAudioEndpointVolume vol; static int volAge;
  static IAudioEndpointVolume Vol() {
    if (vol == null || ++volAge > 40) {
      volAge = 0;
      try {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) { vol = null; return null; }
        Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
        dev.Activate(ref iid, 23, IntPtr.Zero, out o); vol = (IAudioEndpointVolume)o;
      } catch { vol = null; }
    }
    return vol;
  }
  public static float GetVolume() { try { IAudioEndpointVolume v = Vol(); if (v == null) return -1; float f; v.GetMasterVolumeLevelScalar(out f); return f; } catch { vol = null; return -1; } }
  public static bool GetMute() { try { IAudioEndpointVolume v = Vol(); if (v == null) return false; bool m; v.GetMute(out m); return m; } catch { return false; } }
  public static void SetVolume(float f) {
    IAudioEndpointVolume v = Vol(); if (v == null) return;
    f = Math.Max(0f, Math.Min(1f, f));
    v.SetMasterVolumeLevelScalar(f, Guid.Empty);
    v.SetMute(f <= 0f, Guid.Empty);
  }
  public static void ToggleMute() { IAudioEndpointVolume v = Vol(); if (v == null) return; bool m; v.GetMute(out m); v.SetMute(!m, Guid.Empty); }

  // ---- microphone (default recording device) mute
  static IAudioEndpointVolume mic; static int micAge;
  static IAudioEndpointVolume Mic() {
    if (mic == null || ++micAge > 20) {
      micAge = 0;
      try {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(1, 0, out dev) != 0) { mic = null; return null; }
        Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
        dev.Activate(ref iid, 23, IntPtr.Zero, out o); mic = (IAudioEndpointVolume)o;
      } catch { mic = null; }
    }
    return mic;
  }
  /// <summary>-1 = no microphone, 0 = live, 1 = muted</summary>
  public static int MicMuted() { try { IAudioEndpointVolume m = Mic(); if (m == null) return -1; bool b; m.GetMute(out b); return b ? 1 : 0; } catch { mic = null; return -1; } }
  public static void ToggleMic() { IAudioEndpointVolume m = Mic(); if (m == null) return; bool b; m.GetMute(out b); m.SetMute(!b, Guid.Empty); }

  // ---- dark / light mode (apps + Windows)
  const string PersonalizeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
  public static bool IsDark() {
    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(PersonalizeKey)) {
      object v = k == null ? null : k.GetValue("AppsUseLightTheme");
      return v is int && (int)v == 0;
    }
  }
  public static void SetDark(bool dark) {
    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(PersonalizeKey)) {
      k.SetValue("AppsUseLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
      k.SetValue("SystemUsesLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
    }
    IntPtr r;   // tell running apps and the taskbar that the colour mode changed
    SendMessageTimeout((IntPtr)0xffff, 0x001A, IntPtr.Zero, "ImmersiveColorSet", 0x0002, 200, out r);
  }

  // ---- brightness (laptop panels only; event driven)
  static ManagementEventWatcher watcher;
  public static volatile int BrightLevel = -1;
  public static volatile bool BrightChanged = false;
  public static int InitBrightness() {
    try {
      ManagementScope scope = new ManagementScope("root\\wmi");
      using (ManagementObjectSearcher s = new ManagementObjectSearcher(scope, new ObjectQuery("SELECT CurrentBrightness FROM WmiMonitorBrightness")))
        foreach (ManagementObject o in s.Get()) { BrightLevel = Convert.ToInt32(o["CurrentBrightness"]); break; }
      if (BrightLevel < 0) return -1;
      watcher = new ManagementEventWatcher(scope, new EventQuery("SELECT * FROM WmiMonitorBrightnessEvent"));
      watcher.EventArrived += delegate(object sender, EventArrivedEventArgs e) {
        BrightLevel = Convert.ToInt32(e.NewEvent.Properties["Brightness"].Value); BrightChanged = true;
      };
      watcher.Start();
      return BrightLevel;
    } catch { return -1; }
  }
  public static void SetBrightness(int level) {
    level = Math.Max(0, Math.Min(100, level));
    using (ManagementObjectSearcher s = new ManagementObjectSearcher(new ManagementScope("root\\wmi"), new ObjectQuery("SELECT * FROM WmiMonitorBrightnessMethods")))
      foreach (ManagementObject o in s.Get()) { o.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)level }); break; }
  }

  // ---- does this PC have a battery at all?
  [StructLayout(LayoutKind.Sequential)] struct SYSTEM_POWER_STATUS { public byte AC, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int LifeTime, FullLifeTime; }
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
  public static bool HasBattery() { SYSTEM_POWER_STATUS s; return GetSystemPowerStatus(out s) && (s.BatteryFlag & 128) == 0 && s.BatteryFlag != 255; }

  // ---- which apps are using the microphone / webcam right now
  public static string[] InUse(string capability) {
    List<string> res = new List<string>();
    try {
      using (RegistryKey root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\" + capability))
        if (root != null) Scan(root, res);
    } catch { }
    return res.ToArray();
  }
  static void Scan(RegistryKey k, List<string> res) {
    foreach (string n in k.GetSubKeyNames()) {
      using (RegistryKey s = k.OpenSubKey(n)) {
        if (s == null) continue;
        if (n == "NonPackaged") { Scan(s, res); continue; }
        object stop = s.GetValue("LastUsedTimeStop"), start = s.GetValue("LastUsedTimeStart");
        if (stop is long && start is long && (long)stop == 0 && (long)start > 0) {
          string name = Pretty(n);
          if (!res.Contains(name)) res.Add(name);
        }
      }
    }
  }
  static string Pretty(string key) {
    if (key.Contains("#")) { string f = key.Substring(key.LastIndexOf('#') + 1); return f.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? f.Substring(0, f.Length - 4) : f; }
    string p = key.Contains("_") ? key.Substring(0, key.IndexOf('_')) : key;
    return p.Contains(".") ? p.Substring(p.LastIndexOf('.') + 1) : p;
  }
}
"@
$script:brightOk = [SysNative]::InitBrightness() -ge 0

# ---------------------------------------------------------------- media (WinRT)
$script:mediaOk = $false
$script:mgr = $null
function Await($op, [Type]$t) {
  $task = $script:asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op))
  if ($task.Wait(2500)) { return $task.Result }
  return $null
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $script:mediaOk = $null -ne $script:mgr
} catch {
  Emit @{ type = 'error'; message = "media unavailable: $($_.Exception.Message)" }
}

function Get-Art($props) {
  try {
    if ($null -eq $props.Thumbnail) { return $null }
    $st = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($null -eq $st) { return $null }
    $ns = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
    $ms = New-Object System.IO.MemoryStream
    $ns.CopyTo($ms); $ns.Dispose()
    if ($ms.Length -eq 0) { return $null }
    return 'data:image/jpeg;base64,' + [WinNative]::SquareJpeg($ms.ToArray(), 160)
  } catch { return $null }
}

$script:lastKey = $null
$script:lastTrack = $null
$script:artTries = 0
function Poll-Media {
  $s = $script:mgr.GetCurrentSession()
  if ($null -eq $s) {
    if ($script:lastKey -ne 'none') { $script:lastKey = 'none'; $script:lastTrack = $null; Emit @{ type = 'media'; active = $false } }
    return
  }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($null -eq $p) { return }
  $status = [string]$s.GetPlaybackInfo().PlaybackStatus
  $tl = $s.GetTimelineProperties()
  $track = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
  $pos = [math]::Round($tl.Position.TotalSeconds, 1)
  $dur = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 1)
  $upd = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
  $key = "$track|$status|$upd|$dur"

  if ($track -eq $script:lastTrack -and $script:artTries -gt 0 -and $script:artTries -lt 4) {
    $script:artTries++
    $art = Get-Art $p
    if ($art) { $script:artTries = 0; Emit @{ type = 'art'; track = $track; data = $art } }
  }
  if ($key -eq $script:lastKey) { return }

  $msg = @{ type = 'media'; active = $true; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle
    app = [string]$s.SourceAppUserModelId; status = $status; pos = $pos; dur = $dur; updated = $upd; track = $track }
  if ($track -ne $script:lastTrack) {
    $script:lastTrack = $track
    $msg.newTrack = $true
    $msg.art = Get-Art $p
    $script:artTries = if ($msg.art) { 0 } else { 1 }
  }
  $script:lastKey = $key
  Emit $msg
}

function Media-Command($action) {
  $s = $script:mgr.GetCurrentSession()
  if ($null -eq $s) { return }
  switch ($action) {
    'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
    'prev' { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
  }
}

# ---------------------------------------------------------------- quick toggles: Wi-Fi, Bluetooth (WinRT radios), mic, dark mode
$script:radiosOk = $false
$script:radioListType = $null
try {
  if ($script:asTaskGeneric) {
    $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
    $script:radioListType = [System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]
    $access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    $script:radiosOk = ([string]$access -eq 'Allowed')
  }
} catch { Emit @{ type = 'error'; message = "radios unavailable: $($_.Exception.Message)" } }

function Get-Radios {
  if (-not $script:radiosOk) { return @() }
  $list = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ($script:radioListType)
  if ($null -eq $list) { return @() }
  return @($list)
}
function Radio-State($radios, $kind) {
  # 'on' / 'off' / $null when the PC has no such radio (or it's disabled in hardware/airplane mode)
  foreach ($r in $radios) {
    if ([string]$r.Kind -eq $kind) {
      $s = [string]$r.State
      if ($s -eq 'On') { return 'on' } elseif ($s -eq 'Off') { return 'off' } else { return $null }
    }
  }
  return $null
}
function Toggle-Radio($kind) {
  foreach ($r in (Get-Radios)) {
    if ([string]$r.Kind -eq $kind) {
      $target = if ([string]$r.State -eq 'On') { [Windows.Devices.Radios.RadioState]::Off } else { [Windows.Devices.Radios.RadioState]::On }
      $null = Await ($r.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus])
      return
    }
  }
}

$script:lastToggles = $null
function Poll-Toggles {
  $radios = Get-Radios
  $mic = [SysNative]::MicMuted()
  $state = [ordered]@{
    wifi = Radio-State $radios 'WiFi'
    bt = Radio-State $radios 'Bluetooth'
    mic = if ($mic -lt 0) { $null } elseif ($mic -eq 1) { 'muted' } else { 'live' }
    dark = [SysNative]::IsDark()
  }
  $k = ($state.Values | % { "$_" }) -join '|'
  if ($k -eq $script:lastToggles) { return }
  $script:lastToggles = $k
  Emit @{ type = 'toggles'; wifi = $state.wifi; bt = $state.bt; mic = $state.mic; dark = $state.dark }
}

# ---------------------------------------------------------------- commands from the app
function Handle-Command($c) {
  switch ($c.cmd) {
    'media' { if ($script:mediaOk) { Media-Command $c.action; $script:lastMedia = 0 } }
    'volume' {
      if ($null -ne $c.delta) {
        $cur = [SysNative]::GetVolume()
        if ($cur -ge 0) {
          $next = $cur + [double]$c.delta
          if ($c.snap) { $next = [math]::Round($next * 50) / 50 }   # volume keys move in 2% steps, like Windows
          [SysNative]::SetVolume([float]$next)
        }
      }
      elseif ($null -ne $c.level) { [SysNative]::SetVolume([float]$c.level) }
      $script:lastVolPoll = 0
    }
    'mute' { [SysNative]::ToggleMute(); $script:lastVolPoll = 0 }
    'brightness' { if ($script:brightOk) { [SysNative]::SetBrightness([int]$c.level) } }
    'toggle' {
      switch ($c.what) {
        'wifi' { Toggle-Radio 'WiFi' }
        'bt' { Toggle-Radio 'Bluetooth' }
        'mic' { [SysNative]::ToggleMic() }
        'dark' { [SysNative]::SetDark(-not [SysNative]::IsDark()) }
      }
      $script:lastTogglePoll = 0   # report the new state right away
    }
  }
}

# ---------------------------------------------------------------- polling
$script:lastVol = $null
$script:volInit = $false
function Poll-Volume {
  $v = [SysNative]::GetVolume()
  if ($v -lt 0) { return }
  $m = [SysNative]::GetMute()
  $k = '{0:N3}|{1}' -f $v, $m
  if ($k -eq $script:lastVol) { return }
  $script:lastVol = $k
  Emit @{ type = 'volume'; level = [math]::Round($v, 3); muted = $m; init = (-not $script:volInit) }
  $script:volInit = $true
}

$script:lastPrivacy = $null
function Poll-Privacy {
  $mic = [string[]][SysNative]::InUse('microphone')
  $cam = [string[]][SysNative]::InUse('webcam')
  $k = ($mic -join ',') + '|' + ($cam -join ',')
  if ($k -eq $script:lastPrivacy) { return }
  $script:lastPrivacy = $k
  Emit @{ type = 'privacy'; mic = $mic; cam = $cam }
}

Emit @{ type = 'ready'; media = $script:mediaOk; brightness = $script:brightOk }
if ($script:brightOk) { Emit @{ type = 'brightness'; level = [SysNative]::BrightLevel; init = $true } }
Emit @{ type = 'power'; hasBattery = [SysNative]::HasBattery() }

$pending = $in.ReadLineAsync()
$script:lastMedia = 0; $lastFs = 0; $fsState = ''; $script:lastVolPoll = 0; $lastPriv = 0; $script:lastTogglePoll = 0
while ($true) {
  if ($pending.IsCompleted) {
    if ($pending.IsFaulted -or $null -eq $pending.Result) { break }   # parent went away
    $line = $pending.Result
    try { Handle-Command ($line | ConvertFrom-Json) } catch { Emit @{ type = 'error'; message = $_.Exception.Message } }
    $pending = $in.ReadLineAsync()
    continue
  }
  $now = [Environment]::TickCount
  if ($script:mediaOk -and [math]::Abs($now - $script:lastMedia) -ge 1000) { $script:lastMedia = $now; try { Poll-Media } catch { } }
  if ([math]::Abs($now - $script:lastVolPoll) -ge 120) { $script:lastVolPoll = $now; try { Poll-Volume } catch { } }
  if ([math]::Abs($now - $lastPriv) -ge 1500) { $lastPriv = $now; try { Poll-Privacy } catch { } }
  if ([math]::Abs($now - $script:lastTogglePoll) -ge 2000) { $script:lastTogglePoll = $now; try { Poll-Toggles } catch { } }
  if ([SysNative]::BrightChanged) { [SysNative]::BrightChanged = $false; Emit @{ type = 'brightness'; level = [SysNative]::BrightLevel } }
  if ([math]::Abs($now - $lastFs) -ge 1000) {
    $lastFs = $now
    $mon = [WinNative]::FullscreenMonitor()
    $fs = if ($mon) { $mon } else { '' }
    if ($fs -ne $fsState) {
      $fsState = $fs
      if ($mon) {
        $p = $mon.Split(',')
        Emit @{ type = 'fullscreen'; value = $true; rect = @{ x = [int]$p[0]; y = [int]$p[1]; w = [int]$p[2]; h = [int]$p[3] } }
      } else { Emit @{ type = 'fullscreen'; value = $false } }
    }
  }
  Start-Sleep -Milliseconds 50
}
