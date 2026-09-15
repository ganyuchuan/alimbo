# Limbo UI 基础组件

所有 HTML 页面共用 `limbo-ui.css` 和 `limbo-ui.js`，不依赖框架或 CDN。视觉为浅色终端：等宽字体、薄墨线、薄荷绿操作按钮、粉色危险操作与淡黄色提示。

## 接入页面

```html
<link rel="stylesheet" href="/limbo-ui.css" />
<script src="/limbo-ui.js" defer></script>
<body data-page="example">
  <main class="wrap">
    <header class="hero"><h1>页面标题</h1></header>
    <section class="lm-panel">页面内容</section>
  </main>
</body>
```

现有页面的内联样式位于 `@layer legacy`，保留布局和业务专属样式。未分层的共享 CSS 优先级更高，新组件应使用共享类，不要继续复制旧的控件定义或添加 `!important`。首页设备屏幕保留深色产品展示，不影响页面主题。

## 组件与变量

| 接口 | 用途 |
| --- | --- |
| `--lm-paper` / `--lm-surface` | 页面和控件背景 |
| `--lm-ink` / `--lm-muted` / `--lm-line` | 文本、辅助文字、边框 |
| `--lm-green` / `--lm-mint` / `--lm-pink` / `--lm-yellow` | 强调色与状态色 |
| `--lm-font` | 全站等宽字体 |
| `.wrap` / `.app` | 响应式内容容器 |
| `.lm-panel` | 无浮动卡片的分区 |
| `.lm-card` | 独立重复项目的卡片 |
| `.lm-row` / `.lm-stack` | 可换行横排 / 垂直间距 |
| `.lm-button` | 按钮或命令链接 |
| `.lm-button--primary` / `.lm-button--danger` | 主操作 / 危险操作修饰类 |
| `.lm-input` | 输入控件；原生 input、select、textarea 自动适配 |
| `.lm-badge` / `.lm-status` | 小标签 / 状态区域 |
| `.lm-table-scroll` | 表格横向滚动容器 |
| `<limbo-site-nav>` | 全站导航，由脚本自动插入 |
| `<limbo-page-directory>` | 完整页面入口网格，可按需放入其他页面 |

```html
<section class="lm-panel lm-stack">
  <label>名称 <input class="lm-input" name="name" required /></label>
  <div class="lm-row">
    <button class="lm-button lm-button--primary" type="submit">保存</button>
    <button class="lm-button lm-button--danger" type="button">删除</button>
    <span class="lm-badge">待处理</span>
  </div>
  <div class="lm-status" role="status">已保存</div>
</section>
```

## 页面导航

`limbo-ui.js` 中的 `pages` 是唯一页面目录。新增页面时添加 `id`、`label`、`path`、`code`、`access`，并将 HTML 的 `data-page` 设为对应 `id`。使用服务器规范路由，而不是受保护页面的 HTML 文件地址。

首页（`home`）和用户管理页（`users`）自动展示全部入口；每页都提供相同菜单、当前页标记以及接入文档、服务条款和隐私政策链接。菜单支持原生键盘操作和 Escape 关闭。

登录默认返回首页的行为未改动；从受保护入口登录仍返回目标页面。导航标签只是访问类型说明，不代替服务端鉴权；用量页面仍需要用户 Bearer Token。

## 验证与发布

运行 `npm run build` 将组件文件连同页面复制到 `dist/cloud/static`。现有服务缓存 HTML，部署新版本后需要重启云服务。

验证桌面和手机视口：8 个页面都有 8 个菜单入口，首页和用户管理页另有 8 个入口卡片；页面无横向溢出，宽表格只在自身容器内滚动。检查菜单键盘操作、登录表单、评分按钮、用量 Token 显隐和页面原有操作。# Limbo UI

所有静态 HTML 共用的「终端可爱风」基础组件库。无需构建、第三方 CDN 或运行时依赖；随 `npm run build` 一起复制到发布目录。

## 接入

在页面原有样式之后加载资源，并在 body 标记页面 ID：

