import * as fs from "fs";
import * as path from "path";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as vscode from "vscode";
import { HostSoundEvent } from "../types";

type NativeHelperStartResult = {
  ok: boolean;
  reason?: string;
};

export class NativeHelperBackend implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel(
    "Ridiculous Coding Audio",
  );
  private process?: ChildProcessWithoutNullStreams;
  private startResult: NativeHelperStartResult = {
    ok: false,
    reason: "Helper not started.",
  };
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onUnexpectedExit?: () => void,
  ) {}

  async start(): Promise<NativeHelperStartResult> {
    if (this.process && !this.process.killed) {
      return { ok: true };
    }

    const helperPath = this.getHelperPath();
    if (!helperPath) {
      this.startResult = {
        ok: false,
        reason:
          "Native helper audio is only supported in local desktop VS Code sessions.",
      };
      return this.startResult;
    }
    if (!fs.existsSync(helperPath)) {
      this.startResult = {
        ok: false,
        reason: `Native helper binary not found at ${helperPath}. Falling back to webview audio.`,
      };
      return this.startResult;
    }

    const soundDir = path.join(this.context.extensionPath, "media", "sound");

    try {
      this.process = spawn(helperPath, ["--stdio", "--sound-dir", soundDir], {
        cwd: path.dirname(helperPath),
        stdio: "pipe",
        windowsHide: true,
      });

      this.process.stdout.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) {
          this.output.appendLine(text);
        }
      });

      this.process.stderr.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) {
          this.output.appendLine(text);
        }
      });

      this.process.on("exit", (code) => {
        this.process = undefined;
        this.startResult = {
          ok: false,
          reason:
            code === 0
              ? "Native helper exited."
              : `Native helper exited with code ${code ?? "unknown"}.`,
        };
        if (!this.disposed) {
          this.onUnexpectedExit?.();
        }
      });

      this.process.on("error", (error) => {
        this.process = undefined;
        this.startResult = {
          ok: false,
          reason: `Native helper process error: ${error.message}`,
        };
        this.output.appendLine(
          this.startResult.reason ?? "Native helper process error.",
        );
        if (!this.disposed) {
          this.onUnexpectedExit?.();
        }
      });

      this.startResult = { ok: true };
      return this.startResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.startResult = {
        ok: false,
        reason: `Failed to start native helper: ${message}`,
      };
      return this.startResult;
    }
  }

  play(event: HostSoundEvent): boolean {
    if (!this.process || this.process.killed || !this.process.stdin.writable) {
      return false;
    }

    try {
      this.process.stdin.write(`${JSON.stringify(event)}\n`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(
        `Failed to write sound event to native helper: ${message}`,
      );
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.process?.kill();
    } catch {
      // Ignore disposal errors from partially started helpers.
    }
    this.output.dispose();
  }

  private getHelperPath(): string | undefined {
    if (
      vscode.env.uiKind !== vscode.UIKind.Desktop ||
      typeof vscode.env.remoteName !== "undefined"
    ) {
      return undefined;
    }

    const platformTarget = this.getPlatformTarget();
    if (!platformTarget) {
      return undefined;
    }

    const executable =
      process.platform === "win32"
        ? "ridiculous-audio-helper.exe"
        : "ridiculous-audio-helper";
    return path.join(
      this.context.extensionPath,
      "bin",
      "audio-helper",
      platformTarget,
      executable,
    );
  }

  private getPlatformTarget(): string | undefined {
    switch (`${process.platform}-${process.arch}`) {
      case "win32-x64":
      case "win32-arm64":
      case "linux-x64":
      case "linux-arm64":
      case "darwin-x64":
      case "darwin-arm64":
        return `${process.platform}-${process.arch}`;
      default:
        return undefined;
    }
  }
}
