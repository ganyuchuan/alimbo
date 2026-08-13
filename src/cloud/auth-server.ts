type AuthServerRouteContext = {
  req: any;
  res: any;
  pathname: string;
  logApi: (req: any, pathname: string, message: string) => void;
  html: (res: any, status: number, body: string) => void;
  json: (res: any, status: number, body: Record<string, unknown>) => void;
  parseBody: <T extends Record<string, unknown> = Record<string, unknown>>(req: any) => Promise<T>;
  readFormBody: (req: any) => Promise<URLSearchParams>;
  normalizeReturnTo: (value: unknown) => string;
  buildLoginPage: (params?: { returnTo?: string; error?: string }) => string;
  redirect: (res: any, location: string, status?: number) => void;
  clearAdminSessionCookie: (res: any) => void;
  createAdminSessionForPrincipal: (res: any, principal: any) => { sessionToken: string };
  isAdminPrincipal: (principal: any) => boolean;
  requireAdminSession: (req: any, res: any) => any;
  requireInterceptAuth: (req: any, res: any) => any;
  normalizeApnsPlatform: (value: unknown) => string;
  interceptStore: {
    verifyAdminPassword: (username: string, password: string) => any;
    withTransaction: <T>(action: () => T) => T;
    createUserTokenRecord: (params: { username: string }) => { userId: string; authToken: string; username: string };
    createOrRefreshAppleUserTokenRecord: (params: {
      appleSub: string;
      email?: string;
      emailVerified?: boolean;
      isPrivateEmail?: boolean;
      now: number;
    }) => { userId: string; authToken: string; username: string };
    getUserByAuthToken: (authToken: string) => any;
    listUsers: (limit: number) => any[];
    getUserById: (userId: string) => any;
  };
  pairingCodeRegistry: {
    issue: (params: { authToken: string; userId: string; username: string }) => { pairingCode: string; expiresAtMs: number };
    resolve: (pairingCode: string) => { pairingCode: string; userId: string; username: string; authToken: string; expiresAtMs: number } | null;
  };
  pairingCodeTtlMs: number;
  authTokenAllowPasswordGrant: boolean;
  buildOnboardingUrl: (req: any) => string;
  verifyAppleIdentityToken: (params: {
    identityToken: string;
    clientId: string;
    nonce?: string;
    issuer?: string;
  }) => Promise<{ sub: string; email?: string; emailVerified?: boolean; isPrivateEmail?: boolean }>;
  appleClientId: string;
  appleIssuer: string;
  apnsStore: {
    bindDeviceToken: (userId: string, deviceToken: string, platform: string) => { userId: string; deviceToken: string; platform: string; updatedAtMs: number };
    listDeviceBindingsByUserId: (userId: string) => Array<{ deviceToken: string }>;
    listAllDeviceBindings: (limit: number) => Array<{ userId: string; deviceToken: string; platform: string; updatedAtMs: number }>;
    unbindDeviceTokens: (bindings: Array<{ userId: string; deviceToken: string }>) => number;
  };
  isLikelyDeviceToken: (value: unknown) => boolean;
  toInt: (value: unknown, fallback: number) => number;
};

type AuthTokenBody = {
  username?: string;
  password?: string;
};

type AppleLoginBody = {
  identityToken?: string;
  nonce?: string;
  deviceToken?: string;
  platform?: string;
};

type PairingCodeResolveBody = {
  pairingCode?: string;
};

type PairingCodeRefreshBody = {
  authToken?: string;
};

type ApnsRegisterBody = {
  authToken?: string;
  deviceToken?: string;
  platform?: string;
};

