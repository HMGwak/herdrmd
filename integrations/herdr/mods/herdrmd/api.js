import { exec, hc, readTextFile } from "herdr";

export async function connect(binary, stateDir, windows) {
  let reused;
  if (windows) {
    const status = await exec(binary, ["service", "status", "--state-dir", stateDir]);
    reused = status.code === 0;
    if (!reused) {
      // Windows exec jobs kill their children on return. Have the local core
      // own serve directly, outside that job, with no UI/agent parent lifetime.
      const started = await hc(["--json", "run", "--bg", "--no-parent", "--no-notify", "--rm",
        "--", binary, "serve", "--state-dir", stateDir]);
      if (started.code !== 0) throw new Error(`core service launch failed (${started.code})`);
    }
  }
  const operation = windows ? "wait" : "ensure";
  const result = await exec(binary, ["service", operation, "--state-dir", stateDir]);
  if (result.code !== 0) throw new Error(`service ${operation} failed (${result.code})`);
  const launcher = JSON.parse(result.stdout);
  const text = await readTextFile(launcher.connection_file);
  if (text === null) throw new Error("connection file missing");
  const connection = JSON.parse(text);
  if (connection.protocol_version !== 1) throw new Error("protocol mismatch");
  const base = `http://127.0.0.1:${connection.port}`;
  const request = async (path, body) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  };
  const health = await request("/v1/health");
  // This runs after Herdr's exec has returned: an actual detached-survival check.
  const unauthenticated = await fetch(base + "/v1/health");
  if (unauthenticated.status !== 401) throw new Error("authentication probe failed");
  return {
    pid: health.pid,
    reused: windows ? reused : launcher.reused,
    request,
    event: (kind, instance) => request("/v1/events", { kind, instance }),
  };
}
