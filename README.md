# AI 桌宠

[![构建与测试](https://github.com/rf-liu/ai-pets/actions/workflows/ci.yml/badge.svg)](https://github.com/rf-liu/ai-pets/actions/workflows/ci.yml)

让四只小伙伴陪着你写代码、看额度、等回复。一个原生 macOS 应用，分别跟随 Codex、Antigravity、Claude 和 DeepSeek Harness。

<p>
  <img src="gpt-niang-usage/assets/gpt-dragon-niang-bust.png" width="145" alt="GPT 龙娘">
  <img src="gpt-niang-usage/assets/gemini-catgirl-hd.webp" width="145" alt="Gemini 猫娘">
  <img src="gpt-niang-usage/assets/claude-bust.png" width="145" alt="Claude 小克">
  <img src="gpt-niang-usage/assets/ds-restored/main.png" width="145" alt="DS 小鲸鱼">
</p>

[下载安装](https://github.com/rf-liu/ai-pets/releases/latest) · [使用说明](docs/USAGE.md) · [素材来源](docs/ATTRIBUTION.md) · [开发与验证](docs/DEVELOPMENT.md)

## 四只宠物，各陪各的窗口

- **GPT 龙娘 / Codex**：查看当前登录账号的额度；从本地对话记录统计速度，回复完成后提醒。
- **Gemini 猫娘 / Antigravity**：读取本机语言服务的额度和生成统计；可选高清猫娘或原版外观。
- **Claude 小克 / Claude 桌面版**：点击直接显示语录。**不查询 Claude 额度，不读取桌面登录 Cookie**。Code 对话的本地 TPS 与完成提醒保留；普通 Chat / Cowork 的本地计数暂不支持。
- **DS 小鲸鱼 / DeepSeek Harness**：通过可选的宿主桥接显示余额、今日已观测消耗和每轮费用估算；保留摸头、眨眼与表情切换。

每只宠物分别跟随自己的宿主窗口，多个程序同时打开时可以共存。也可以切换为桌面自由拖动。

## 点一下，再点一下

普通点击本体先看额度，再点变成语录，继续点换一句；Claude 直接显示语录。点击有声音和弹跳反馈。

默认连续点到**第三次**开始随机换表情。设置中可以选择**第 1～10 次**，每只宠物独立保存，也能一键恢复第三次。相邻点击间隔不超过一秒算连续点击；停点约 1.5 秒后恢复。DS 仍可按住摸头。

回复完成时用开心表情提醒。点击本体返回对应窗口；Codex 优先打开经过校验的对话，无法定位时只打开宿主 App。返回后的微笑保留约 1.5 秒。气泡和图片透明区域都可以穿透点击。

右键本体可打开设置或聊天速度。速度窗口有四个 AI 标签，显示真实对话名与分模型最近平均速度。

## 安装

需要 **macOS 13+、Node.js 20+**，以及你要跟随的宿主 App。当前提供的安装包在 Apple Silicon 上构建和验证；Intel 尚未实机验证。

1. 安装 Node.js，例如 `brew install node`。
2. 从 [Releases](https://github.com/rf-liu/ai-pets/releases/latest) 下载 `ai-pets-v0.2.2-macos-arm64.zip`，核对同页 `SHA256SUMS.txt`。
3. 解压，将 `GPTNiangMac.app` 放入「应用程序」，**从 Finder 手动打开一次**。这是 AI 桌宠的兼容应用名称。
4. 打开 Codex / Antigravity / Claude，宠物会跟随相应窗口。DeepSeek 余额需要另外配置[桥接](integrations/README.md)。

应用使用本地临时签名，尚未进行 Apple 公证。如 macOS 阻止首次打开，请通过系统设置「隐私与安全性」查看并允许；无需关闭 Gatekeeper。系统登录时自动启动可在设置中选择。

已有本机统一版可退出后原位替换，继续使用原来的设置、语录、声音和位置。软件没有自动检查更新或自动安装后台；后续手动下载 Release 替换。

## 数据与速度的含义

- 只读取本机已有记录，不自动发送聊天或测速请求。
- GPT / Claude Code / DS 统计整轮完成耗时，包括思考、工具与等待；Gemini 按生成 TPS 展示，采用宿主的首 token 等待与生成时长，包含思考及中间调用的模型输出，不计工具或程序执行等待。**它们不是模型瞬时解码速度，不同宿主口径不能直接排名**。
- 顶部按模型和思考档汇总最近 3 天的已读取有效样本，以总输出 tokens ÷ 总耗时计算；下方卡片保留最近一轮自己的 tokens、耗时与 TPS。缺失、过期或无时间戳的数据不按零或旧值补入。历史被截断时会提示，范围限当前列表中的可读记录。
- DS 今日消耗只覆盖已连接并观测到的余额变化；充值与赠金不会抵消已观测消耗。每轮金额是估算，未知模型或价格规则不显示为零。
- 设置、语录和运行快照保存在 `~/Library/Application Support/AIQuotaCompanion/`，按四个 AI 分开。不会上传到 GitHub；程序没有遥测上传。

宿主的本地数据库、日志与未公开接口可能随版本变化，支持范围和恢复方法见[使用说明](docs/USAGE.md)。

## 从源码构建

```sh
git clone https://github.com/rf-liu/ai-pets.git
cd ai-pets
bash script/build_unified.sh
```

需要 Xcode 或兼容的 Command Line Tools。构建产物位于 `dist/GPTNiangMac.app`。脚本自动选择可用 SDK，也支持 `GPT_NIANG_SDK` 指定路径，详见[开发说明](docs/DEVELOPMENT.md)。

## 来源与许可

原生挂件与额度后台基于 [T7moris/GPT-Niang](https://github.com/T7moris/GPT-Niang) 继续开发；Gemini 接入参考 [gemini-quota-widget](https://github.com/smiththomson580-star/gemini-quota-widget)；DS 记账与形象参考 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。Claude 原始形象来自 [xiaoke-quota](https://github.com/liangcka/xiaoke-quota)，新半身参考 [Claude-Niang](https://github.com/Gryphus-Triune/Claude-Niang)。

主体代码按 [MIT](LICENSE) 分发并保留上游署名。**角色图、衍生表情、音效和部分第三方材料不适用代码 MIT 许可**，沿用各自声明，见[逐项来源及许可](docs/ATTRIBUTION.md)。这是独立社区作品，与模型厂商无隶属关系。