```html
<link rel="stylesheet" href="/limbo-ui.css" />
<script src="/limbo-ui.js" defer></script>
<body data-page="usage">
  <main class="wrap">
    <header class="hero"><h1>用量统计</h1></header>
  </main>
</body>
```

现有页面的历史样式位于 `@layer legacy` 中，只保留页面布局与业务专属展示；共享 CSS 的未分层规则优先决定基础视觉。新增页面优先直接使用共享组件，不再复制旧页面的颜色与控件样式。

## 设计变量

| 变量 | 用途 |
| --- | --- |
| `--lm-paper` / `--lm-surface` | 页面与控件背景 |
| `--lm-ink` / `--lm-muted` | 主文字与次要文字 |
| `--lm-line` | 表格、分隔线与控件边框 |
| `--lm-green` / `--lm-mint` | 强调色、选中态与主要操作 |
| `--lm-pink` / `--lm-yellow` | 危险操作与辅助标记 |
| `--lm-red` | 错误与危险文字 |
| `--lm-font` | 本机等宽字体与中文回退字体 |

全局使用 6–8px 圆角、细边框和轻微硬阴影。页面分区使用分隔线，不嵌套卡片；统计项与入口等重复条目可以使用卡片。

## 组件

| 类名 / 元素 | 用途 |
| --- | --- |
| `.wrap`、`.hero` | 响应式页面容器与标题栏 |
| `.lm-panel`、`.lm-stack`、`.lm-row` | 分区、纵向排列、可换行工具栏 |
| `.lm-card` | 独立重复条目，内部间距由业务布局设置 |
| `.lm-button` | 按钮样式的命令链接；原生 button 自动应用 |
| `.lm-button--primary`、`.lm-button--danger` | 主要与危险操作 |
| `.lm-input` | 输入外观；原生 input/select/textarea 自动应用 |
| `.lm-badge`、`.lm-status` | 标签与状态信息 |
| `.lm-table-scroll` | 宽表格的局部横向滚动容器 |
| `<limbo-site-nav>` | 全站导航，脚本自动添加 |
| `<limbo-page-directory>` | 完整页面入口；首页和用户管理页自动添加 |

```html
<section class="lm-panel lm-stack">
  <h2>设备</h2>
  <div class="lm-row">
    <label>设备名称 <input name="deviceName" required /></label>
    <button class="lm-button--primary" type="submit">保存</button>
    <span class="lm-badge">已配对</span>
  </div>
  <p class="lm-status" role="status">已保存</p>
</section>
```

表单仍需提供 label，异步结果使用 `role="status"`，纯图标按钮提供可访问名称与 tooltip。共享层提供键盘焦点、禁用态、跳到正文和减少动画偏好支持。

## 页面与权限

页面清单在 `limbo-ui.js` 的 `pages` 中维护一次，导航与目录自动同步。新增页面时还需在服务端配置对应路由。

| 页面 ID | 正式路由 | 访问方式 |
| --- | --- | --- |
| `home` | `/` | 公开，也是默认登录返回页 |
| `login` | `/auth/login` | 账号登录 |
| `users` | `/auth/users-ui` | 管理员 |
| `devices` | `/auth/device-tokens-ui` | 管理员 |
| `approval` | `/intercepts/approve` | 管理员 |
| `usage` | `/usage` | 页面公开，数据需要用户 Token |
| `survey` | `/survey/watch-alpha` | 公开 |
| `survey-admin` | `/admin/surveys/watch-alpha` | 管理员 |

使用正式路由而不是 HTML 文件地址。前端的「管理员」标签只是说明，权限始终由服务端验证。登录仍沿用现有 `returnTo` 流程，不改变业务接口或凭据存储。

## 验证

- 执行 `node --check src/cloud/static/limbo-ui.js` 与 `npm run build`。
- 浏览器检查全部八个正式路由、菜单和目录入口。
- 在桌面与手机视口检查页面无横向溢出、图片加载、表格局部滚动及键盘焦点。
- 验证评分、重置、Token 显隐和原有页面弹窗；业务提交应连接测试环境，勿使用生产数据进行破坏性验证。