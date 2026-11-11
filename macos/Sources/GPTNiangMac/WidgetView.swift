import SwiftUI
import AppKit
import GPTNiangCore

// Coordinates, colors and timing are taken from widget.xaml/widget.ps1 (v1.2.5).
struct WidgetView: View {
    @ObservedObject var model: WidgetModel
    let onDrag: (CGSize) -> Void
    let onSettings: () -> Void
    let onContextMenu: (NSEvent, NSView) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pressed = false
    @State private var near: Double = 0
    @State private var tail: Double = 0
    @State private var cloud: Double = 0
    @State private var text: Double = 0
    @State private var displayedMessage: String?
    @State private var animationGeneration = 0
    @State private var sceneGeneration = 0
    @State private var frozenPhase: Double = 0
    private var ink: Color { Color(hex: model.profile.bubbleTheme.ink) }
    private var muted: Color { Color(hex: model.profile.bubbleTheme.muted) }
    private let ease = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.2)
    private let rebound = Animation.timingCurve(0.34, 1.56, 0.64, 1, duration: 0.22)

    var body: some View {
        TimelineView(.periodic(from: .now, by: model.colorScope == .none || model.colorPaused || reduceMotion ? 1 : 1 / 30)) { context in
            let phase = model.colorPaused || reduceMotion ? frozenPhase : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6
            stage(date: context.date, phase: phase)
        }
        .frame(width: 378 * model.displayScale, height: 378 * model.displayScale, alignment: .topLeading)
        .environment(\.colorScheme, .light)
        .onAppear { animateBubble(model.bubble); displayedMessage = model.message }
        .onChange(of: model.colorPaused) { paused in
            if paused { frozenPhase = Date().timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6 }
        }
        .onChange(of: reduceMotion) { value in
            if value { frozenPhase = Date().timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6 }
        }
        .onChange(of: model.bubble) { animateBubble($0) }
        .onChange(of: model.message) { next in
            sceneGeneration += 1
            let generation = sceneGeneration
            if !model.bubble || reduceMotion { displayedMessage = next; return }
            withAnimation(.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.12)) { text = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                guard generation == sceneGeneration, model.bubble else { return }
                displayedMessage = next
                withAnimation(.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.16)) { text = 1 }
            }
        }
        .contextMenu {
            if model.profile.quotaEnabled {
                Button(model.text("查看額度")) { model.toggleQuota() }
                Button(model.text("刷新額度")) { model.refresh() }
            }
            Button(model.text("來一句語錄")) { model.showQuote() }
            Divider()
            Toggle(model.text("回答结束提醒"), isOn: Binding(get: { model.completionEnabled }, set: { model.completionEnabled = $0; model.savePreferences() }))
            WidgetAudioMenu(audio: model.audio)
            Button(model.text("設定…"), action: onSettings)
            Button(model.text("退出 AI 额度挂件")) { NSApp.terminate(nil) }
        }
    }
    private func stage(date: Date, phase: Double) -> some View {
        let mirrored = model.facingLeft
        return ZStack(alignment: .topLeading) {
            OriginalBubbleShape().fill(style("surface", phase: phase))
                .overlay(OriginalBubbleShape().stroke(style("accent", phase: phase), lineWidth: 4))
                .frame(width: 350, height: 239)
                .scaleEffect(0.7 + 0.3 * cloud, anchor: UnitPoint(x: 0.4425, y: 0.36)).opacity(cloud)
                .allowsHitTesting(false)
            Ellipse().fill(style("surface", phase: phase)).overlay(Ellipse().stroke(style("accent", phase: phase), lineWidth: 4))
                .frame(width: 25, height: 18).scaleEffect(0.7 + 0.3 * tail).opacity(tail)
                .offset(x: 108, y: 182).allowsHitTesting(false)
            Ellipse().fill(style("surface", phase: phase)).overlay(Ellipse().stroke(style("accent", phase: phase), lineWidth: 4))
                .frame(width: 17, height: 12).scaleEffect(0.7 + 0.3 * near).opacity(near)
                .offset(x: 142, y: 214).allowsHitTesting(false)
            scene(now: date, phase: phase)
                .frame(width: displayedMessage == nil ? 184 : 218, height: displayedMessage == nil ? 115 : 126)
                .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                .opacity(text).offset(x: displayedMessage == nil ? 63 : 46, y: displayedMessage == nil ? 22 : 22)
                .allowsHitTesting(false)
            if let image = model.characterImage {
                let girl = Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
                    .frame(width: 208 - model.profile.artworkInset * 2, height: 208 - model.profile.artworkInset * 2)
                    .frame(width: 208, height: 208)
                ZStack {
                    if model.colorScope == .full { Rectangle().fill(characterFlow(phase: phase)).mask(girl).opacity(0.62).blur(radius: 7) }
                    girl
                    if model.colorScope == .full { Rectangle().fill(characterFlow(phase: phase)).mask(girl).opacity(0.34).allowsHitTesting(false) }
                }
                .frame(width: 208, height: 208).contentShape(Rectangle())
                .overlay(CharacterInteraction(onPress: { down in
                    model.interactionActive = down
                    model.characterPressChanged(down)
                    withAnimation(reduceMotion ? nil : rebound) { pressed = down }
                    model.play(down ? "press" : "release")
                }, onDrag: { translation in
                    onDrag(translation)
                    if translation == .zero { model.savePreferences() }
                }, onClick: { model.characterClick() }, onMenu: onContextMenu))
                .onHover { model.characterHovered = $0 }.offset(x: 142, y: 142)
                .accessibilityElement().accessibilityLabel(model.profile.petName + (model.isCompletionMessage ? "：回复已结束，点击打开" + model.profile.hostName : model.profile.quotaEnabled ? "：点击查看额度，拖动调整位置" : "：点击换语录，拖动调整位置"))
                .accessibilityAddTraits(.isButton).accessibilityAction { model.characterClick() }
            }
            if model.characterHovered && !model.hideMenu && !model.isCompletionMessage {
                Button(action: onSettings) { Image(systemName: "line.3.horizontal").font(.system(size: 15)).foregroundStyle(ink).frame(width: 24, height: 24).background(Color(hex: model.profile.bubbleTheme.track), in: RoundedRectangle(cornerRadius: 6)) }
                    .buttonStyle(.plain).scaleEffect(x: mirrored ? -1 : 1, y: 1).offset(x: 320, y: 162)
                    .help(model.text("掛件設定")).accessibilityLabel(model.text("掛件設定"))
            }
        }
        .frame(width: 350, height: 350, alignment: .topLeading)
        .scaleEffect(x: pressed ? 1.05 : 1, y: pressed ? 0.88 : 1, anchor: .bottom)
        .scaleEffect(x: mirrored ? -1 : 1, y: 1, anchor: .bottom)
        .padding(14).scaleEffect(model.displayScale, anchor: .topLeading)
    }
    private func scene(now: Date, phase: Double) -> some View {
        Group {
            if let quote = displayedMessage {
                if model.isCompletionMessage {
                    VStack(spacing: 3) {
                        Text(model.profile == .deepseek ? "DeepSeek" : model.profile.hostName).font(.system(size: 30, weight: .bold))
                        Text(model.text("有回复已结束")).font(.system(size: 30, weight: .bold))
                        if let title = model.completionConversationTitle {
                            Text(title).font(.system(size: 13, weight: .medium)).lineLimit(2)
                        }
                        if let cost = model.completionCost {
                            Text(String(format: "本轮约 ¥%.4f · 本机估算", cost)).font(.system(size: 13, weight: .medium))
                        }
                    }.foregroundStyle(ink)
                } else {
                Text(quote).font(.system(size: 24, weight: .bold)).multilineTextAlignment(.center)
                    .minimumScaleFactor(0.3).lineLimit(6).padding(.horizontal, 12)
                    .foregroundStyle(model.colorScope == .none ? AnyShapeStyle(ink) : style("ink", phase: phase))
                    .help(quote)
                }
            } else {
                VStack(spacing: 2) {
                    Text(quotaTitle(now: now)).font(.system(size: 12, weight: .semibold)).foregroundStyle(style("ink", phase: phase))
                        .help(quotaDetails(now: now))
                    if let wallets = model.snapshot.balances?.filter(\.valid), !wallets.isEmpty {
                        ForEach(wallets.prefix(2), id: \.currency) { wallet in
                            VStack(spacing: 3) {
                                RollingBalanceText(value: wallet.total, currency: wallet.currency).font(.system(size: 25, weight: .bold)).monospacedDigit()
                                Text("充值 " + wallet.amount(wallet.recharge) + " · 赠送 " + wallet.amount(wallet.bonus)).font(.system(size: 10))
                                if let finance = model.snapshot.deepseek {
                                    if let observed = finance.todayObserved.first(where: { $0.currency == wallet.currency }) {
                                        Text("今日已观测 " + wallet.amount(observed.amount)).font(.system(size: 12, weight: .medium))
                                        Text("自 " + Date(timeIntervalSince1970: observed.from / 1000).formatted(date: .omitted, time: .shortened) + " 起" + (observed.needsReview ? " · 余额增加待核对" : ""))
                                            .font(.system(size: 9)).foregroundStyle(.secondary)
                                    } else if let local = finance.todayEstimatedCNY {
                                        Text(String(format: "今日本机约 ¥%.4f", local)).font(.system(size: 11))
                                    } else { Text("今日消费：从本次连接起观测").font(.system(size: 9)) }
                                    if let turn = finance.latestTurn {
                                        Text(String(format: "最近一轮约 ¥%.4f", turn.amount)).font(.system(size: 11))
                                            .help(turn.title + " · " + Date(timeIntervalSince1970: turn.at / 1000).formatted() + " · 按官方 token 单价估算，非账单")
                                    }
                                }
                            }.foregroundStyle(ink)
                        }
                        if model.snapshot.stale(at: now) { Text(model.text("舊快照 · 刷新後確認")).font(.system(size: 9)).foregroundStyle(.orange) }
                    } else if model.snapshot.displayWindows.isEmpty {
                        Text(model.snapshot.error ?? model.text("目前帳戶未提供額度視窗"))
                            .font(.system(size: 12)).foregroundStyle(muted).multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        ForEach(model.snapshot.displayWindows) { window in
                            VStack(spacing: 1) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(window.title(language: model.language)).font(.system(size: 13))
                                        Text(model.text(window.expired(at: now) ? "上次 %@%%" : "已用 %@%%", String(format: "%.1f", 100-window.remaining).replacingOccurrences(of: ".0", with: "")))
                                            .font(.system(size: 9))
                                    }.foregroundStyle(muted)
                                    Spacer()
                                    Text(window.expired(at: now) ? "—" : "\(window.percentageText)%")
                                        .font(.system(size: 24, weight: .bold)).monospacedDigit()
                                        .foregroundStyle(quotaStyle(window, now: now, phase: phase))
                                }.frame(height: 25)
                                GeometryReader { geometry in
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Color(hex: model.profile.bubbleTheme.track))
                                        Capsule().fill(quotaStyle(window, now: now, phase: phase))
                                            .frame(width: geometry.size.width * (window.expired(at: now) ? 0 : max(0, min(1, window.remaining / 100))))
                                    }
                                }.frame(height: 4)
                                Text(window.resetText(at: now, countdown: now.timeIntervalSince(model.sceneStarted) < 2, language: model.language))
                                    .font(.system(size: 11)).foregroundStyle(muted)
                                    .frame(maxWidth: .infinity, alignment: .leading).lineLimit(1).minimumScaleFactor(0.85)
                            }
                        }
                        if model.snapshot.stale(at: now) {
                            Text(model.text("舊快照 · 刷新後確認")).font(.system(size: 9)).foregroundStyle(.orange)
                        }
                        if model.snapshot.accountVerified == false {
                            Text(model.text("帳戶待確認")).font(.system(size: 9)).foregroundStyle(.orange)
                        }
                    }
                }
            }
        }
    }
    private func quotaTitle(now: Date) -> String {
        if !model.snapshot.ok { return model.text("暂无法读取") }
        if model.snapshot.balances?.contains(where: \.valid) == true { return model.snapshot.stale(at: now) ? "上次可用余额" : "可用余额" }
        return model.snapshot.stale(at: now) ? model.text("上次剩余额度") : model.text("剩餘額度")
    }
    private func quotaDetails(now: Date) -> String {
        var rows = [model.text("目前方案：%@", model.snapshot.planLabel ?? model.text("未知套餐"))]
        for window in model.snapshot.validWindows {
            rows.append("\(window.title(language: model.language))：\(window.percentageText)% · \(window.resetText(at: now, language: model.language))")
            if window.isIndividual {
                rows.append(model.text("个人额度，非公司总余额"))
                if let total = window.total, let used = window.amountUsed, total.isFinite, used.isFinite {
                    rows.append(model.text("已用 %@ / %@", String(used), String(total)))
                }
            }
        }
        if let at = model.snapshot.observedAt, at.isFinite {
            rows.append(model.text("更新时间：%@", Date(timeIntervalSince1970: at/1000).formatted(date: .abbreviated, time: .standard)))
        }
        if let error = model.snapshot.error { rows.append(error) }
        return rows.joined(separator: "\n")
    }
    private func quotaStyle(_ window: QuotaWindow, now: Date, phase: Double) -> AnyShapeStyle {
        if window.expired(at: now) { return AnyShapeStyle(Color(hex: "95889F")) }
        if window.remaining <= 10 { return AnyShapeStyle(Color(hex: "B74839")) }
        if window.remaining <= 25 { return AnyShapeStyle(Color(hex: "A06C1C")) }
        return style("accent", phase: phase)
    }
    private func style(_ role: String, phase: Double) -> AnyShapeStyle {
        let theme = model.profile.bubbleTheme
        if role == "surface" { return AnyShapeStyle(Color(hex: theme.surface)) }
        let flowing = model.colorScope == .full || (model.colorScope == .text && role == "ink")
        if role == "ink" && !flowing { return AnyShapeStyle(ink) }
        let colors = role == "ink" ? theme.flowingInk : theme.accents
        if colors.count == 1 { return AnyShapeStyle(Color(hex: colors[0])) }
        return AnyShapeStyle(LinearGradient(colors: colors.map { Color(hex: $0) }, startPoint: flowing ? UnitPoint(x: -phase, y: 0) : .topLeading, endPoint: flowing ? UnitPoint(x: 1-phase, y: 1) : .bottomTrailing))
    }
    private func characterFlow(phase: Double) -> AnyShapeStyle {
        let colors = Appearance.palette(for: model.message ?? "", rainbow: model.colorMode == .rainbow || model.message == nil)
        let loop = Array(colors.dropLast())
        let repeated = loop + loop + loop + [colors.last!]
        let stops = repeated.enumerated().map { index, hex in Gradient.Stop(color: Color(hex: hex), location: Double(index) / Double(repeated.count - 1)) }
        return AnyShapeStyle(LinearGradient(gradient: Gradient(stops: stops), startPoint: UnitPoint(x: -1 - phase, y: 0.5), endPoint: UnitPoint(x: 2 - phase, y: 0.5)))
    }
    private func animateBubble(_ opening: Bool) {
        animationGeneration += 1; sceneGeneration += 1
        let generation = animationGeneration
        if reduceMotion { near = opening ? 1 : 0; tail = near; cloud = near; text = near; return }
        if opening {
            displayedMessage = model.message
            near = 0; tail = 0; cloud = 0; text = 0
            for (delay, part) in [(0.0, 0), (0.13, 1), (0.26, 2), (0.36, 3)] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    guard generation == animationGeneration, model.bubble else { return }
                    withAnimation(part == 3 ? .timingCurve(0.25, 0.1, 0.25, 1, duration: 0.16) : ease) {
                        switch part { case 0: near = 1; case 1: tail = 1; case 2: cloud = 1; default: text = 1 }
                    }
                }
            }
        } else {
            withAnimation(.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.16)) { text = 0 }
            for (delay, part) in [(0.1, 2), (0.2, 1), (0.3, 0)] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    guard generation == animationGeneration, !model.bubble else { return }
                    withAnimation(.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.18)) {
                        switch part { case 0: near = 0; case 1: tail = 0; default: cloud = 0 }
                    }
                }
            }
        }
    }
}

private struct RollingBalanceText: View {
    let value: Double
    let currency: String
    var body: some View {
        let text = (currency == "CNY" ? "¥" : "$ ") + String(format: abs(value) < 1 && value != 0 ? "%.4f" : "%.2f", value)
        if #available(macOS 14.0, *) {
            Text(text).contentTransition(.numericText(value: value)).animation(.easeInOut(duration: 0.45), value: value)
        } else { Text(text) }
    }
}

private extension Color {
    init(hex: String, role: String = "accent") {
        let value = UInt64(hex, radix: 16) ?? 0
        var components = [Double((value >> 16) & 255), Double((value >> 8) & 255), Double(value & 255)].map { $0 / 255 }
        let other = role == "surface" ? [1.0, 1, 1] : [39.0 / 255, 25.0 / 255, 56.0 / 255]
        let amount = role == "surface" ? 0.92 : role == "ink" ? 0.44 : 0
        for index in 0..<3 { components[index] = components[index] * (1 - amount) + other[index] * amount }
        self.init(red: components[0], green: components[1], blue: components[2])
    }
}
