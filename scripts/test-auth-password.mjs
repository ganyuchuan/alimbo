import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alimbo-auth-password-"));
const dbFile = path.join(tempDir, "cloud.db");
process.env.CLOUD_DB_FILE = dbFile;
function parseCreatedUser(output) {
  const start = output.indexOf("{\n");
  assert.notEqual(start, -1, output);
  return JSON.parse(output.slice(start));
}

try {
  const password = "client-password-123";
  const env = { ...process.env, CLOUD_DB_FILE: dbFile };
  const createUser = spawnSync(process.execPath, [
    path.join(root, "dist/cloud/create-user.js"),
    "--username", "password-user",
    "--password", password,
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(createUser.status, 0, createUser.stderr);
  const user = parseCreatedUser(createUser.stdout);
  assert.equal(user.authType, "user");
  assert.equal(user.password, password);

  const createAdmin = spawnSync(process.execPath, [
    path.join(root, "dist/cloud/create-user.js"),
    "--admin", "--username", "password-admin", "-p", "admin-password-123",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(createAdmin.status, 0, createAdmin.stderr);
  const admin = parseCreatedUser(createAdmin.stdout);
  assert.equal(admin.authType, "admin");

  const { interceptStore } = await import("../dist/cloud/intercept-store.js");
  const { handleAuthServerRoute } = await import("../dist/cloud/auth-server.js");
  async function requestToken(username, submittedPassword, enabled = true) {
    let result;
    await handleAuthServerRoute({
      req: { method: "POST" },
      res: {},
      pathname: "/auth/token",
      logApi() {},
      json(_res, status, body) { result = { status, body }; },
      parseBody: async () => ({ username, password: submittedPassword }),
      requireAdminSession: () => null,
      authTokenAllowPasswordGrant: enabled,
      interceptStore: {
        getPasswordUserByUsername: (name, submitted) => interceptStore.getPasswordUserByUsername(name, submitted),
        withTransaction: action => interceptStore.withTransaction(action),
        createUserTokenRecord: params => interceptStore.createUserTokenRecord(params),
      },
      pairingCodeRegistry: {
        issue: ({ authToken: token, userId, username: name }) => ({ pairingCode: `${userId}:${name}:${token}`, expiresAtMs: Date.now() + 60_000 }),
      },
      pairingCodeTtlMs: 60_000,
      buildOnboardingUrl: () => "https://example.test/onboarding",
    });
    return result;
  }

  const userLogin = await requestToken("password-user", password);
  assert.equal(userLogin.status, 200);
  assert.equal(userLogin.body.authToken, user.authToken);
  assert.equal((await requestToken("password-user", "wrong-password")).status, 401);
  assert.equal((await requestToken("password-user", password, false)).status, 401);

  const adminLogin = await requestToken("password-admin", "admin-password-123");
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.authToken, admin.authToken);
  console.log("Password auth tests passed: user/admin provisioning, existing-token login, wrong-password rejection, disabled-grant rejection.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}