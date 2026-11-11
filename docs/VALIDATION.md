# 0.1.0 本机验证

2026-11-12，在 Apple Silicon / macOS 本机完成：

- 共享后台 Node 测试：184 项通过，5 项平台相关检查跳过，0 失败；不调用真实模型。
- 实际 Swift 模型与本地临时图片的独立断言适配器：321 个断言通过，包括八个表情测试方法、阈值 1/3/5/10、持久化、修改后重新计数、旧皮肤隔离、返回笑脸保持及简繁体文案。
- 隔离原生设置窗口：繁体随机次数界面显示正常，点击恢复后变为第三次且恢复按钮禁用。
- 窗口跟随策略：62 项独立回归检查通过。
- release 原生应用构建成功，深度严格代码签名校验通过。

本机 Command Line Tools 缺少 XCTest 框架，因此上述 321 个断言通过独立适配器执行相同方法体，不是 `swift test` / XCTest 运行结果。仓库包含原 XCTest 测试，GitHub Actions 使用其 runner 的 Xcode 运行；CI 成败以实际运行结果为准。

Intel、多显示器、所有宿主版本并未因以上检查而实机验证。统计功能不会主动向模型发送测速消息，Claude 桌面额度继续停用。

## GitHub Actions

[最终 CI 43065485707](https://github.com/rf-liu/ai-pets/actions/runs/43065485707) 已通过，源码提交 `8665b1cbf8d00986f118441d6ccfa6e4f3980982`：184 项 Node 测试通过，105 项 XCTest 测试通过，窗口跟随策略、release 构建以及签名/最低系统/架构检查全部成功。这里的 XCTest 是 GitHub runner 的 Xcode 执行结果，与上面的本机 CLT 独立断言明确区分。