export async function handleAuthServerRoute(context: AuthServerRouteContext) {
  const {
    req,
    res,
    pathname,
    logApi,
    html,
    json,
    parseBody,
    readFormBody,
    normalizeReturnTo,
    buildLoginPage,
    redirect,
    clearAdminSessionCookie,
    createAdminSessionForPrincipal,
    isAdminPrincipal,
    requireAdminSession,
    normalizeApnsPlatform,
    interceptStore,
    pairingCodeRegistry,
    pairingCodeTtlMs,
    authTokenAllowPasswordGrant,
    buildOnboardingUrl,
    verifyAppleIdentityToken,
    appleClientId,
    appleIssuer,
    apnsStore,
    isLikelyDeviceToken,
    toInt,
  } = context;

  if (req.method === "POST" && pathname === "/auth/login") {
    const body = await readFormBody(req);
    const username = String(body.get("username") ?? "").trim();
    const password = String(body.get("password") ?? "").trim();
    const returnTo = normalizeReturnTo(body.get("returnTo") ?? "/");
    logApi(req, pathname, `admin login attempt username=${username || "-"}`);

    if (!username || !password) {
      html(res, 200, buildLoginPage({ returnTo, error: "请输入用户名和密码。" }));
      return true;
    }

    const principal = interceptStore.verifyAdminPassword(username, password);
    if (!principal?.userId || !isAdminPrincipal(principal)) {
      logApi(req, pathname, `admin login failed username=${username || "-"}`);
      html(res, 200, buildLoginPage({ returnTo, error: "用户名或密码错误。" }));
      return true;
    }

    const session = createAdminSessionForPrincipal(res, principal);
    logApi(req, pathname, `admin login ok userId=${principal.userId} session=${session.sessionToken.slice(0, 8)}...`);
    redirect(res, returnTo || "/");
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/logout") {
    clearAdminSessionCookie(res);
    const body = await readFormBody(req);
    const returnTo = normalizeReturnTo(body.get("returnTo") ?? "/auth/login");
    redirect(res, returnTo || "/auth/login");
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/token") {
    const body = await parseBody<AuthTokenBody>(req);
    const username = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "").trim();

    let admin = requireAdminSession(req, res);
    let grantType = "cookie";

    if (!admin) {
      if (!authTokenAllowPasswordGrant) {
        logApi(req, pathname, "unauthorized: admin session required");
        json(res, 401, { error: "unauthorized" });
        return true;
      }

      if (!username || !password) {
        logApi(req, pathname, "unauthorized: username/password required for password grant");
        json(res, 401, { error: "unauthorized" });
        return true;
      }

      const principal = interceptStore.verifyAdminPassword(username, password);
      if (!principal?.userId || !isAdminPrincipal(principal)) {
        logApi(req, pathname, `password grant failed username=${username || "-"}`);
        json(res, 401, { error: "unauthorized" });
        return true;
      }

      admin = principal;
      grantType = "password";
    }

    logApi(req, pathname, `issue token requested username=${username || "-"} admin=${admin.userId} grant=${grantType}`);
    if (!username) {
      logApi(req, pathname, "invalid request: username is required");
      json(res, 400, { error: "username is required" });
      return true;
    }

    const issued = interceptStore.withTransaction(() => interceptStore.createUserTokenRecord({ username }));
    const pairing = pairingCodeRegistry.issue({
      authToken: issued.authToken,
      userId: issued.userId,
      username: issued.username,
    });
    logApi(req, pathname, `issued userId=${issued.userId} pairingCode=${pairing.pairingCode}`);
    const payload = {
      ok: true,
      userId: issued.userId,
      authToken: issued.authToken,
      username: issued.username,
      pairingCode: pairing.pairingCode,
      pairingCodeExpiresAtMs: pairing.expiresAtMs,
      pairingCodeTtlMs,
      onboardingUrl: buildOnboardingUrl(req),
    };
    json(res, 200, {
      ...payload,
      token: payload.authToken,
      accessToken: payload.authToken,
      auth_token: payload.authToken,
      pairing_code: payload.pairingCode,
      pairingCodeExpiresAt: payload.pairingCodeExpiresAtMs,
      data: payload,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/apple/login") {
    if (!appleClientId) {
      logApi(req, pathname, "apple login disabled: APPLE_SIGNIN_CLIENT_ID missing");
      json(res, 503, { error: "apple sign-in is not configured" });
      return true;
    }

    const body = await parseBody<AppleLoginBody>(req);
    const identityToken = String(body?.identityToken ?? "").trim();
    const nonce = String(body?.nonce ?? "").trim();
    const deviceToken = String(body?.deviceToken ?? "").replace(/\s+/g, "").trim();
    const devicePlatform = normalizeApnsPlatform(body?.platform);

    if (!identityToken) {
      logApi(req, pathname, "invalid request: identityToken is required");
      json(res, 400, { error: "identityToken is required" });
      return true;
    }

    let verified;
    try {
      verified = await verifyAppleIdentityToken({
        identityToken,
        clientId: appleClientId,
        nonce,
        issuer: appleIssuer,
      });
    } catch (error) {
      const message = String(error?.message ?? error);
      logApi(req, pathname, `apple token verify failed: ${message}`);
      json(res, 401, { error: "invalid apple identity token", reason: message });
      return true;
    }

    const now = Date.now();
    const issued = interceptStore.withTransaction(() => {
      return interceptStore.createOrRefreshAppleUserTokenRecord({
        appleSub: verified.sub,
        email: verified.email,
        emailVerified: verified.emailVerified,
        isPrivateEmail: verified.isPrivateEmail,
        now,
      });
    });

    if (deviceToken) {
      try {
        apnsStore.bindDeviceToken(issued.userId, deviceToken, devicePlatform);
        logApi(req, pathname, `apple login device bound userId=${issued.userId} platform=${devicePlatform}`);
      } catch (error) {
        console.warn(
          `[cloud-server][auth] apple login device bind failed userId=${issued.userId} reason=${String(error?.message ?? error)}`,
        );
      }
    }

    const pairing = pairingCodeRegistry.issue({
      authToken: issued.authToken,
      userId: issued.userId,
      username: issued.username,
    });

    const payload = {
      ok: true,
      userId: issued.userId,
      username: issued.username,
      authType: "apple",
      authToken: issued.authToken,
      apple: {
        sub: verified.sub,
        email: verified.email,
        emailVerified: verified.emailVerified,
        isPrivateEmail: verified.isPrivateEmail,
      },
      pairingCode: pairing.pairingCode,
      pairingCodeExpiresAtMs: pairing.expiresAtMs,
      pairingCodeTtlMs,
      onboardingUrl: buildOnboardingUrl(req),
    };

    logApi(req, pathname, `apple login success payload=${JSON.stringify(payload)}`);
    json(res, 200, payload);
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/pairing-token") {
    const body = await parseBody<PairingCodeResolveBody>(req);
    const pairingCode = String(body?.pairingCode ?? "").trim();
    logApi(req, pathname, `resolve pairingCode=${pairingCode || "-"}`);
    if (!/^\d{4}$/.test(pairingCode)) {
      logApi(req, pathname, "invalid request: pairingCode must be 4 digits");
      json(res, 400, { error: "pairingCode must be 4 digits" });
      return true;
    }

    const record = pairingCodeRegistry.resolve(pairingCode);
    if (!record) {
      logApi(req, pathname, `pairingCode not found or expired code=${pairingCode}`);
      json(res, 404, { error: "pairingCode not found or expired" });
      return true;
    }

    logApi(req, pathname, `resolved pairingCode=${pairingCode} userId=${record.userId}`);

    json(res, 200, {
      ok: true,
      pairingCode: record.pairingCode,
      userId: record.userId,
      username: record.username,
      authToken: record.authToken,
      expiresAtMs: record.expiresAtMs,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/pairing-code/refresh") {
    const authorization = String(req.headers.authorization ?? "").trim();
    const tokenFromAuth = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice("bearer ".length).trim()
      : "";

    const body = await parseBody<PairingCodeRefreshBody>(req);
    const tokenFromBody = String(body?.authToken ?? "").trim();
    const authToken = tokenFromAuth || tokenFromBody;
    logApi(req, pathname, `refresh requested tokenSource=${tokenFromAuth ? "header" : tokenFromBody ? "body" : "none"}`);

    if (!authToken) {
      logApi(req, pathname, "unauthorized: missing token");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const principal = interceptStore.getUserByAuthToken(authToken);
    if (!principal?.userId) {
      logApi(req, pathname, "unauthorized: invalid token");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const pairing = pairingCodeRegistry.issue({
      authToken,
      userId: principal.userId,
      username: principal.username,
    });
    logApi(req, pathname, `refreshed pairingCode=${pairing.pairingCode} userId=${principal.userId}`);

    json(res, 200, {
      ok: true,
      pairingCode: pairing.pairingCode,
      pairingCodeExpiresAtMs: pairing.expiresAtMs,
      pairingCodeTtlMs,
      userId: principal.userId,
      username: principal.username,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/auth/me") {
    const authorization = String(req.headers.authorization ?? "").trim();
    const tokenFromAuth = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice("bearer ".length).trim()
      : "";

    if (!tokenFromAuth) {
      logApi(req, pathname, "unauthorized: missing token");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const principal = interceptStore.getUserByAuthToken(tokenFromAuth);
    if (!principal?.userId) {
      logApi(req, pathname, "unauthorized: invalid token");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    logApi(req, pathname, `resolved current user userId=${principal.userId}`);
    json(res, 200, {
      ok: true,
      userId: principal.userId,
      username: principal.username,
      authType: principal.authType || "user",
      appleSub: principal.appleSub || "",
      email: principal.email || "",
      emailVerified: principal.emailVerified === true,
      isPrivateEmail: principal.isPrivateEmail === true,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/auth/users") {
    const admin = requireAdminSession(req, res);
    if (!admin) {
      logApi(req, pathname, "unauthorized: admin session required");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = toInt(url.searchParams.get("limit"), 100);
    logApi(req, pathname, `list users limit=${limit} admin=${admin.userId}`);
    const users = interceptStore.listUsers(limit);
    const items = users.map((user) => {
      const deviceBindings = apnsStore.listDeviceBindingsByUserId(user.userId);
      const deviceTokens = deviceBindings.map((item) => item.deviceToken);
      return {
        ...user,
        deviceBindings,
        deviceTokens,
        deviceToken: deviceTokens[0] || "",
      };
    });
    logApi(req, pathname, `list users count=${items.length}`);
    json(res, 200, {
      ok: true,
      items,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/apns/register") {
    const body = await parseBody<ApnsRegisterBody>(req);
    const authToken = String(body?.authToken ?? "").trim();
    const deviceToken = String(body?.deviceToken ?? "").replace(/\s+/g, "").trim();
    const devicePlatform = normalizeApnsPlatform(body?.platform);

    if (!authToken) {
      logApi(req, pathname, "unauthorized: authToken is required");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    if (!deviceToken) {
      logApi(req, pathname, "invalid request: deviceToken is required");
      json(res, 400, { error: "deviceToken is required" });
      return true;
    }

    const principal = interceptStore.getUserByAuthToken(authToken);
    if (!principal?.userId) {
      logApi(req, pathname, "unauthorized: invalid authToken");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const bound = apnsStore.bindDeviceToken(principal.userId, deviceToken, devicePlatform);
    logApi(req, pathname, `registered apns device userId=${bound.userId} platform=${bound.platform}`);

    json(res, 200, {
      ok: true,
      userId: bound.userId,
      deviceToken: bound.deviceToken,
      platform: bound.platform,
      updatedAtMs: bound.updatedAtMs,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/auth/device-tokens") {
    const admin = requireAdminSession(req, res);
    if (!admin) {
      logApi(req, pathname, "unauthorized: admin session required");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = toInt(url.searchParams.get("limit"), 2000);
    logApi(req, pathname, `list device tokens limit=${limit} admin=${admin.userId}`);
    const items = apnsStore.listAllDeviceBindings(limit).map((item) => {
      const user = interceptStore.getUserById(item.userId);
      return {
        ...item,
        username: String(user?.username ?? "").trim(),
        authType: String(user?.authType ?? "").trim() || "user",
        tokenPreview: item.deviceToken.length > 16
          ? `${item.deviceToken.slice(0, 8)}...${item.deviceToken.slice(-8)}`
          : item.deviceToken,
      };
    });

    json(res, 200, { ok: true, items, limit });
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/device-tokens/mark-invalid") {
    const admin = requireAdminSession(req, res);
    if (!admin) {
      logApi(req, pathname, "unauthorized: admin session required");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const body = await parseBody<Record<string, unknown>>(req);
    const includeUnknownPlatform = String(body?.includeUnknownPlatform ?? "true").trim().toLowerCase() !== "false";
    const staleDays = toInt(body?.staleDays, 30);
    const staleUnknownThresholdMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    const items = apnsStore.listAllDeviceBindings(20000);

    const candidates = items.map((item) => {
      const reasons: string[] = [];
      if (!isLikelyDeviceToken(item.deviceToken)) {
        reasons.push("malformed-token");
      }
      if (includeUnknownPlatform && item.platform === "unknown") {
        reasons.push("unknown-platform");
      }
      if (item.platform === "unknown" && Number(item.updatedAtMs || 0) > 0 && item.updatedAtMs < staleUnknownThresholdMs) {
        reasons.push(`stale-unknown>${staleDays}d`);
      }

      const user = interceptStore.getUserById(item.userId);
      return {
        ...item,
        username: String(user?.username ?? "").trim(),
        authType: String(user?.authType ?? "").trim() || "user",
        reasons,
        markedInvalid: reasons.length > 0,
        tokenPreview: item.deviceToken.length > 16
          ? `${item.deviceToken.slice(0, 8)}...${item.deviceToken.slice(-8)}`
          : item.deviceToken,
      };
    });

    const invalidItems = candidates.filter((item) => item.markedInvalid);
    logApi(req, pathname, `mark invalid candidates=${invalidItems.length} total=${candidates.length} admin=${admin.userId}`);
    json(res, 200, {
      ok: true,
      items: candidates,
      invalidCount: invalidItems.length,
      total: candidates.length,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/device-tokens/delete") {
    const admin = requireAdminSession(req, res);
    if (!admin) {
      logApi(req, pathname, "unauthorized: admin session required");
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    const body = await parseBody<Record<string, unknown>>(req);
    const bindings = Array.isArray(body?.bindings) ? body.bindings : [];
    const normalizedBindings = bindings
      .map((item) => ({
        userId: String((item as Record<string, unknown>)?.userId ?? "").trim(),
        deviceToken: String((item as Record<string, unknown>)?.deviceToken ?? "").replace(/\s+/g, "").trim(),
      }))
      .filter((item) => item.userId && item.deviceToken);

    if (normalizedBindings.length === 0) {
      logApi(req, pathname, "invalid request: bindings is required");
      json(res, 400, { error: "bindings is required" });
      return true;
    }

    const removed = apnsStore.unbindDeviceTokens(normalizedBindings);
    logApi(req, pathname, `delete device tokens requested=${normalizedBindings.length} removed=${removed} admin=${admin.userId}`);
    json(res, 200, {
      ok: true,
      requested: normalizedBindings.length,
      removed,
    });
    return true;
  }

  return false;
}