import AppKit
import SwiftUI
import GPTNiangCore

private struct ThreadSpeedResponse: Decodable { let threads: [ThreadSpeedRow]; let error: String? }
@MainActor
final class ThreadSpeedStore: ObservableObject {
    @Published var rows: [ThreadSpeedRow] = []
    @Published var error: String?
    private var language: InterfaceLanguage = .system
    private var process: Process?
    private var output: Pipe?
    private var input: Pipe?
    private var pending = Data()
    private var generation = 0
    func start(model: WidgetModel) {
        language = model.language
        guard process?.isRunning != true else { return }
        guard let node = model.findNode() else { error = model.text("請先安裝 Node.js 20+"); return }
        start(executable: node, arguments: [model.resources.appendingPathComponent("Backend/runtime/" + model.profile.speedScript).path])
    }
    func start(executable: URL, arguments: [String]) {
        guard process?.isRunning != true else { return }
        rows = []; error = nil
        generation += 1
        let current = generation
        let task = Process(), output = Pipe(), input = Pipe()
        task.executableURL = executable
        task.arguments = arguments
        task.standardOutput = output; task.standardError = FileHandle.nullDevice; task.standardInput = input
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                Task { @MainActor in self?.ended(current) }
                return
            }
            Task { @MainActor in if self?.generation == current { self?.consume(data) } }
        }
        task.terminationHandler = { [weak self] _ in Task { @MainActor in self?.ended(current) } }
        do { try task.run(); process = task; self.output = output; self.input = input }
        catch { self.error = language.text("聊天速度面板無法啟動：%@", String(describing: error.localizedDescription)); output.fileHandleForReading.readabilityHandler = nil }
    }
    private func consume(_ data: Data) {
        pending.append(data)
        if pending.count > 512 * 1024 { pending.removeAll(); return }
        while let end = pending.firstIndex(of: 10) {
            let line = pending[..<end]; pending.removeSubrange(...end)
            if let response = try? JSONDecoder().decode(ThreadSpeedResponse.self, from: line) { rows = response.threads; error = response.error }
        }
    }
    private func ended(_ current: Int) {
        guard generation == current else { return }
        stop(); rows = []; error = language.text("本機指標程序已結束，請關閉並重新開啟面板。")
    }
    func stop() {
        generation += 1
        output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close()
        if process?.isRunning == true { process?.terminate() }; process = nil; output = nil; input = nil; pending.removeAll()
    }
}
struct ThreadSpeedView: View {
    @ObservedObject var store: ThreadSpeedStore
    @ObservedObject var model: WidgetModel
    var body: some View {
        let groups = ModelSpeedSummary.groups(rows: store.rows)
        return VStack(alignment: .leading, spacing: 14) {
            Text(model.text("聊天速度")).font(.system(size: 25, weight: .semibold, design: .rounded))
            Text(model.text(model.profile == .gemini ? "生成 TPS · 含思考與首字等待" : "請求平均 TPS · 含思考與等待")).font(.headline)
            if model.profile == .claude {
                Text("Claude 桌面版的 Code 对话 · 普通 Chat / Cowork 暂无可读的本地 token 计数")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text(model.text(model.profile == .gemini ? "按最近一次模型生成的輸出總 tokens（已含思考）÷（首 token 等待 + 流式生成時間）計算。每 3 秒讀取本機統計，不會自動發送測速消息。" : "按最近完成的一輪回覆的總輸出 tokens（正文 + 思考）÷整輪耗時計算，包含首字、工具、網路與確認等待。每 3 秒讀取本機統計，不會自動發送測速消息。"))
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if model.profile == .gemini {
                Text(model.text("包含中間模型調用的生成輸出；不含工具或程式執行等待。"))
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(model.text(model.profile == .gemini ? "近 3 天生成平均速度 · 分模型" : "近 3 天平均速度 · 分模型")).font(.headline)
                Text(model.text("統計目前列表中可讀取的有效樣本；模型與思考檔分開，包含思考與等待。"))
                    .font(.caption).foregroundStyle(.secondary)
                if store.rows.contains(where: { $0.recentPartial == true }) {
                    Text(model.text("部分歷史記錄未載入，平均值僅涵蓋已讀取樣本。"))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if groups.isEmpty {
                    Text(model.text("等待有效統計")).font(.caption).foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        VStack(spacing: 10) {
                            ForEach(groups) { group in
                                HStack(alignment: .center) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(model.text(group.modelName)).font(.system(size: 14, weight: .medium)).lineLimit(2)
                                        Text(model.text("%@ 個樣本 · %@ 個會話 · 總 tokens ÷ 總耗時", String(group.summary.sampleCount), String(group.summary.count)))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 10)
                                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                                        Text(group.summary.tokensPerSecond.map { String(format: "%.1f", $0) } ?? "—")
                                            .font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit()
                                        Text("tokens/s").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }.frame(height: min(CGFloat(groups.count) * 52, 180))
                }
            }.padding(14).background(Color.primary.opacity(0.045)).cornerRadius(10)
            if let error = store.error { Text(error).foregroundStyle(.orange) }
            List(store.rows) { row in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(row.state == "running" ? model.text("進行中") : row.state == "idle" ? model.text("已完成") : row.state == "aborted" ? model.text("已中斷") : model.text("本機記錄"))
                                .font(.caption).foregroundStyle(.secondary)
                            Spacer()
                        }
                        Text(row.title).font(.system(size: 14, weight: .medium)).lineLimit(2)
                        if model.profile == .deepseek, let cost = row.estimatedCost {
                            Text(String(format: "本轮约 ¥%.4f · 按官方单价估算", cost)).font(.caption).foregroundStyle(.secondary)
                        }
                        if ["generation-average", "request-average"].contains(row.measurement ?? ""), let tokens = row.outputTokens, let interval = row.intervalSeconds {
                            if let name = row.modelName, !name.isEmpty { Text(name).font(.caption).foregroundStyle(.secondary) }
                            Text(model.text(row.measurement == "request-average" ? "%@ 輸出 tokens / %@ 秒 · 最近完成的一輪回覆" : "%@ 輸出 tokens / %@ 秒 · 最近一次生成", String(tokens), String(format: "%.2f", interval)))
                                .font(.caption).foregroundStyle(.secondary)
                            if let reasoning = row.reasoningOutputTokens ?? row.thinkingOutputTokens, let response = row.responseOutputTokens {
                                Text(model.text(model.profile == .gemini ? "非思考輸出 %@ · 思考 %@ tokens" : "正文 %@ · 思考 %@ tokens", String(response), String(reasoning))).font(.caption).foregroundStyle(.secondary)
                            }
                            if let first = row.timeToFirstTokenSeconds, let stream = row.streamingSeconds {
                                Text(model.text("首 token %@ 秒 · 流式生成 %@ 秒", String(format: "%.2f", first), String(format: "%.2f", stream)))
                                    .font(.caption).foregroundStyle(.secondary)
                            } else if let first = row.timeToFirstTokenSeconds {
                                Text(model.text("首 token 等待 %@ 秒", String(format: "%.2f", first))).font(.caption).foregroundStyle(.secondary)
                            }
                            if row.measurement == "request-average", let at = row.sampleAt {
                                Text(Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .standard)).font(.caption).foregroundStyle(.secondary)
                            }
                        } else if let tokens = row.outputTokens, let interval = row.intervalSeconds, let at = row.sampleAt {
                            Text(model.text("%@ 輸出 tokens / %@ 秒 · %@", String(describing: tokens), String(describing: String(format: "%.1f", interval)), String(describing: Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .standard))))
                                .font(.caption).foregroundStyle(.secondary)
                        } else { Text(row.unavailableReason ?? model.text("尚未有兩筆有效計數紀錄")).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer(minLength: 12)
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(row.tokensPerSecond.map { String(format: "%.1f", $0) } ?? "—")
                            .font(.system(size: 25, weight: .semibold, design: .rounded)).monospacedDigit()
                        Text("tokens/s").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 8)
            }.listStyle(.inset)
        }.padding(22).frame(width: 620, height: 680)
    }
}
