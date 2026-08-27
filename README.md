# dsh-web-launcher

一键启动 DeepSeek Harness Web GUI —— **dsh 插件版**（自动开浏览器 + Windows 自动创建鲸鱼娘桌面快捷方式）＋ **bat 启动脚本**（检查环境 + 启动服务）。

让 DeepSeek Harness 的 Web 界面使用体验变成：**双击 → 服务启动 → 浏览器自动打开**。**装完插件，鲸鱼娘快捷方式自动出现在桌面，零手动步骤。**

## 前置要求（使用者需要）

- 已安装 DeepSeek Harness：`npm install -g @deepseek-ai/dsh`
- 已安装 **pnpm ≥ 9**（`dsh plugin` 命令依赖它；`corepack enable` 或 `npm install -g pnpm`）
- 使用 `github:` 方式安装需要 git 可用；国内网络访问 GitHub 可能需要加速（如 Watt Toolkit）
- 国内网络拉取 npm 依赖较慢时，可先配置镜像：`pnpm config set registry https://registry.npmmirror.com`

## 组成部分

| 部件 | 说明 |
|---|---|
| 本仓库（`package.json` + `cordis.patch.yml` + `lib/`） | **dsh 插件**：① 服务就绪后自动打开浏览器；② Windows 下自动把 `launcher.bat` + 鲸鱼娘图标落盘到 `~/.dsh/launchers/` 并在**桌面创建/更新快捷方式**（后续每次启动自动同步图标，更新插件即更新图标） |
| `launcher.bat` | **独立启动脚本**：检查 node/dsh 环境 → 检查 3080 端口 → 未运行则新开服务窗口 → 就绪后打开浏览器（不依赖插件也能用） |

> 二者配合：bat 负责"检查 + 启动服务"，插件负责"自动开浏览器 + 桌面快捷方式"。

## 安装插件

### 方式一：本地路径（最快）

```sh
git clone https://github.com/2996966723/dsh-web-launcher.git
dsh plugin --profile web add ./dsh-web-launcher
```

### 方式二：GitHub 直装（无需克隆，需 pnpm ≥ 9 且 git 可用）

```sh
dsh plugin --profile web add 'github:2996966723/dsh-web-launcher'
```

### 方式三：npm（若已发布）

```sh
dsh plugin --profile web add @dsh-external/dsh-web-launcher
```

装完**重启一次 `dsh web`**，之后每次启动服务，浏览器会自动打开 `http://127.0.0.1:3080`。

## 插件配置

在 `~/.dsh/profiles/web/cordis.patch.yml` 中按 id 覆盖：

```yaml
- id: web-launcher
  config:
    enabled: true          # 设为 false 关闭自动打开浏览器
    delayMs: 500           # 服务就绪后的等待毫秒数
    url: http://127.0.0.1:3080   # 自定义 URL（默认取实际监听端口）
    shortcut:
      enabled: true        # Windows 下自动创建/更新桌面快捷方式
      shortcutName: 启动 DeepSeekHarness   # 快捷方式名（不含 .lnk）
      icon: whale-black    # 默认黑鲸鱼 | whale-maid（女仆）| whale-shield（盾徽）| 任意 .ico 绝对路径
      description: 一键启动 DeepSeek Harness Web 界面（鲸鱼娘版）
```

快捷方式每次启动都会**重新落盘 bat + 图标并刷新 lnk**，因此更新插件版本后图标自动跟随更新。

## 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-web-launcher
```

> 卸载不会删除已生成的桌面快捷方式；如需移除请手动删除桌面的 `启动 DeepSeekHarness.lnk` 和 `~/.dsh/launchers/` 目录。

## 工作原理

插件挂在 dsh 的 `webRuntime` 服务钩子上（该服务在 Web 服务器完成绑定后才提供），激活后：
1. 按平台调用系统命令打开浏览器（Windows `cmd /c start`、macOS `open`、Linux `xdg-open`），以 detached + unref 方式运行，不阻塞宿主进程；
2. Windows 下通过注册表解析真实桌面路径，用 PowerShell WScript.Shell 创建 `.lnk`（目标指向落盘到 `~/.dsh/launchers/launcher.bat`，图标为包内自带的 .ico）。

## 独立使用 bat（不装插件）

双击 `launcher.bat` 即可：自动检查 `node`/`dsh`（缺失时提示 `npm install -g @deepseek-ai/dsh`）→ 若 3080 已在监听则只开浏览器 → 否则新开服务器窗口并轮询就绪后打开浏览器。关闭 "DeepSeek Harness Server" 窗口即停止服务。

## 图标版权

- 默认图标 `whale-black.ico`（黑鲸鱼）：仓库维护者自有素材，无额外限制。
- 备选图标 `whale-maid.ico` / `whale-shield.ico` 为**衍生美术作品**，来自 [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) 皮肤（`maid-atelier`），许可为 **CC BY-NC-SA 4.0（署名-非商业性使用-相同方式共享）**，**禁止商业使用**。署名链：一创 上善（Pixiv 62155430）→ 二创 ZipZipPipe（Pixiv 18604994）→ 三创 Small-tailqwq。
- 代码部分：MIT
- 如不希望图标带非商用限制，可自行替换 `shortcut.icon` 指向你自己的 .ico。

## 许可

[MIT](LICENSE)（图标除外，见上节）
