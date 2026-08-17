import fs from "node:fs";

const staticRoot = new URL("./static/", import.meta.url);
const interceptApprovalPagePath = new URL("./intercept-approval.html", staticRoot);
let interceptApprovalPageCache = "";
const authUsersPagePath = new URL("./auth-users.html", staticRoot);
let authUsersPageCache = "";
const deviceTokensPagePath = new URL("./device-tokens.html", staticRoot);
let deviceTokensPageCache = "";
const indexPagePath = new URL("./index.html", staticRoot);
let indexPageCache = "";
const watchAlphaSurveyPagePath = new URL("./watch-alpha-survey.html", staticRoot);
let watchAlphaSurveyPageCache = "";
const watchAlphaSurveyAdminPagePath = new URL("./watch-alpha-survey-admin.html", staticRoot);
let watchAlphaSurveyAdminPageCache = "";
const onboardingMarkdownPath = new URL("./SKILL.md", staticRoot);
let onboardingMarkdownCache = "";
const termsOfServiceZhPath = new URL("./terms-of-service.zh-CN.md", staticRoot);
let termsOfServiceZhCache = "";
const termsOfServiceEnPath = new URL("./terms-of-service.en.md", staticRoot);
let termsOfServiceEnCache = "";
const privacyPolicyZhPath = new URL("./privacy-policy.zh-CN.md", staticRoot);
let privacyPolicyZhCache = "";
const privacyPolicyEnPath = new URL("./privacy-policy.en.md", staticRoot);
let privacyPolicyEnCache = "";

