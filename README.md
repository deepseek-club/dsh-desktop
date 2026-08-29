# dsh-desktop

> **DeepSeek Harness 的桌面启动器——无需 CMD，双击图标即可自动启动 Web 服务并打开浏览器。**
> 
**DSH Desktop 是 DeepSeek Harness 的桌面启动插件。双击图标，即可自动检查运行环境、启动 Web 服务并打开浏览器，像使用普通软件一样简单。**

**无需命令行 · 自动检测环境 · 自动启动服务 · 自动打开浏览器**

Windows 安装后，还会自动创建桌面快捷方式。

## 核心卖点

- **零心智负担**：不用记命令、不用敲路径，双击桌面图标自动搞定一切
- **开箱即体验**：装完插件，快捷方式自动出现在桌面（Windows 自动创建，含自定义图标）
- **跨平台可用**：Windows / macOS / Linux 一套插件方案——自动开浏览器全平台一致；桌面快捷方式当前为 Windows 专属（macOS/Linux 可手动添加，见下文）

## 前置要求（使用者需要）

- 已安装 DeepSeek Harness：`npm install -g @deepseek-ai/dsh`
- 已安装 **pnpm ≥ 9**（`dsh plugin` 命令依赖它；`corepack enable` 或 `npm install -g pnpm`）
- 使用 `github:` 方式安装需要 git 可用；国内网络访问 GitHub 可能需要加速（如 Watt Toolkit）
- 国内网络拉取 npm 依赖较慢时，可先配置镜像：`pnpm config set registry https://registry.npmmirror.com`

## 组成部分

| 部件 | 说明 |
|---|---|
| 本仓库（`package.json` + `cordis.patch.yml` + `lib/`） | **dsh 插件**：① 服务就绪后自动打开浏览器；② Windows 下自动把 `launcher.bat` + 吉祥物图标落盘到 `~/.dsh/launchers/` 并在**桌面创建/更新快捷方式**（后续每次启动自动同步图标，更新插件即更新图标） |
| `launcher.bat` | **独立启动脚本**：检查 node/dsh 环境 → 检查 3080 端口 → 未运行则新开服务窗口 → 就绪后打开浏览器（不依赖插件也能用） |

> 二者配合：bat 负责"检查 + 启动服务"，插件负责"自动开浏览器 + 桌面快捷方式"。

## 安装插件

### 方式一：本地路径（最快）

```sh
git clone https://github.com/DeepSeek-club/dsh-desktop.git
dsh plugin --profile web add ./dsh-desktop
```

### 方式二：GitHub 直装（无需克隆，需 pnpm ≥ 9 且 git 可用）

```sh
dsh plugin --profile web add 'github:DeepSeek-club/dsh-desktop'
```

### 方式三：npm（若已发布）

```sh
dsh plugin --profile web add @deepseek-club/dsh-desktop
```

装完**重启一次 `dsh web`**，之后每次启动服务，浏览器会自动打开 `http://127.0.0.1:3080`。

## 插件配置

在 `~/.dsh/profiles/web/cordis.patch.yml` 中按 id 覆盖：

```yaml
- id: dsh-desktop
  config:
    enabled: true          # 设为 false 关闭自动打开浏览器
    delayMs: 500           # 服务就绪后的等待毫秒数
    url: http://127.0.0.1:3080   # 自定义 URL（默认取实际监听端口）
    shortcut:
      enabled: true        # Windows 下自动创建/更新桌面快捷方式
      shortcutName: DSH Desktop   # 快捷方式名（不含 .lnk）
      icon: mascot        # 默认吉祥物 | 任意 .ico 绝对路径
      description: 一键启动 DeepSeek Harness Web 界面（默认吉祥物版）
```

快捷方式每次启动都会**重新落盘 bat + 图标并刷新 lnk**，因此更新插件版本后图标自动跟随更新。

## 卸载

```sh
dsh plugin --profile web remove @deepseek-club/dsh-desktop
```

> 卸载不会删除已生成的桌面快捷方式；如需移除请手动删除桌面的 `DSH Desktop.lnk` 和 `~/.dsh/launchers/` 目录。

## 工作原理

插件挂在 dsh 的 `webRuntime` 服务钩子上（该服务在 Web 服务器完成绑定后才提供），激活后：
1. 按平台调用系统命令打开浏览器（Windows `cmd /c start`、macOS `open`、Linux `xdg-open`），以 detached + unref 方式运行，不阻塞宿主进程；
2. Windows 下通过注册表解析真实桌面路径，用 PowerShell WScript.Shell 创建 `.lnk`（目标指向落盘到 `~/.dsh/launchers/launcher.bat`，图标为包内自带的 .ico）。

## 独立使用 bat（不装插件）

双击 `launcher.bat` 即可：自动检查 `node`/`dsh`（缺失时提示 `npm install -g @deepseek-ai/dsh`）→ 若 3080 已在监听则只开浏览器 → 否则新开服务器窗口并轮询就绪后打开浏览器。关闭 "DeepSeek Harness Server" 窗口即停止服务。

## macOS / Linux 手动添加快捷方式

插件在 macOS / Linux 只自动开浏览器，不创建桌面快捷方式（Windows 专属）。想同样"双击即用"，可手动创建：

- **macOS**：用 Automator 新建一个"应用程序"（运行 Shell 脚本 `dsh web`），拖到桌面即可；或把 `dsh web` 存为 `DSH Desktop.command` 双击运行
- **Linux（GNOME/KDE）**：在 `~/.local/share/applications/` 放一个 `.desktop` 文件，`Exec=dsh web`，`Icon` 可指向 `mascot.png`（仓库内图标为 ico，可用 ImageMagick 转 png）


## 图标版权
- 图标 `mascot.ico`（DeepSeek 风格吉祥物）：仓库维护者自有素材，无额外限制。
- 如需其他图标，可自行替换 `shortcut.icon` 指向你自己的 .ico。

## 许可

[MIT](LICENSE)（图标除外，见上节）
