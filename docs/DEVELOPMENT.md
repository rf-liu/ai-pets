# 开发与验证

这是整理后的独立 macOS 仓库。目录包含原生 Swift / SwiftUI 界面、共享 Node ESM 后台、资源和 DS 可选桥接；不包含上游 Windows PowerShell/WPF UI、软件更新器或任何用户数据。

## 构建

需要 Node.js 20+、macOS 13+ 与 Xcode 或兼容的 Command Line Tools。

```sh
bash script/build_unified.sh
bash script/verify_app.sh
```

`script/toolchain.sh` 优先保留显式 `GPT_NIANG_SDK`。在 CLT 环境中存在兼容的 26.5 SDK 时使用它，否则使用 `xcrun` 返回的 SDK。Full Xcode 使用它选中的 SDK。CLT 若无法加载新 SDK 的 SwiftUI 宏插件，可显式指定兼容 SDK 或使用 Full Xcode。

```sh
GPT_NIANG_SDK=/path/to/MacOSX.sdk bash script/build_unified.sh
```

主应用与登录助手均固定最低 macOS 13.0，并要求二者包含相同架构。`verify_app.sh` 核对最低系统版本、架构、签名及更新器排除，`package_release.sh` 构建后执行同一检查再生成 ZIP 与校验值。

应用版本来自根目录 `VERSION`；Node 后台单独保留协议版本 `1.3.6`，用于工作进程兼容交接，不等同于应用版本。

仅构建不会退出任何已运行的挂件。请从 Finder 手动打开产物；升级自己现有安装时，先退出旧挂件并备份应用和资料目录。应用 bundle 标识和可执行文件名保留兼容名称。

## 测试

```sh
cd gpt-niang-usage
npm test
cd ..
bash script/test_window_follow.sh
swift test --package-path macos
```

Node 测试使用本地临时目录、固定记录和 mock 服务，不需要真实模型消息。macOS 会跳过 Windows 命名管道检查。XCTest 需要可用的 Xcode 测试框架；CLT 缺少 XCTest 时，构建成功不能称为 XCTest 通过。

`.github/workflows/ci.yml` 在 GitHub 的 macOS runner 上运行 Node、窗口跟随、Swift 测试与 release 构建。首次发布时 Actions 的状态以 GitHub 实际结果为准。

## 交互约定

- 仅可见本体命中；气泡、透明角与空白区域透传。按下/拖动期间保持捕获到松开。
- 完成提醒显示的目标不可被后续完成事件替换，后来的事件排队。
- Codex 具体对话只用 header ID + SQLite ID + realpath 一致的绑定。不可从文件名猜 UUID，失败回到 App。
- 点击次数和偏好按每只 AI 独立持久化；更改次数重置序列。完成返回微笑的保持优先级高于普通点击。
- 不恢复 Claude Cookie 额度查询，不自动发送测速消息，不随源码提交快照、日志、凭据或聊天内容。

## 目录

`macos/Sources` 是界面与模型；`macos/Tests` 是原生测试；`gpt-niang-usage/runtime` 是本地数据与额度后台；`gpt-niang-usage/tests` 是 Node 测试；`gpt-niang-usage/assets` 是素材与许可；`integrations/dsh` 是可选桥接。

## 本机发布验证

见 [VALIDATION.md](VALIDATION.md)。CI、Intel、其他宿主版本与多显示器不因本机一次构建而视为验证通过。
