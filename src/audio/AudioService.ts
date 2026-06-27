import * as vscode from "vscode";
import { NativeHelperBackend } from "./NativeHelperBackend";
import {
  AudioBackendState,
  HostSoundEvent,
  PanelMessageFromExt,
  SoundBackendSetting,
} from "../types";
import { PanelViewProvider } from "../view/PanelViewProvider";

export class AudioService implements vscode.Disposable {
  private nativeHelper?: NativeHelperBackend;
  private audioBackendState: AudioBackendState = {
    configured: "auto",
    active: "webview",
    note: "Webview audio is active. Click the panel to unlock sound.",
  };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panelProvider: PanelViewProvider,
  ) {}

  async configure(configured: SoundBackendSetting): Promise<void> {
    this.audioBackendState = await this.resolveAudioBackend(configured);
    this.panelProvider.setAudioBackendState(this.audioBackendState);
  }

  play(event: HostSoundEvent): void {
    if (this.audioBackendState.active === "nativeHelper") {
      const played = this.nativeHelper?.play(event) ?? false;
      if (played) {
        return;
      }
    }

    this.panelProvider.post(this.toPanelMessage(event));
  }

  getAudioBackendState(): AudioBackendState {
    return this.audioBackendState;
  }

  dispose(): void {
    this.nativeHelper?.dispose();
  }

  private async resolveAudioBackend(
    configured: SoundBackendSetting,
  ): Promise<AudioBackendState> {
    if (configured === "webview") {
      this.disposeNativeHelper();
      return {
        configured,
        active: "webview",
        note: "Webview audio is active. Click the panel to unlock sound.",
      };
    }

    const nativeState = await this.tryEnableNativeHelper(configured);
    if (nativeState) {
      return nativeState;
    }

    this.disposeNativeHelper();

    return {
      configured,
      active: "webview",
      note:
        configured === "nativeHelper"
          ? "Native helper audio is unavailable. Falling back to webview audio, which still needs a panel click to unlock."
          : "Native helper audio is unavailable. Auto mode is using webview audio, which needs a panel click to unlock.",
    };
  }

  private async tryEnableNativeHelper(
    configured: SoundBackendSetting,
  ): Promise<AudioBackendState | undefined> {
    this.disposeNativeHelper();
    const helper = new NativeHelperBackend(this.context, () => {
      if (
        this.nativeHelper !== helper ||
        this.audioBackendState.active !== "nativeHelper"
      ) {
        return;
      }

      this.nativeHelper = undefined;
      this.audioBackendState = {
        configured: this.audioBackendState.configured,
        active: "webview",
        note: "Native helper audio exited. Falling back to webview audio, which needs a panel click to unlock sound.",
      };
      this.panelProvider.setAudioBackendState(this.audioBackendState);
    });
    this.nativeHelper = helper;

    const result = await this.nativeHelper.start();
    if (!result.ok) {
      this.disposeNativeHelper();
      return undefined;
    }

    return {
      configured,
      active: "nativeHelper",
      note: "Native helper audio is active in this local desktop session.",
    };
  }

  private disposeNativeHelper(): void {
    this.nativeHelper?.dispose();
    this.nativeHelper = undefined;
  }

  private toPanelMessage(event: HostSoundEvent): PanelMessageFromExt {
    switch (event.type) {
      case "blip":
        return { type: "blip", enabled: true, pitch: event.pitch };
      case "boom":
        return { type: "boom", enabled: true };
      case "fireworks":
        return { type: "fireworks", enabled: true };
    }
  }
}
