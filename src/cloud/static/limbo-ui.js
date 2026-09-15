(() => {
  const pages = Object.freeze([
    { id: "home", label: "首页", path: "/", code: "~/home", access: "公开" },
    { id: "login", label: "登录", path: "/auth/login", code: "~/login", access: "账号" },
    { id: "users", label: "用户管理", path: "/auth/users-ui", code: "~/users", access: "管理员" },
    { id: "devices", label: "设备 Token", path: "/auth/device-tokens-ui", code: "~/devices", access: "管理员" },
    { id: "approval", label: "审批工作台", path: "/intercepts/approve", code: "~/approvals", access: "管理员" },
    { id: "usage", label: "用量统计", path: "/usage", code: "~/usage", access: "Token" },
    { id: "survey", label: "体验问卷", path: "/survey/watch-alpha", code: "~/survey", access: "公开" },
    { id: "survey-admin", label: "问卷结果", path: "/admin/surveys/watch-alpha", code: "~/results", access: "管理员" },
  ]);
  const currentPage = document.body.dataset.page;
  const currentAttribute = (page) => page.id === currentPage ? ' aria-current="page"' : "";

  class LimboSiteNav extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <a class="lm-skip" href="#lm-content">跳到正文</a>
        <header class="lm-header">
          <div class="lm-header-inner">
            <a class="lm-brand" href="/"><img src="/logo_128.png" alt="" width="32" height="32"><span>Agent Limbo</span></a>
            <nav class="lm-global-nav" aria-label="全站导航">
              <a href="/">首页</a><a href="/auth/users-ui">控制台</a>
              <details class="lm-menu">
                <summary>所有页面</summary>
                <div class="lm-menu-list">${pages.map((page) => `<a href="${page.path}"${currentAttribute(page)}><span>${page.label}</span><small>${page.access}</small></a>`).join("")}</div>
              </details>
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

  class LimboPageDirectory extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `<section class="lm-directory" aria-label="页面入口">
        <div class="lm-directory-title"><h2>页面入口</h2><span>~/workspace</span></div>
        <nav class="lm-directory-grid" aria-label="所有页面入口">${pages.map((page) => `
          <a class="lm-page-link" href="${page.path}"${currentAttribute(page)}>
            <span class="lm-page-code">${page.code}</span><strong>${page.label}</strong><small>${page.access}</small>
          </a>`).join("")}</nav>
      </section>`;
    }
  }

  customElements.define("limbo-site-nav", LimboSiteNav);
  customElements.define("limbo-page-directory", LimboPageDirectory);
  document.body.prepend(document.createElement("limbo-site-nav"));
  const content = document.querySelector(".wrap, .app, body > .card");
  if (content) {
    content.id ||= "lm-content";
    content.tabIndex = -1;
    if (currentPage === "home" || currentPage === "users") {
      const directory = document.createElement("limbo-page-directory");
      const heading = content.querySelector(".page-header, .hero");
      if (heading) heading.after(directory);
      else content.prepend(directory);
    }
  }
  const footer = document.createElement("footer");
  footer.className = "lm-footer";
  footer.innerHTML = `<span>Agent Limbo / ${pages.find((page) => page.id === currentPage)?.label || "workspace"}</span>
    <nav aria-label="相关资源"><a href="/SKILL.md">接入文档</a><a href="/terms-of-service?language=zh">服务条款</a><a href="/privacy-policy?language=zh">隐私政策</a></nav>`;
  document.body.append(footer);
})();