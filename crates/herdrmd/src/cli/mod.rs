use crate::service::{self, Result};
use serde_json::json;
use std::path::PathBuf;

pub fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let words: Vec<_> = args.iter().map(|arg| arg.to_str()).collect();
    if args.is_empty() || words == [Some("--help")] {
        println!(
            "herdrmd {} — task 00 bridge probe (no Vault operations)\n\
             Usage: herdrmd serve --state-dir <absolute scratch directory>\n\
             Usage: herdrmd service <ensure|status|stop> --state-dir <directory>\n\
             Usage: herdrmd bridge report --state-dir <directory>",
            env!("CARGO_PKG_VERSION")
        );
        return Ok(());
    }
    if words == [Some("--version")] {
        println!("herdrmd {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let (operation, flag_index) = match words.as_slice() {
        [Some("serve"), ..] => ("serve", 1),
        [
            Some("service"),
            Some(op @ ("ensure" | "status" | "stop")),
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
