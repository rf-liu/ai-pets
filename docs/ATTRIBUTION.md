# 来源与许可

项目名称：AI 桌宠（ai-pets）。版本：0.2.2。

## 程序与接入参考

- **GPT-Niang**：[T7moris/GPT-Niang](https://github.com/T7moris/GPT-Niang)。原生 macOS 挂件、窗口跟随、音频与 Codex 额度后台的基础。保留根目录 [MIT LICENSE](../LICENSE) 中的原有署名。
- **Gemini quota widget**：[smiththomson580-star/gemini-quota-widget](https://github.com/smiththomson580-star/gemini-quota-widget)。本机 Antigravity 接入方式与高清猫娘来源。本项目使用统一的原生 UI。
- **DeepSeek Balance Whale Widget**：[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。`runtime/deepseek-accounting.mjs` 复用其 MIT 记账纯函数，[完整许可](../gpt-niang-usage/assets/DEEPSEEK-CODE-LICENSE.txt)。
- **xiaoke-quota**：[liangcka/xiaoke-quota](https://github.com/liangcka/xiaoke-quota)。Claude 早期立绘及设计参考；保留其 [PolyForm Noncommercial 说明](../gpt-niang-usage/assets/CLAUDE-CODE-LICENSE.txt)，该文本不是本项目主体代码的 MIT 许可。
- **Claude-Niang**：[Gryphus-Triune/Claude-Niang](https://github.com/Gryphus-Triune/Claude-Niang)。新 Claude 半身造型参考。未启用其桌面账号额度查询逻辑。

## 图片与声音

代码许可不会授予角色、商标或美术素材的额外权利。以下文件不按 MIT 美术素材包发布；使用和分发请保留对应的上游声明，尤其是非商业和相同方式共享要求。

- GPT 基础龙娘与派生图：见 [CHARACTER-NOTICE](../gpt-niang-usage/assets/CHARACTER-NOTICE.txt)。基础图由上游根据角色参考生成；本项目的完成笑脸与点击表情为 AI 辅助编辑。
- Gemini 原版：参考 ZipZipPipe 图库，见 [GEMINI-ASSET-LICENSE](../gpt-niang-usage/assets/GEMINI-ASSET-LICENSE.md)。高清猫娘来自 Gemini quota widget，见其 [GEMINI-HD-NOTICE](../gpt-niang-usage/assets/GEMINI-HD-NOTICE.md)。本项目派生表情不扩大原授权范围。
- Claude 原图与派生半身/表情：沿用 [CC BY-NC-SA 4.0 声明](../gpt-niang-usage/assets/CLAUDE-ARTWORK-LICENSE.txt)，署名原仓库 liangcka/xiaoke-quota；半身造型另参考 Claude-Niang。
- DS 原图：来自 DeepSeek-Balance-Whale-Widget。八种桌面表情基于该仓库 `For–WinDesktop` 的 commit `61827f675fd3daac011859ad8a12e095af5480db`，本项目用 AI 辅助补齐耳朵和侧发。[上游素材声明](../gpt-niang-usage/assets/DEEPSEEK-ARTWORK-NOTICE.md)仍适用。
- 完成微笑、补耳表情、九张点击表情：分别见各素材目录中的 `NOTICE.txt`。这些是基于既有形象的编辑，未声称是从原作者取得的未裁切母版。
- 内置 GPT 语录的上游部分沿用 [quotes-LICENSE](../gpt-niang-usage/assets/quotes-LICENSE.txt)；其他内置语录为本项目自拟趣味台词，不代表模型厂商观点。声音沿用 GPT-Niang 随包素材，不据此声明额外权利。

Gemini 与 DS 上游声明中的原作者/权利来源仍有未独立确认的部分，本仓库如实保留，不将上游声明改写为厂商授权。有权利疑问时请提交 Issue，注明具体文件与依据，以便核查、替换或移除。