const staticContentTypes = new Map([
	[".html", "text/html; charset=utf-8"],
	[".md", "text/markdown; charset=utf-8"],
	[".txt", "text/plain; charset=utf-8"],
	[".css", "text/css; charset=utf-8"],
	[".js", "application/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".svg", "image/svg+xml"],
	[".ico", "image/x-icon"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
	[".ttf", "font/ttf"],
]);

function html(res, status, body) {
	res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
	res.end(body);
}

function readStaticPage(path, fallback, label) {
	try {
		return fs.readFileSync(path, "utf8");
	} catch (error) {
		console.warn(`[cloud-server][web] failed to load ${label}: ${String(error?.message ?? error)}`);
		return fallback;
	}
}

function renderInterceptApprovalPage() {
	if (!interceptApprovalPageCache) {
		interceptApprovalPageCache = readStaticPage(
			interceptApprovalPagePath,
			"<!doctype html><html><body><h1>Approval page unavailable</h1></body></html>",
			"intercept approval page",
		);
	}
	return interceptApprovalPageCache;
}

function renderAuthUsersPage() {
	if (!authUsersPageCache) {
		authUsersPageCache = readStaticPage(
			authUsersPagePath,
			"<!doctype html><html><body><h1>Users page unavailable</h1></body></html>",
			"auth users page",
		);
	}
	return authUsersPageCache;
}

function renderDeviceTokensPage() {
	if (!deviceTokensPageCache) {
		deviceTokensPageCache = readStaticPage(
			deviceTokensPagePath,
			"<!doctype html><html><body><h1>Device Tokens page unavailable</h1></body></html>",
			"device tokens page",
		);
	}
	return deviceTokensPageCache;
}

function renderIndexPage() {
	if (!indexPageCache) {
		indexPageCache = readStaticPage(
			indexPagePath,
			"<!doctype html><html><body><h1>Index page unavailable</h1></body></html>",
			"index page",
		);
	}
	return indexPageCache;
}

function renderWatchAlphaSurveyPage() {
	if (!watchAlphaSurveyPageCache) {
		watchAlphaSurveyPageCache = readStaticPage(
			watchAlphaSurveyPagePath,
			"<!doctype html><html><body><h1>Survey page unavailable</h1></body></html>",
			"watch alpha survey page",
		);
	}
	return watchAlphaSurveyPageCache;
}

function renderWatchAlphaSurveyAdminPage() {
	if (!watchAlphaSurveyAdminPageCache) {
		watchAlphaSurveyAdminPageCache = readStaticPage(
			watchAlphaSurveyAdminPagePath,
			"<!doctype html><html><body><h1>Survey admin page unavailable</h1></body></html>",
			"watch alpha survey admin page",
		);
	}
	return watchAlphaSurveyAdminPageCache;
}

function renderOnboardingMarkdown() {
	if (!onboardingMarkdownCache) {
		onboardingMarkdownCache = readStaticPage(onboardingMarkdownPath, "# Onboarding\n\nUnavailable.", "SKILL.md");
	}
	return onboardingMarkdownCache;
}

function renderTermsOfServiceZh() {
	if (!termsOfServiceZhCache) {
		termsOfServiceZhCache = readStaticPage(termsOfServiceZhPath, "# Terms of Service\n\nUnavailable.", "terms-of-service.zh-CN.md");
	}
	return termsOfServiceZhCache;
}

function renderTermsOfServiceEn() {
	if (!termsOfServiceEnCache) {
		termsOfServiceEnCache = readStaticPage(termsOfServiceEnPath, "# Terms of Service\n\nUnavailable.", "terms-of-service.en.md");
	}
	return termsOfServiceEnCache;
}

function renderPrivacyPolicyZh() {
	if (!privacyPolicyZhCache) {
		privacyPolicyZhCache = readStaticPage(privacyPolicyZhPath, "# Privacy Policy\n\nUnavailable.", "privacy-policy.zh-CN.md");
	}
	return privacyPolicyZhCache;
}

function renderPrivacyPolicyEn() {
	if (!privacyPolicyEnCache) {
		privacyPolicyEnCache = readStaticPage(privacyPolicyEnPath, "# Privacy Policy\n\nUnavailable.", "privacy-policy.en.md");
	}
	return privacyPolicyEnCache;
}

function extname(pathname) {
	const index = pathname.lastIndexOf(".");
	if (index < 0) {
		return "";
	}
	return pathname.slice(index).toLowerCase();
}

function serveStaticAsset(req, res, pathname, logApi) {
	if (req.method !== "GET") {
		return false;
	}

	if (!pathname.startsWith("/") || pathname.includes("..")) {
		return false;
	}

	const extension = extname(pathname);
	const contentType = staticContentTypes.get(extension);
	if (!contentType) {
		return false;
	}

	try {
		const relativePath = pathname.slice(1);
		const assetPath = new URL(relativePath, staticRoot);
		const content = fs.readFileSync(assetPath);
		logApi(req, pathname, `serve static asset (${extension})`);
		res.writeHead(200, { "Content-Type": contentType });
		res.end(content);
		return true;
	} catch {
		return false;
	}
}

type WebServerRouteContext = {
	req: any;
	res: any;
	url: URL;
	pathname: string;
	logApi: (req: any, pathname: string, message: string) => void;
	normalizeReturnTo: (value: unknown) => string;
	buildLoginPage: (params?: { returnTo?: string; error?: string }) => string;
	requireAdminSession: (req: any, res: any) => { userId?: string } | null;
	redirectToLogin: (res: any, returnTo: string) => void;
};

export function handleWebServerRoute(context: WebServerRouteContext) {
	const {
		req,
		res,
		url,
		pathname,
		logApi,
		normalizeReturnTo,
		buildLoginPage,
		requireAdminSession,
		redirectToLogin,
	} = context;

	if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
		logApi(req, pathname, "serve index page");
		html(res, 200, renderIndexPage());
		return true;
	}

	if (serveStaticAsset(req, res, pathname, logApi)) {
		return true;
	}

	if (req.method === "GET" && pathname === "/SKILL.md") {
		logApi(req, pathname, "serve onboarding markdown");
		res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
		res.end(renderOnboardingMarkdown());
		return true;
	}

	if (req.method === "GET") {
		if (pathname === "/terms-of-service") {
			const isChinese = url.searchParams.get("language") === "zh";
			logApi(req, pathname, `serve terms of service ${isChinese ? "zh-cn" : "en"}`);
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
			res.end(isChinese ? renderTermsOfServiceZh() : renderTermsOfServiceEn());
			return true;
		}

		if (pathname === "/terms-of-service.zh-CN") {
			logApi(req, pathname, "serve terms of service zh-cn");
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
			res.end(renderTermsOfServiceZh());
			return true;
		}

		if (pathname === "/terms-of-service.en") {
			logApi(req, pathname, "serve terms of service en");
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
			res.end(renderTermsOfServiceEn());
			return true;
		}

		if (pathname === "/privacy-policy") {
			const isChinese = url.searchParams.get("language") === "zh";
			logApi(req, pathname, `serve privacy policy ${isChinese ? "zh-cn" : "en"}`);
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
			res.end(isChinese ? renderPrivacyPolicyZh() : renderPrivacyPolicyEn());
			return true;
		}

		if (pathname === "/privacy-policy.zh-CN") {
			logApi(req, pathname, "serve privacy policy zh-cn");
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
			res.end(renderPrivacyPolicyZh());
			return true;
		}

		if (pathname === "/privacy-policy.en") {
			logApi(req, pathname, "serve privacy policy en");
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
			res.end(renderPrivacyPolicyEn());
			return true;
		}
	}

	if (req.method === "GET" && pathname === "/auth/login") {
		const returnTo = normalizeReturnTo(url.searchParams.get("returnTo") ?? "/");
		logApi(req, pathname, `serve login page returnTo=${returnTo}`);
		html(res, 200, buildLoginPage({ returnTo }));
		return true;
	}

	const protectedPages = new Map([
		["/intercepts/approve", renderInterceptApprovalPage],
		["/auth/users-ui", renderAuthUsersPage],
		["/auth/device-tokens-ui", renderDeviceTokensPage],
		["/admin/surveys/watch-alpha", renderWatchAlphaSurveyAdminPage],
	]);
	const protectedPage = protectedPages.get(pathname);
	if (req.method === "GET" && protectedPage) {
		const admin = requireAdminSession(req, res);
		if (!admin) {
			logApi(req, pathname, "redirect to login");
			redirectToLogin(res, req.url || pathname);
			return true;
		}

		logApi(req, pathname, `serve web page admin=${admin.userId}`);
		html(res, 200, protectedPage());
		return true;
	}

	if (req.method === "GET" && (pathname === "/survey/watch-alpha" || pathname === "/survey/watch-alpha.html")) {
		logApi(req, pathname, "serve watch alpha survey page");
		html(res, 200, renderWatchAlphaSurveyPage());
		return true;
	}

	return false;
}
