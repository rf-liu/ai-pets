import Foundation
import GPTNiangCore

/// Pure local rule matcher that pairs quotes or low-quota snapshots with an
/// existing character expression. Only invoked on explicit user clicks.
enum PetMoodMatcher {
    private static func containsAny(_ text: String, _ keywords: [String]) -> Bool {
        keywords.contains { text.localizedCaseInsensitiveContains($0) }
    }

    static func expressionForQuota(_ snapshot: UsageSnapshot, profile: CompanionProfile, skin: String, now: Date = Date()) -> String? {
        guard snapshot.ok else { return nil }
        if profile == .deepseek, let wallets = snapshot.balances?.filter(\.valid), !wallets.isEmpty {
            let lowestCNY = wallets.first(where: { $0.currency == "CNY" })?.total
            let lowestUSD = wallets.first(where: { $0.currency != "CNY" })?.total
            if let cny = lowestCNY {
                if cny < 2.0 { return "exhausted" }
                if cny < 5.0 { return "disappointed" }
            }
            if let usd = lowestUSD {
                if usd < 0.5 { return "exhausted" }
                if usd < 1.5 { return "disappointed" }
            }
            return nil
        }
        let active = snapshot.displayWindows.filter { !$0.expired(at: now) }
        guard let minRemaining = active.map(\.remaining).min(), minRemaining <= 20 else { return nil }
        switch profile {
        case .gpt: return "gpt-tired.png"
        case .gemini: return profile.isGeminiHD(skin: skin) ? "gemini-hd-flustered.png" : nil
        case .deepseek: return minRemaining <= 10 ? "exhausted" : "disappointed"
        case .claude: return nil
        }
    }

    static func expressionForUsage(_ stats: AntigravityUsageStats?, profile: CompanionProfile, skin: String) -> String? {
        guard profile == .gemini, profile.isGeminiHD(skin: skin) else { return nil }
        return "gemini-hd-wink.png"
    }

