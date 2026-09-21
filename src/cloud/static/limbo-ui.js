(() => {
  const pages = Object.freeze([
    { id: "users", label: "用户管理", path: "/auth/users-ui", code: "~/users", access: "管理员", admin: true },
    { id: "devices", label: "设备 Token 管理", path: "/auth/device-tokens-ui", code: "~/devices", access: "管理员", admin: true },
    { id: "approval", label: "审批工作台", path: "/intercepts/approve", code: "~/approvals", access: "管理员", admin: true },
    { id: "usage", label: "用量统计", path: "/usage", code: "~/usage", access: "Token" },
    { id: "survey", label: "体验问卷", path: "/survey/watch-alpha", code: "~/survey", access: "公开" },
    { id: "survey-admin", label: "问卷结果", path: "/admin/surveys/watch-alpha", code: "~/results", access: "管理员", admin: true },
  ]);
  const currentPage = document.body.dataset.page;
  const currentAttribute = (page) => page.id === currentPage ? ' aria-current="page"' : "";
  const visiblePages = (session) => pages.filter((page) => page.id === "usage" || (page.admin && session.isAdmin));

  class LimboSiteNav extends HTMLElement {
    connectedCallback() {
      this.render({ authenticated: false, isAdmin: false });
      fetch("/auth/session", { credentials: "same-origin" })
        .then((response) => response.ok ? response.json() : null)
        .then((session) => {
          if (session && typeof session.authenticated === "boolean") this.render(session);
        })
        .catch(() => {});
    }

    render(session) {
      const menuItems = visiblePages(session).map((page) => `<a href="${page.path}"${currentAttribute(page)}><span>${page.label}</span><small>${page.access}</small></a>`).join("");
      const accountItem = session.authenticated
        ? `<details class="lm-menu">
                <summary>所有页面</summary>
                <div class="lm-menu-list">${menuItems}<form method="post" action="/auth/logout"><input type="hidden" name="returnTo" value="/"><button type="submit">登出</button></form></div>
              </details>`
        : `<a class="lm-login-link" href="/auth/login">登录</a>`;
      this.innerHTML = `
        <a class="lm-skip" href="#lm-content">跳到正文</a>
        <header class="lm-header">
          <div class="lm-header-inner">
            <a class="lm-brand" href="/"><img src="/logo_128.png" alt="" width="32" height="32"><span>Agent Limbo</span></a>
            <nav class="lm-global-nav" aria-label="全站导航">
              ${accountItem}
            </nav>
          </div>
        </header>`;
      const menu = this.querySelector("details");
      this.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menu.open) {
          menu.open = false;
          this.querySelector("summary").focus();
        }
      });
      this.addEventListener("focusout", (event) => {
        if (!this.contains(event.relatedTarget)) menu.open = false;
      });
    }
  }

  customElements.define("limbo-site-nav", LimboSiteNav);
  document.body.prepend(document.createElement("limbo-site-nav"));
  const content = document.querySelector(".wrap, .app, body > .card");
  if (content) {
    content.id ||= "lm-content";
    content.tabIndex = -1;
  }
  const footer = document.createElement("footer");
  footer.className = "lm-footer";
  footer.innerHTML = `<span>© 2026 yuchuan. All rights reserved.</span>
    <nav aria-label="相关资源"><a href="/SKILL.md">接入文档</a><a href="/terms-of-service?language=zh">服务条款</a><a href="/privacy-policy?language=zh">隐私政策</a><a href="/survey/watch-alpha">调查问卷</a></nav>`;
  document.body.append(footer);
})();