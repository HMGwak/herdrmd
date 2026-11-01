mod cli;
mod platform;
mod service;

fn main() -> std::process::ExitCode {
    match cli::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("herdrmd: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
