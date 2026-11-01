use crate::service::{self, Result};
use serde_json::json;
use std::path::PathBuf;

pub fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let words: Vec<_> = args.iter().map(|arg| arg.to_str()).collect();
    if args.is_empty() || words == [Some("--help")] {
        println!(
            "herdrmd {} — Vault browser and bridge probe\n\
             Usage: herdrmd vault add <name> <absolute Vault path>\n\
             Usage: herdrmd vault list\n\
             Usage: herdrmd files/read --vault <name> --path <Vault-relative path>\n\
             Usage: herdrmd resolve/follow --vault <name> --from <source.md> --target <wiki target>\n\
             Usage: herdrmd paths\n\
             Usage: herdrmd serve --state-dir <absolute scratch directory>\n\
             Usage: herdrmd service <ensure|wait|status|stop> --state-dir <directory>\n\
             Usage: herdrmd bridge report --state-dir <directory>",
            env!("CARGO_PKG_VERSION")
        );
        return Ok(());
    }
    if words == [Some("--version")] {
        println!("herdrmd {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if matches!(
        words.first(),
        Some(Some(
            "vault" | "files" | "read" | "resolve" | "follow" | "paths"
        ))
    ) {
        return vault_command(&args);
    }
    if words == [Some("bridge"), Some("location")] {
        println!(
            "{}",
            json!({"state_dir": super::platform::probe_directory()})
        );
        return Ok(());
    }
    let (operation, flag_index) = match words.as_slice() {
        [Some("serve"), ..] => ("serve", 1),
        [
            Some("service"),
            Some(op @ ("ensure" | "wait" | "status" | "stop")),
            ..,
        ] => (*op, 2),
        [Some("bridge"), Some("report"), ..] => ("report", 2),
        _ => return Err("unknown command; use --help".into()),
    };
    if args.len() != flag_index + 2 || words[flag_index] != Some("--state-dir") {
        return Err("task 00 requires --state-dir <absolute scratch directory>".into());
    }
    let directory = PathBuf::from(&args[flag_index + 1]);
    if !directory.is_absolute() {
        return Err("--state-dir must be absolute".into());
    }
    if operation == "serve" {
        return service::serve(&directory);
    }
    let result = match operation {
        "ensure" => service::ensure(&directory)?,
        "wait" => service::wait(&directory)?,
        "status" => service::request(&directory, "/v1/health", false)?,
        "report" => service::request(&directory, "/v1/probe", false)?,
        "stop" => {
            service::request(&directory, "/v1/stop", true)?;
            json!({"protocol_version": 1, "stopping": true})
        }
        _ => unreachable!(),
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn vault_command(args: &[std::ffi::OsString]) -> Result<()> {
    use herdrmd_core::{document, platform, vault::Registry};
    let mut config = platform::user_directories()?.config;
    let mut args = args.to_vec();
    if let Some(index) = args.iter().position(|arg| arg == "--config-dir") {
        if index + 2 != args.len() {
            return Err("--config-dir must be the last option".into());
        }
        config = PathBuf::from(&args[index + 1]);
        if !config.is_absolute() {
            return Err("config directory must be absolute".into());
        }
        args.truncate(index);
    }
    let words: Vec<_> = args.iter().map(|arg| arg.to_str()).collect();
    let value = match words.as_slice() {
        [Some("paths")] => serde_json::to_value(platform::user_directories()?)?,
        [Some("vault"), Some("list")] => serde_json::to_value(Registry::load(&config)?)?,
        [Some("vault"), Some("add"), Some(name), Some(_)] => {
            serde_json::to_value(Registry::add(&config, name, &PathBuf::from(&args[3]))?)?
        }
        [Some(operation @ ("files" | "read")), Some("--vault"), Some(vault), Some("--path"), Some(path)] => {
            let registry = Registry::load(&config)?;
            let vault = registry.get(vault)?;
            if *operation == "files" { serde_json::to_value(vault.list(path)?)? }
            else { serde_json::to_value(document::read(vault, path)?)? }
        }
        [Some(operation @ ("resolve" | "follow")), Some("--vault"), Some(vault), Some("--from"), Some(from), Some("--target"), Some(target)] => {
            let registry = Registry::load(&config)?;
            let vault = registry.get(vault)?;
            if *operation == "follow" { serde_json::to_value(herdrmd_core::markdown::follow(vault, from, target, &platform::user_directories()?)?)? }
            else { serde_json::to_value(herdrmd_core::markdown::resolve(vault, from, target)?)? }
        }
        _ => return Err("usage: vault add <name> <absolute path> | vault list | files/read --vault <name> --path <relative path> | resolve/follow --vault <name> --from <source.md> --target <target> | paths; optional --config-dir <absolute path>".into()),
    };
    println!("{}", serde_json::to_string(&value)?);
    Ok(())
}
