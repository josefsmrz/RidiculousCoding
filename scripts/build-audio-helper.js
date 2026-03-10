const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SUPPORTED_TARGETS = {
    "win32-x64": "win32-x64",
    "win32-arm64": "win32-arm64",
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "darwin-x64": "darwin-x64",
    "darwin-arm64": "darwin-arm64"
};

const RUST_TARGETS = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin"
};

const root = path.resolve(__dirname, "..");
const helperRoot = path.join(root, "helper", "audio-helper");
const manifestPath = path.join(helperRoot, "Cargo.toml");
const requestedTarget = getRequestedTarget();

const target = requestedTarget ?? getHostPlatformTarget();
if (!target) {
    console.error(`Unsupported platform target for audio helper: ${requestedTarget ?? `${process.platform}-${process.arch}`}`);
    process.exit(1);
}

const rustTarget = getRustTarget(target);
const cargoToolchain = getCargoToolchain(target);
const cargoArgs = [];
if (cargoToolchain) {
    cargoArgs.push(cargoToolchain);
}
cargoArgs.push("build", "--release", "--manifest-path", manifestPath);
if (rustTarget) {
    cargoArgs.push("--target", rustTarget);
}

const cargo = spawnSync("cargo", cargoArgs, {
    cwd: root,
    stdio: "inherit"
});

if (cargo.status !== 0) {
    process.exit(cargo.status ?? 1);
}

const executableName = target.startsWith("win32-") ? "ridiculous-audio-helper.exe" : "ridiculous-audio-helper";
const source = rustTarget
    ? path.join(helperRoot, "target", rustTarget, "release", executableName)
    : path.join(helperRoot, "target", "release", executableName);
const destinationDir = path.join(root, "bin", "audio-helper", target);
const destination = path.join(destinationDir, executableName);

fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(source, destination);

console.log(`Copied ${executableName} to ${destination}`);

function getRequestedTarget() {
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--target") {
            return args[index + 1];
        }
    }
    return process.env.RC_AUDIO_TARGET;
}

function getHostPlatformTarget() {
    const key = `${process.platform}-${process.arch}`;
    return SUPPORTED_TARGETS[key];
}

function getRustTarget(target) {
    const rustTarget = RUST_TARGETS[target];
    if (!rustTarget) {
        return undefined;
    }

    const installedTargets = spawnSync("rustup", ["target", "list", "--installed"], {
        cwd: root,
        encoding: "utf8"
    });

    if (installedTargets.status !== 0) {
        console.error("Failed to inspect installed Rust targets.");
        process.exit(installedTargets.status ?? 1);
    }

    if (!installedTargets.stdout.includes(rustTarget)) {
        console.error(`Rust target ${rustTarget} is not installed. Run: rustup target add ${rustTarget}`);
        process.exit(1);
    }

    return rustTarget;
}

function getCargoToolchain(target) {
    if (target !== "win32-arm64") {
        return undefined;
    }

    const toolchains = spawnSync("rustup", ["toolchain", "list"], {
        cwd: root,
        encoding: "utf8"
    });

    if (toolchains.status === 0 && toolchains.stdout.includes("stable-x86_64-pc-windows-gnu")) {
        return "+stable-x86_64-pc-windows-gnu";
    }

    return undefined;
}