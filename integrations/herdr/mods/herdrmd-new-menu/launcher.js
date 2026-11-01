// Pure launch contract. Machine-local paths and aliases live in launcher.json,
// outside the product repository. Switching to NAS only changes that target.
export function parseTarget(text) {
  const target = JSON.parse(text);
  if (!target || typeof target !== "object") throw new Error("missing target");
  for (const key of ["name", "binary", "vault"]) {
    if (typeof target[key] !== "string" || !target[key].trim()) throw new Error(`missing ${key}`);
  }
  if (!/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(target.binary)) throw new Error("binary must be absolute");
  if (target.machine !== undefined && (typeof target.machine !== "string" || !target.machine.trim())) {
    throw new Error("invalid machine");
  }
  if (target.file !== undefined && (typeof target.file !== "string" ||
    target.file.startsWith("/") || target.file.includes("\\") || target.file.includes(":") ||
    target.file.split("/").includes(".."))) throw new Error("file must be Vault-relative");
  return {
    name: target.name, binary: target.binary, vault: target.vault,
    ...(target.machine ? { machine: target.machine } : {}),
    ...(target.file ? { file: target.file } : {}),
  };
}

export function launchArguments(target, space) {
  return {
    name: target.name,
    ...(space ? { space } : {}),
    mod: "herdrmd",
    props: {
      mode: "vault", label: target.name, binary: target.binary, vault: target.vault,
      ...(target.machine ? { machine: target.machine } : {}),
      ...(target.file ? { file: target.file } : {}),
    },
  };
}
