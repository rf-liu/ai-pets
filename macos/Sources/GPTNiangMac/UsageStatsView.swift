import SwiftUI
import GPTNiangCore

enum UsageStatsRange: String, CaseIterable, Identifiable {
    case today
    case last7Days
    var id: String { rawValue }
    var title: String {
        switch self {
        case .today: return "今天"
        case .last7Days: return "近 7 天"
        }
    }
}

struct UsageStatsView: View {
    @ObservedObject var model: WidgetModel
    @State private var selectedRange: UsageStatsRange = .today

    private var stats: AntigravityUsageStats? { model.usageStats }
    private var period: AntigravityUsagePeriod {
        guard let stats else { return AntigravityUsagePeriod() }
        return selectedRange == .today ? stats.today : stats.last7Days
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            Picker("时间范围", selection: $selectedRange) {
                ForEach(UsageStatsRange.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if let error = model.usageStatsError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            summaryCards
            disclaimerBanner
            modelList
            footer
        }
        .padding(22)
        .frame(width: 640, height: 680)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Antigravity 用量统计")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                Text("汇总桌面版 Antigravity 与 agy 命令行的本地模型调用")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 8) {
                    if model.usageStatsBusy {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Button(model.usageStatsBusy ? "扫描中…" : "立即刷新") {
                        model.refreshUsageStats()
                    }
                    .disabled(model.usageStatsBusy)
                }
                Text(updatedCaption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

    private var updatedCaption: String {
        guard let stats else { return model.usageStatsBusy ? "正在首次统计…" : "尚未扫描" }
        return "更新于 " + stats.updatedTimeText()
    }

    private var summaryCards: some View {
        HStack(spacing: 12) {
            kpiCard(
                title: selectedRange == .today ? "今日总 Token" : "近 7 天总 Token",
                value: stats == nil ? "—" : AntigravityUsageFormat.tokens(period.totalTokens),
                subtitle: stats == nil ? "等待扫描结果" : tokenBreakdownLine(period),
                valueColor: .primary
            )
            kpiCard(
                title: "折合官方 API 费用",
                value: stats == nil ? "—" : period.costText,
                subtitle: costSubtitle,
                valueColor: (period.totalTokens > 0 && period.estimatedCostUsd == nil) ? .orange : .primary
            )
            kpiCard(
                title: "调用规模",
                value: stats == nil ? "—" : "\(period.calls) 次",
                subtitle: stats == nil ? "桌面版 + agy" : "\(period.models.count) 个模型 · 桌面 + agy",
                valueColor: .primary
            )
        }
    }

    private var costSubtitle: String {
        guard stats != nil else { return "按官方 API 价格折算" }
        if period.totalTokens > 0 && period.estimatedCostUsd == nil {
            return "所涉模型暂缺公开定价"
        }
        if period.hasUnknownPrice {
            return "按官方 API 折算 · 含价格未知模型"
        }
        return "按官方 API 价格折算"
    }

    private func kpiCard(title: String, value: String, subtitle: String, valueColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(subtitle)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.primary.opacity(0.045))
        .cornerRadius(10)
    }

    private var disclaimerBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Antigravity 为订阅制，以上金额按 LiteLLM 公开的官方 API 单价折算，并非实际扣费。")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 6) {
                Text(pricingStatusText)
                    .font(.caption2)
                    .foregroundStyle(stats?.pricingStale == true ? .orange : .secondary)
                Spacer()
                if let stats {
                    Text(selectedRange == .today ? "日期：\(stats.todayDate)" : "窗口：近 7 个自然日")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.primary.opacity(0.035))
        .cornerRadius(8)
    }

    private var pricingStatusText: String {
        guard let stats else { return "价格表每日从 LiteLLM 公开列表更新一次（不携带任何个人信息）。" }
        if let updated = stats.pricingUpdatedText() {
            if stats.pricingStale == true {
                return "价格表下载失败，当前沿用上次缓存（\(updated)）"
            }
            return "公开价格表更新于 \(updated)（每日自动更新，不带个人信息）"
        }
        return "暂未下载到公开价格表，当前所有模型标为「价格未知」"
    }

    private var modelList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("按模型分布")
                    .font(.headline)
                Spacer()
                Text("按总 Token 降序")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if stats == nil {
                emptyState(model.usageStatsBusy ? "正在统计本地调用记录，请稍候…" : "尚无用量缓存，点击右上角「立即刷新」开始扫描。")
            } else if period.models.isEmpty {
                emptyState(selectedRange == .today ? "今天还没有检测到 Antigravity 或 agy 调用记录。" : "近 7 天没有检测到 Antigravity 或 agy 调用记录。")
            } else {
                let maxTokens = max(1, period.models.map(\.totalTokens).max() ?? 1)
                List(period.models) { item in
                    modelRow(item, maxTokens: maxTokens)
                        .padding(.vertical, 6)
                }
                .listStyle(.inset)
            }
        }
        .frame(maxHeight: .infinity)
    }

    private func emptyState(_ text: String) -> some View {
        VStack {
            Spacer()
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.025))
        .cornerRadius(10)
    }

    private func modelRow(_ item: AntigravityModelUsage, maxTokens: Int) -> some View {
        let share = Double(item.totalTokens) / Double(maxTokens)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(item.displayName)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        if item.displayName.lowercased() != item.modelId.lowercased() {
                            Text(item.modelId)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Text("\(item.calls) 次生成 · \(modelTokenBreakdown(item))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 10)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(AntigravityUsageFormat.tokens(item.totalTokens) + " tok")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                    if item.priceKnown {
                        Text(item.costText)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    } else {
                        Text("价格未知")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.08))
                    Capsule()
                        .fill(item.priceKnown ? Color.accentColor.opacity(0.75) : Color.orange.opacity(0.65))
                        .frame(width: max(4, geometry.size.width * CGFloat(max(0, min(1, share)))))
                }
            }
            .frame(height: 4)
        }
    }

    private func tokenBreakdownLine(_ p: AntigravityUsagePeriod) -> String {
        var parts = ["输入 " + AntigravityUsageFormat.tokens(p.inputTokens)]
        if p.cacheReadTokens > 0 { parts.append("缓存 " + AntigravityUsageFormat.tokens(p.cacheReadTokens)) }
        parts.append("输出 " + AntigravityUsageFormat.tokens(p.outputTokens))
        return parts.joined(separator: " · ")
    }

    private func modelTokenBreakdown(_ m: AntigravityModelUsage) -> String {
        var parts = ["输入 " + AntigravityUsageFormat.tokens(m.inputTokens)]
        if m.cacheReadTokens > 0 { parts.append("缓存读 " + AntigravityUsageFormat.tokens(m.cacheReadTokens)) }
        if m.cacheWriteTokens > 0 { parts.append("缓存写 " + AntigravityUsageFormat.tokens(m.cacheWriteTokens)) }
        if m.thinkingOutputTokens > 0 {
            parts.append("输出 \(AntigravityUsageFormat.tokens(m.outputTokens))（思考 \(AntigravityUsageFormat.tokens(m.thinkingOutputTokens))）")
        } else {
            parts.append("输出 " + AntigravityUsageFormat.tokens(m.outputTokens))
        }
        return parts.joined(separator: " · ")
    }

    private var footer: some View {
        HStack {
            Text("每小时自动扫一次 · 右键「刷新」立即更新 · 未改动对话复用缓存")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }
}
