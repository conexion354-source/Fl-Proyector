/**
 * Proyección de PowerPoint con el PowerPoint instalado (solo Windows).
 *
 * El visor web incorporado solo aproxima animaciones y transiciones. Para que
 * los efectos se vean exactamente como en PowerPoint, FL Proyector abre la
 * presentación con PowerPoint mediante COM (desde un proceso de PowerShell),
 * la pone en pantalla completa sobre el monitor del proyector y le envía
 * "siguiente", "anterior" e "ir a" por la entrada estándar. PowerPoint
 * responde con la diapositiva actual para mantener sincronizado el operador.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type NativeRect = { x: number; y: number; width: number; height: number };

export type NativeEvents = {
  onReady: (slideCount: number) => void;
  onSlide: (slideNumber: number) => void;
  onEnded: (reason: "closed" | "error", message?: string) => void;
};

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FlWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[void][FlWin]::SetProcessDPIAware()
function Say($line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
try {
  $app = New-Object -ComObject PowerPoint.Application
} catch {
  Say "error PowerPoint no está instalado o no se pudo abrir."
  exit 2
}
try {
  $hadPresentations = $app.Presentations.Count -gt 0
  # ReadOnly, sin título, sin ventana de edición
  $pres = $app.Presentations.Open($env:FLP_PPT_PATH, -1, 0, 0)
  $settings = $pres.SlideShowSettings
  $settings.ShowType = 1
  $settings.ShowPresenterView = 0
  $settings.AdvanceMode = 2
  $settings.StartingSlide = 1
  $settings.EndingSlide = $pres.Slides.Count
  $settings.RangeType = 1
  $show = $settings.Run()
  Start-Sleep -Milliseconds 350
  $hwnd = [IntPtr]$show.HWND
  $x = [int]$env:FLP_X; $y = [int]$env:FLP_Y; $w = [int]$env:FLP_W; $h = [int]$env:FLP_H
  # HWND_TOPMOST, SWP_SHOWWINDOW
  [void][FlWin]::SetWindowPos($hwnd, [IntPtr](-1), $x, $y, $w, $h, 0x0040)
  Say ("ready " + $pres.Slides.Count)
  Say ("slide " + $show.View.CurrentShowPosition)
} catch {
  Say ("error " + $_.Exception.Message)
  exit 3
}
function Finish {
  try { $show.View.Exit() } catch {}
  try { $pres.Close() } catch {}
  try { if (-not $hadPresentations -and $app.Presentations.Count -eq 0) { $app.Quit() } } catch {}
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'exit') { Finish; Say "closed"; exit 0 }
  try {
    $view = $show.View
    if ($view.State -eq 5) { Finish; Say "closed"; exit 0 }
    if ($line -eq 'next') { $view.Next() }
    elseif ($line -eq 'prev') { $view.Previous() }
    elseif ($line -like 'goto *') { $view.GotoSlide([int]$line.Substring(5)) }
    elseif ($line -eq 'front') { [void][FlWin]::SetWindowPos([IntPtr]$show.HWND, [IntPtr](-1), 0, 0, 0, 0, 0x0043) }
    if ($view.State -eq 5) { Finish; Say "closed"; exit 0 }
    Say ("slide " + $view.CurrentShowPosition)
  } catch {
    # El usuario cerró la presentación con Esc o desde PowerPoint.
    Say "closed"
    exit 0
  }
}
`;

export class NativePowerPoint {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private ended = false;
  constructor(private events: NativeEvents) {}

  static supported() {
    return process.platform === "win32";
  }

  async start(path: string, bounds: NativeRect, scriptDirectory: string) {
    const scriptPath = join(scriptDirectory, "fl-powerpoint.ps1");
    // BOM UTF-8: PowerShell 5 lee el script con acentos correctamente.
    await writeFile(scriptPath, "﻿" + SCRIPT, "utf8");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", scriptPath],
      {
        windowsHide: true,
        env: {
          ...process.env,
          FLP_PPT_PATH: path,
          FLP_X: String(Math.round(bounds.x)),
          FLP_Y: String(Math.round(bounds.y)),
          FLP_W: String(Math.round(bounds.width)),
          FLP_H: String(Math.round(bounds.height)),
        },
      },
    );
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        this.handle(line);
      }
    });
    child.stderr.on("data", (chunk) => console.warn("[PowerPoint]", String(chunk).trim()));
    child.once("error", (error) => this.finish("error", error.message));
    child.once("close", () => this.finish("closed"));
  }

  private handle(line: string) {
    if (line.startsWith("ready ")) this.events.onReady(Number(line.slice(6)) || 0);
    else if (line.startsWith("slide ")) this.events.onSlide(Number(line.slice(6)) || 1);
    else if (line.startsWith("error ")) this.finish("error", line.slice(6));
    else if (line === "closed") this.finish("closed");
  }

  private finish(reason: "closed" | "error", message?: string) {
    if (this.ended) return;
    this.ended = true;
    this.child = null;
    this.events.onEnded(reason, message);
  }

  private send(command: string) {
    if (!this.child || this.ended) return;
    try {
      this.child.stdin.write(command + "\n");
    } catch {}
  }

  next() { this.send("next"); }
  previous() { this.send("prev"); }
  goTo(slideNumber: number) { this.send(`goto ${Math.max(1, Math.round(slideNumber))}`); }
  bringToFront() { this.send("front"); }

  stop() {
    if (!this.child || this.ended) return;
    const child = this.child;
    this.send("exit");
    // Si PowerPoint no responde, se cierra el controlador igualmente.
    setTimeout(() => {
      if (!this.ended) child.kill();
    }, 4000);
  }
}
