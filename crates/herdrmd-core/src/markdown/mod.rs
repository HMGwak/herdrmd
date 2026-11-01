//! Wiki lookup and create-on-follow. The UI only formats links; paths stay here.
use crate::{
    Result, platform,
    vault::{self, Vault},
};
use serde::Serialize;
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};
use unicode_normalization::UnicodeNormalization;

const MAX_ENTRIES: usize = 50_000;
const MAX_DIRECTORIES: usize = 5_000;
const MAX_DEPTH: usize = 64;
const MAX_MATCHES: usize = 200;
const MAX_TIME: Duration = Duration::from_secs(5);

#[derive(Serialize)]
pub struct LinkResolution {
    pub status: &'static str,
    pub matches: Vec<String>,
    pub fragment: Option<String>,
    pub truncated: bool,
    pub created: bool,
}

fn normalized(text: &str) -> String {
    text.nfc().collect()
}
fn folded(text: &str) -> String {
    normalized(&text.to_lowercase())
}
fn without_extension(text: &str) -> &str {
    if text
        .get(text.len().saturating_sub(3)..)
        .is_some_and(|ext| ext.eq_ignore_ascii_case(".md"))
    {
        &text[..text.len() - 3]
    } else {
        text
    }
}
fn valid_path(text: &str) -> bool {
    !text.is_empty()
        && !text.contains(['\\', ':', '\0', '\r', '\n'])
        && !text.starts_with('/')
        && text
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != ".." && !vault::excluded(part))
}
fn answer(mut matches: Vec<String>, fragment: Option<String>, truncated: bool) -> LinkResolution {
    matches.sort();
    matches.dedup();
    if truncated {
        matches.truncate(MAX_MATCHES);
    }
    LinkResolution {
        status: if truncated {
            "incomplete"
        } else {
            match matches.len() {
                0 => "not_found",
                1 => "found",
                _ => "ambiguous",
            }
        },
        matches,
        fragment,
        truncated,
        created: false,
    }
}

pub fn resolve(vault: &Vault, from: &str, target: &str) -> Result<LinkResolution> {
    resolve_with_limits(vault, from, target, MAX_ENTRIES, MAX_TIME)
}

/// A link click may create an empty note, but an incomplete search never implies absence.
pub fn follow(
    vault: &Vault,
    from: &str,
    target: &str,
    directories: &platform::UserDirectories,
) -> Result<LinkResolution> {
    let result = resolve(vault, from, target)?;
    if result.status != "not_found" {
        return Ok(result);
    }
    let creation = crate::storage::Creation::begin(vault, directories)?;
    let result = resolve(vault, from, target)?;
    if result.status != "not_found" {
        return Ok(result);
    }
    let name = target
        .split('|')
        .next()
        .unwrap_or("")
        .split('#')
        .next()
        .unwrap_or("")
        .trim();
    let name = normalized(without_extension(name));
    if !valid_path(&name)
        || name.split('/').count() > MAX_DEPTH
        || name.split('/').any(|part| {
            part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|c| c.is_control() || "<>\"?*|".contains(c))
                || {
                    let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                        || stem
                            .strip_prefix("COM")
                            .or_else(|| stem.strip_prefix("LPT"))
                            .is_some_and(|n| {
                                matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
                            })
                }
        })
    {
        return Err("wiki target is not a portable Markdown creation path".into());
    }
    let path = format!("{name}.md");
    let created = creation.empty_note(vault, &path)?;
    let mut result = answer(vec![path], result.fragment, false);
    result.created = created;
    Ok(result)
}

