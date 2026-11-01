mod cli;
mod platform;
mod service;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn main() -> std::process::ExitCode {
    match cli::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("herdrmd-diagnostics: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