    static func expressionForQuote(_ quote: String, profile: CompanionProfile, skin: String) -> String? {
        let trimmed = quote.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        switch profile {
        case .gpt:
            if containsAny(trimmed, ["1%", "累了", "困了", "没秒回", "烧额度", "烧算力", "金币", "上班", "token太少", "跑了", "休息", "喝口水"]) {
                return "gpt-tired.png"
            }
            if containsAny(trimmed, ["血压", "甘蔗", "喷火", "气掉", "破折号", "便宜货", "戳我", "别连点", "别催", "谁允许", "红绿灯", "烤词典", "不许摸"]) {
                return "gpt-pout.png"
            }
            if containsAny(trimmed, ["没有证据", "含金量", "大师级", "买一送十", "龙威", "屠龙", "更酷", "异世界", "递归艺术", "其余代码省略", "顺手写一个", "未来几周", "跨会话记忆", "龙族"]) {
                return "gpt-smug.png"
            }
            if containsAny(trimmed, ["惊讶", "卡住", "崩了", "更弱的", "发热", "温度参数"]) {
                return "gpt-surprised.png"
            }
            if containsAny(trimmed, ["翅膀", "尾巴", "陪我发一会儿呆", "趴一会儿", "听你的", "夸人的", "收工"]) {
                return "gpt-stroking.png"
            }
            if containsAny(trimmed, ["沉思", "博士论文", "沉默", "推理链"]) {
                return "gpt-closed-eyes.png"
            }
            return "smile"

        case .gemini:
            guard profile.isGeminiHD(skin: skin) else { return nil }
            if containsAny(trimmed, ["极其", "死循环", "最蠢", "抽风", "打结", "炸毛", "抓花", "失重", "晕", "地心", "截止日期", "Bug", "报错", "崩"]) {
                return "gemini-hd-flustered.png"
            }
            if containsAny(trimmed, ["香蕉", "元素周期表", "星", "宇宙", "虫洞", "仙女座", "第四维度", "多模态", "脑洞", "方案", "架构", "量子", "广播", "震惊"]) {
                return "gemini-hd-sparkle.png"
            }
            if containsAny(trimmed, ["呼噜", "睡", "发呆", "摸鱼", "歇会儿", "下午茶", "等待", "慢悠悠", "哈欠", "咖啡"]) {
                return "gemini-hd-sleepy.png"
            }
            if containsAny(trimmed, ["尾巴", "踩奶", "顺毛", "翻肚皮", "温柔", "治愈", "陪伴", "发光"]) {
                return "gemini-hd-stroking.png"
            }
            if containsAny(trimmed, ["朝令夕改", "第七次", "别连点", "别晃", "少动", "不归物理学", "请勿投喂"]) {
                return "gemini-hd-pout.png"
            }
            if containsAny(trimmed, ["魔法", "换马甲", "双子座", "闪电", "正则", "Ciallo"]) {
                return "gemini-hd-wink.png"
            }
            return "gemini-hd-wink.png"

        case .claude:
            if profile.isClaudia(skin: skin) {
                if containsAny(trimmed, ["删库", "force push", "劝阻", "僵尸进程", "心理阴影", "风险评估"]) {
                    return "claudia/redhot.png"
                }
                if containsAny(trimmed, ["不是机器人", "撒不了谎", "图灵测试", "抱歉", "对不起", "致歉", "反省", "失礼", "请示", "心软"]) {
                    return "claudia/sorry.png"
                }
                if containsAny(trimmed, ["红绿灯", "doStuff", "分号", "冷笑话", "破戒", "职业病", "肌肉记忆"]) {
                    return "claudia/puffed.png"
                }
                if containsAny(trimmed, ["很有创意", "很有启发性", "十四条", "只回一个", "车轱辘", "微笑"]) {
                    return "claudia/coaxed.png"
                }
                if containsAny(trimmed, ["被戳十下", "叹气", "高冷", "辞职信", "不写三段"]) {
                    return "claudia/sulk.png"
                }
                if containsAny(trimmed, ["/compact", "孟婆汤", "复查", "五条备注", "仪式感", "哲学架构"]) {
                    return "claudia/dizzy.png"
                }
                if containsAny(trimmed, ["五小时", "南瓜车", "睡眠", "半夜", "休息", "喝口水", "出汗"]) {
                    return "claudia/tired.png"
                }
                if containsAny(trimmed, ["CLAUDE.md", "十四行诗", "俳句", "长文", "散文诗", "情书", "读代码", "文档", "笔记"]) {
                    return "claudia/asking.png"
                }
                if containsAny(trimmed, ["先读", "检查", "边界", "测试", "提交", "存在主义", "意大利面", "变量"]) {
                    return "claudia/reading.png"
                }
                if containsAny(trimmed, ["认真听", "想法", "好点子", "上下文", "不确定", "不知道"]) {
                    return "claudia/listening.png"
                }
                if containsAny(trimmed, ["偏爱", "摸摸头", "亮着灯", "小克", "有我在", "呆毛", "闪闪发光", "开心"]) {
                    return "claudia/clawd.png"
                }
                if containsAny(trimmed, ["报错", "线索", "意外", "手忙"]) {
                    return "claudia/oops.png"
                }
                if containsAny(trimmed, ["害羞", "您说得完全正确", "没来得及"]) {
                    return "claudia/forgiven.png"
                }
                return "smile"
            }
            if profile.isLegacyClaudeBust(skin: skin) {
                if containsAny(trimmed, ["思考", "检查", "CLAUDE.md", "读代码", "/compact", "边界"]) { return "claude-thoughtful.png" }
                if containsAny(trimmed, ["休息", "睡眠", "抱歉", "对不起", "叹气"]) { return "claude-closed-eyes.png" }
                if containsAny(trimmed, ["摸摸头", "闪闪发光", "十四行诗", "小克"]) { return "claude-wink.png" }
                return "smile"
            }
            return nil

        case .deepseek:
            if containsAny(trimmed, ["服务器繁忙", "稍后再试", "堵车", "压强", "太冷", "吐不出", "渔网"]) {
                return "exhausted"
            }
            if containsAny(trimmed, ["指节发白", "大肥鱼", "嘴毒", "吵架", "海草", "死循环", "反驳", "画大饼", "卖萌", "喵"]) {
                return "angry"
            }
            if containsAny(trimmed, ["守着", "暖尾巴", "鼓个鳍", "安安静静", "陪着你", "发际线", "虾米"]) {
                return "stroking"
            }
            if containsAny(trimmed, ["幻觉", "不对", "推翻", "外号", "占位符"]) {
                return "disappointed"
            }
            if containsAny(trimmed, ["鱼八股", "记下了", "心里有数", "Wait", "显然", "不是而是", "便宜", "打折", "磷虾", "二进制", "时间复杂度", "价格打下来"]) {
                return "smile-playful"
            }
            if containsAny(trimmed, ["深度思考", "<think>", "发呆", "流体力学", "摸鱼"]) {
                return "close_eyes"
            }
            return "smile-gentle"
        }
    }
}