fn resolve_with_limits(
    vault: &Vault,
    from: &str,
    target: &str,
    budget: usize,
    duration: Duration,
) -> Result<LinkResolution> {
    if !valid_path(from) || !vault::is_markdown(Path::new(from)) || !vault.resolve(from)?.is_file()
    {
        return Err("link source must be an existing Markdown document".into());
    }
    if target.len() > 4096 || target.contains(['\0', '\r', '\n']) {
        return Err("invalid wiki target".into());
    }
    let target = target.split('|').next().unwrap_or("").trim();
    let (name, fragment) = target
        .split_once('#')
        .map_or((target, None), |(name, fragment)| {
            (name, Some(fragment.to_owned()))
        });
    let name = name.trim();
    if name.is_empty() {
        if fragment.is_some() {
            return Ok(answer(vec![from.to_owned()], fragment, false));
        }
        return Err("empty wiki target".into());
    }
    if !valid_path(name) {
        return Err("invalid or excluded wiki target".into());
    }
    let wanted = normalized(without_extension(name));
    let qualified = wanted.contains('/');
    // An explicit full Vault path is authoritative and needs no global scan.
    if qualified {
        let candidate = format!("{wanted}.md");
        if let Ok(path) = vault.resolve(&candidate) {
            if path.is_file() {
                return Ok(answer(vec![candidate], fragment, false));
            }
        }
    }
    let parent = from.rsplit_once('/').map_or("", |(parent, _)| parent);
    let relative = if parent.is_empty() {
        wanted.clone()
    } else {
        format!("{parent}/{wanted}")
    };
    let lower = folded(&wanted);
    let start = Instant::now();
    let mut queue = vec![(String::new(), 0usize)];
    let mut examined = 0;
    let mut directories = 0;
    let mut incomplete = false;
    let mut exact = Vec::new();
    let mut insensitive = Vec::new();
    let mut qualified_root = Vec::new();
    let mut qualified_relative = Vec::new();
    'walk: while let Some((directory, depth)) = queue.pop() {
        if directories >= MAX_DIRECTORIES || start.elapsed() >= duration {
            incomplete = true;
            break;
        }
        directories += 1;
        let listing = match vault
            .resolve(&directory)
            .and_then(|path| Ok(fs::read_dir(path)?))
        {
            Ok(listing) => listing,
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        for item in listing {
            if examined >= budget || start.elapsed() >= duration {
                incomplete = true;
                break 'walk;
            }
            examined += 1;
            let item = match item {
                Ok(item) => item,
                Err(_) => {
                    incomplete = true;
                    continue;
                }
            };
            let Ok(name) = item.file_name().into_string() else {
                continue;
            };
            if vault::excluded(&name) || name.contains(['\\', ':']) {
                continue;
            }
            let meta = match fs::symlink_metadata(item.path()) {
                Ok(meta) => meta,
                Err(_) => {
                    incomplete = true;
                    continue;
                }
            };
            if platform::is_link(&meta) {
                continue;
            }
            let path = if directory.is_empty() {
                name.clone()
            } else {
                format!("{directory}/{name}")
            };
            if meta.is_dir() {
                if depth < MAX_DEPTH && queue.len() < MAX_DIRECTORIES {
                    queue.push((path, depth + 1));
                } else {
                    incomplete = true;
                }
                continue;
            }
            if !meta.is_file() || !vault::is_markdown(Path::new(&name)) {
                continue;
            }
            let candidate = normalized(without_extension(if qualified { &path } else { &name }));
            let same =
                candidate == wanted || (qualified && candidate.ends_with(&format!("/{wanted}")));
            if same {
                exact.push(path.clone());
            } else if folded(&candidate) == lower
                || (qualified && folded(&candidate).ends_with(&format!("/{lower}")))
            {
                insensitive.push(path.clone());
            }
            if qualified && candidate == normalized(&relative) {
                qualified_relative.push(path.clone());
            }
            if qualified && candidate == wanted {
                qualified_root.push(path);
            }
            if exact.len() + insensitive.len() > MAX_MATCHES {
                incomplete = true;
                break 'walk;
            }
        }
    }
    let matches = if !qualified_root.is_empty() {
        qualified_root
    } else if !qualified_relative.is_empty() {
        qualified_relative
    } else if !exact.is_empty() {
        exact
    } else {
        insensitive
    };
    Ok(answer(matches, fragment, incomplete))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Registry;
    #[test]
    fn search_budget_never_claims_a_unique_or_missing_answer() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let vault_path = root.join("vault");
        fs::create_dir(&vault_path).unwrap();
        fs::write(vault_path.join("from.md"), "# Source").unwrap();
        let vault = Registry::add(&root.join("config"), "test", &vault_path).unwrap();
        let result = resolve_with_limits(&vault, "from.md", "unknown", 0, MAX_TIME).unwrap();
        assert_eq!(result.status, "incomplete");
        assert!(result.truncated);
    }
}
