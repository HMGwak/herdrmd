mod cli;
mod relay;

fn main() -> std::process::ExitCode {
    let relay_command = std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "relay" || arg == "relay-prepare");
    let result = if relay_command {
        relay::run()
    } else {
        cli::run()
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("herdrmd: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
