# DeepSeek Harness 可选桥接

Claude 已按用户要求停用额度查询，点击直接显示语录。没有读取或使用桌面版登录 Cookie。Code 对话的本地 TPS 与结束提醒继续可用；不需要额度桥接插件。

DeepSeek Harness 0.2.1-rc.5：使用 dsh/index-v4.mjs，通过 Host 原生 deepseekAccount 服务读取余额，凭据留在 Host 内。导出只包含币种、余额、账号散列和时间。profile 的 id 只用于在内存中计算散列，不导出名字或联系方式。

模块位于 ~/Library/Application Support/AIQuotaCompanion/integrations/dsh/index-v4.mjs。
在 ~/.dsh/profiles/desktop/cordis.patch.yml 的顶层数组末尾添加插入项（用自己的绝对路径，保留已有配置）：

```yaml
- insert:
    - id: aiquota-companion
      name: "/Users/YOUR_NAME/Library/Application Support/AIQuotaCompanion/integrations/dsh/index-v4.mjs"
      config:
        output: "/Users/YOUR_NAME/Library/Application Support/AIQuotaCompanion/deepseek/bridge.json"
```

下次空闲启动 Harness 时生效。每 60 秒同步。不同账号独立记账，货币余额不换算成百分比。
今日已观测消费使用余额下降的累计值；充值/赠金增加单独记录且标记待核对，不冲掉已观测消费。首次连接前和离线期间的消费没有追溯保证。
每轮费用由本机真实 token 计数按官方峰谷价估算，思考已含在输出中，不重复相加；未知计数/模型/未来节假日价格规则不当成零。

卸载：移除 aiquota-companion 插入项及其模块，不改其他插件。
记账纯函数复用 MeteorNOX/DeepSeek-Balance-Whale-Widget 的 lib/accounting.mjs（MIT），源码及 bundle 保留 DEEPSEEK-CODE-LICENSE.txt。
图片与衍生表情现随程序和源码分发，原上游使用边界保留，详见 ../docs/ATTRIBUTION.md。
