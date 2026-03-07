use rodio::{Decoder, OutputStream, Sink, Source};
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Cursor;
use std::io::{self, BufRead};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct PlayCommand {
    #[serde(rename = "type")]
    kind: String,
    pitch: Option<f32>,
    gain: Option<f32>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let sound_dir = parse_args()?;
    let sounds = load_sounds(&sound_dir)?;

    let (_stream, stream_handle) = OutputStream::try_default()
        .map_err(|error| format!("failed to open default audio output: {error}"))?;

    eprintln!("ready");

    let stdin = io::stdin();
    let mut active_sinks: Vec<Sink> = Vec::new();

    for line in stdin.lock().lines() {
        let line = line.map_err(|error| format!("failed to read stdin: {error}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let command: PlayCommand = match serde_json::from_str(trimmed) {
            Ok(command) => command,
            Err(error) => {
                eprintln!("invalid-command: {error}");
                continue;
            }
        };

        active_sinks.retain(|sink| !sink.empty());

        if let Err(error) = play_command(&stream_handle, &sounds, command, &mut active_sinks) {
            eprintln!("playback-error: {error}");
        }
    }

    Ok(())
}

fn parse_args() -> Result<PathBuf, String> {
    let mut args = env::args().skip(1);
    let mut sound_dir: Option<PathBuf> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--stdio" => {}
            "--sound-dir" => {
                let value = args
                    .next()
                    .ok_or_else(|| "missing value for --sound-dir".to_string())?;
                sound_dir = Some(PathBuf::from(value));
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    sound_dir.ok_or_else(|| "--sound-dir is required".to_string())
}

fn load_sounds(sound_dir: &PathBuf) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut sounds = HashMap::new();

    for sound_name in ["blip", "boom", "fireworks"] {
        let file_path = sound_dir.join(format!("{sound_name}.wav"));
        let bytes = fs::read(&file_path)
            .map_err(|error| format!("failed to read {}: {error}", file_path.display()))?;
        sounds.insert(sound_name.to_string(), bytes);
    }

    Ok(sounds)
}

fn play_command(
    stream_handle: &rodio::OutputStreamHandle,
    sounds: &HashMap<String, Vec<u8>>,
    command: PlayCommand,
    active_sinks: &mut Vec<Sink>,
) -> Result<(), String> {
    let bytes = sounds
        .get(&command.kind)
        .ok_or_else(|| format!("unknown sound kind: {}", command.kind))?
        .clone();

    let playback_rate = command.pitch.unwrap_or(1.0).clamp(0.5, 3.0);
    let gain = command.gain.unwrap_or(0.5).clamp(0.0, 2.0);
    let cursor = Cursor::new(bytes);
    let decoder = Decoder::new_wav(cursor)
        .map_err(|error| format!("failed to decode wav for {}: {error}", command.kind))?;
    let source = decoder.speed(playback_rate);

    let sink = Sink::try_new(stream_handle)
        .map_err(|error| format!("failed to create audio sink: {error}"))?;
    sink.set_volume(gain);
    sink.append(source);
    sink.play();
    active_sinks.push(sink);

    Ok(())
}
