import { it } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { HeliconServer } from "../src/server.js";

it("refuses unauthenticated network binds before opening the store", () => {
  for (const host of ["0.0.0.0", "::", "192.168.1.2"]) {
    for (const token of [undefined, "", "   "]) {
      assert.throws(() => new HeliconServer({ host, token, dataDir: ":memory:" }), /token is required/);
    }
    assert.throws(() => new HeliconServer({ host, desktopAuth: true, dataDir: ":memory:" }), /loopback/);
  }
});

it("validates Host independently of Origin and credentials", async (t) => {
  const server = new HeliconServer({ port: 0, dataDir: ":memory:", token: "test-secret", allowHosts: ["proxy.example"] });
  t.after(() => server.close());
  const { port } = await server.listen();
  const status = (host: string, authenticated = true) => new Promise<number | undefined>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/api/health", headers: {
      host, ...(authenticated ? { authorization: "Bearer test-secret" } : {}),
    } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.end();
  });
  assert.equal(await status(`127.0.0.1:${port}`), 200);
  assert.equal(await status(`localhost:${port}`), 200);
  assert.equal(await status("evil.example"), 403);
  assert.equal(await status("127.0.0.1.evil.example"), 403);
  assert.equal(await status("proxy.example"), 200);
  assert.equal(await status("proxy.example", false), 401);
});

it("keeps network access working with a token and explicitly allowed browser origin", async (t) => {
  const server = new HeliconServer({
    host: "0.0.0.0", port: 0, dataDir: ":memory:", token: "network-test-secret",
    allowOrigins: ["https://helicon.example"],
  });
  t.after(() => server.close());
  const { port } = await server.listen();
  const url = `http://127.0.0.1:${port}/api/health`;
  const headers = { origin: "https://helicon.example", authorization: "Bearer network-test-secret" };
  assert.equal((await fetch(url, { headers })).status, 200);
  const denied = await fetch(url, { headers: { ...headers, authorization: "Bearer wrong" } });
  assert.equal(denied.status, 401);
  assert.equal(((await denied.json()) as { kind: string }).kind, "unauthorized");
  const blocked = await fetch(url, { headers: { ...headers, origin: "https://evil.example" } });
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { kind: string }).kind, "originForbidden");
});

it("bootstraps desktop once and authenticates pages, assets, API and events with its cookie", async (t) => {
  const staticDir = await mkdtemp(join(tmpdir(), "helicon-access-"));
  t.after(() => rm(staticDir, { recursive: true, force: true }));
  await writeFile(join(staticDir, "index.html"), "desktop-page");
  await writeFile(join(staticDir, "app.js"), "desktop-asset");
  const server = new HeliconServer({ port: 0, dataDir: ":memory:", desktopAuth: true, staticDir });
  t.after(() => server.close());
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const launch = server.desktopLaunchUrl(base);
  for (const path of ["/", "/app.js", "/api/health", "/api/events", "/api/files/raw"]) {
    assert.equal((await fetch(base + path)).status, 401);
  }
  assert.equal((await fetch(launch, { headers: { origin: "https://evil.example" }, redirect: "manual" })).status, 403);
  assert.equal((await fetch(base + "/api/desktop-auth?key=wrong")).status, 401);
  const response = await fetch(launch, { redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const setCookie = response.headers.get("set-cookie")!;
  assert.ok(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Lax"));
  const cookie = setCookie.split(";")[0]!;
  const token = cookie.split("=")[1]!;
  assert.ok(!launch.includes(token));
  assert.equal((await fetch(launch, { redirect: "manual" })).status, 401);
  assert.equal((await fetch(base + "/api/health?token=" + token)).status, 401);
  assert.equal((await fetch(base + "/api/health", { headers: { cookie: "helicon_token=%ZZ" } })).status, 401);
  const headers = { cookie };
  assert.equal(await (await fetch(base, { headers })).text(), "desktop-page");
  assert.equal(await (await fetch(base + "/app.js", { headers })).text(), "desktop-asset");
  assert.equal((await fetch(base + "/api/health", { headers })).status, 200);
  const project = await fetch(base + "/api/projects", {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ cwd: staticDir }),
  });
  assert.equal(project.status, 200);
  const { project: { cwd } } = await project.json() as { project: { cwd: string } };
  const raw = `/api/files/raw?${new URLSearchParams({ cwd, path: "app.js" })}`;
  assert.equal((await fetch(base + raw)).status, 401);
  assert.equal(await (await fetch(base + raw, { headers })).text(), "desktop-asset");
  const part = await fetch(base + raw, { headers: { ...headers, range: "bytes=0-6" } });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), "desktop");
  assert.equal((await fetch(base + "/api/health", { headers: { ...headers, origin: "https://evil.example" } })).status, 403);
  const controller = new AbortController();
  try {
    const events = await fetch(base + "/api/events", { headers, signal: controller.signal });
    assert.equal(events.status, 200);
    assert.ok(events.headers.get("content-type")?.includes("text/event-stream"));
  } finally { controller.abort(); }
  const next = new HeliconServer({ port: 0, dataDir: ":memory:", desktopAuth: true });
  t.after(() => next.close());
  const nextAddress = await next.listen();
  assert.equal((await fetch(`http://127.0.0.1:${nextAddress.port}/api/health`, { headers })).status, 401);
});

it("CLI delivers the desktop bootstrap through stdout and rejects a missing network token", async (t) => {
  const cli = join(__dirname, "../src/cli.js");
  const child = spawn(process.execPath, [cli, "--desktop-auth", "--port", "0", "--data-dir", ":memory:"], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); });
  const launch = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No desktop launch URL")), 10000);
    let output = "";
    child.on("error", reject);
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      if (output.includes("\n")) {
        clearTimeout(timer);
        resolve(output.trim().replace("helicon-server listening on ", ""));
      }
    });
  });
  assert.ok(new URL(launch).pathname === "/api/desktop-auth");
  assert.equal((await fetch(launch, { redirect: "manual" })).status, 303);
  const invalid = spawn(process.execPath, [cli, "--host", "0.0.0.0", "--token", "--port", "0", "--data-dir", ":memory:"], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { invalid.kill(); });
  let message = "";
  invalid.stderr.on("data", (data: Buffer) => { message += data.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => {
    invalid.on("error", reject);
    invalid.on("exit", resolve);
  });
  assert.equal(code, 1);
  assert.ok(message.includes("token is required"));
});
