[![GitHub Release](https://img.shields.io/github/v/release/m8524769/mermaid-code?style=flat-square)](https://github.com/m8524769/mermaid-code/releases)

# Mermaid Code

一款基于 [Mermaid Live Editor](https://github.com/mermaid-js/mermaid-live-editor) 的本地 Mermaid 图表编辑器，并借助 [Tauri](https://tauri.app) 赋予跨平台原生桌面应用体验。

![Mermaid Code showcase](showcase.png)

## 为「以 AI 为中心」的工作流而打造

Mermaid Code 可与本地 AI Agent（如 Claude Code、Codex 等）无缝协作：图表以纯文本 .mmd 文件的形式存于本地，AI Agent 可直接读取您的代码库，生成并写入图表文件 —— 无需任何复制粘贴，也无需繁琐的浏览器导入导出流程。

```
# 示例：让 AI Agent 根据代码生成图表
“请为该模块生成一张架构图，并保存到 docs/architecture.mmd”
```

Mermaid Code 启动后会实时检测文件内容变更并自动刷新图表，从而打通 AI 生成与视觉反馈之间的闭环，而这是纯网页编辑器中无法实现的。

所有数据均存于本地 —— 架构图、数据库 schemas、业务流程图等，无需担心任何服务条款或数据保留政策。

请从 [Releases](https://github.com/m8524769/mermaid-code/releases) 页面下载适用于 macOS 或 Windows 的最新安装包。

### 通过 Homebrew 安装（macOS）

```sh
brew tap m8524769/tap
brew install --cask mermaid-code
```

> 由于该应用未经 Apple Developer 证书签名，macOS 可能在首次启动时加以阻止。
> 请前往 **系统设置 → 隐私与安全性**，然后点击 Mermaid Code 旁的 **Open Anyway**。
> 若该方法无效（例如在 macOS 27 Beta 上），请在终端中执行以下命令：
>
> ```sh
> xattr -dr com.apple.quarantine "/Applications/Mermaid Code.app"
> ```

## 基于 Mermaid Live Editor 的增强

### 跨平台桌面应用

- 原生 macOS / Windows 桌面应用体验
- 本地文件系统访问 —— 可直接打开、编辑和保存 `.mmd` 文件
- 支持“打开方式” —— 在访达或资源管理器中双击任意 `.mmd` 或 `.mermaid` 文件，即可在 Mermaid Code 中打开
- 退出保护 —— 关闭应用时若有未保存的更改，会弹出相应提示

### 文件管理器

- 可打开任意本地文件夹，并以文件树或缩略图网格视图浏览其内容（展示当前文件夹及子目录下所有图表的 SVG 预览）
- 支持将 `.mmd` 文件或文件夹直接拖拽到应用窗口以打开
- 多标签编辑 —— 同时打开多个图表并快速切换
- 当前文件夹和标签页将在下次启动时自动恢复
- 自动保存（默认开启，每间隔 2 秒）
- 文件操作：新建文件/文件夹、重命名、删除

### Code 编辑器

- Vim 模式 —— 可通过状态栏中的 VIM ON/OFF 切换
- 关键字自动补全 —— 根据图表类型提供智能建议

### Config 面板

- 可视化配置 —— 通过表单设置主题、布局和字体，无需编辑 JSON
- Pin to code —— 将当前配置以 YAML 的形式插入到图表代码中以固定样式
---

## 开发环境要求

- [Node.js](https://nodejs.org/en/) ≥ 24
- [pnpm](https://pnpm.io/) —— 通过 `corepack enable pnpm` 安装
- [Rust](https://rustup.rs/) —— 用于构建 Tauri 桌面应用

### 启动 dev 环境

```sh
source ~/.cargo/env   # 若需加载 Rust 工具链
pnpm tauri:dev
```

### 本地构建

```sh
pnpm tauri:build
```

---

## 故障排除

### 应用卡顿或崩溃

如果应用出现无响应或崩溃，可能是由于某张图表或配置导致 Mermaid 在渲染时挂起。

**解决办法：** 将疑似有问题的 `.mmd` 文件移出当前打开的目录，然后重新启动应用。待应用恢复响应后，再将文件移回，逐一排查导致问题的图表或配置。

---

## 原始项目

本仓库 fork 自 [mermaid-live-editor](https://github.com/mermaid-js/mermaid-live-editor)，纯网页版本请访问：[mermaid.live](https://mermaid.live)
