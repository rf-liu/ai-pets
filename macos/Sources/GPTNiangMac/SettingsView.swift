import SwiftUI
import ServiceManagement
import GPTNiangCore

struct SettingsView: View {
    @ObservedObject var model: WidgetModel
    var onProfileSelection: (CompanionProfile) -> Void = { _ in }
    @State private var loginError: String?

    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 18) {
            Picker(model.text("切换宠物设置"), selection: Binding(get: { model.profile }, set: { onProfileSelection($0) })) {
                ForEach(CompanionProfile.allCases) { profile in Text(profile.title).tag(profile) }
            }.pickerStyle(.segmented)
            HStack(alignment: .firstTextBaseline) {
                Text(model.profile.petName).font(.system(size: 27, weight: .semibold, design: .rounded))
                Text("macOS · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "本机版")").font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
            Text(model.text(model.profile.slogan)).foregroundStyle(.secondary)
            clickExpressionSettings
            languageSettings
            appearanceSettings
            colorSettings
            quoteSettings
            if let error = model.settingsError { Text(error).font(.caption).foregroundStyle(.orange) }
            HStack {
                Button(model.text("開啟資料目錄")) { NSWorkspace.shared.open(model.dataDirectory) }
                Spacer()
                Button(model.text("重設位置")) { model.resetPosition() }
                if model.profile.quotaEnabled { Button(model.text("刷新額度")) { model.refresh() } }
            }
            Text(model.profile.quotaEnabled ? "额度可见时每 60 秒更新。使用目前 \(model.profile.hostName) 登录，不建立聊天或调用模型。" : "点击直接显示语录，不查询额度。保留 Code 对话的 TPS 与回复结束提醒。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(24) }.frame(width: 500, height: 700)
        .onChange(of: model.language) { _ in model.savePreferences() }
        .onChange(of: model.selectedSkin) { _ in model.reloadCharacter() }
        .onChange(of: model.dsUseOriginalArtwork) { _ in model.reloadCharacter() }
        .onChange(of: model.desktopTopmost) { _ in model.savePreferences() }
        .onChange(of: model.soundOn) { _ in model.audio.updateVolume(); model.savePreferences() }
        .onChange(of: model.hideMenu) { _ in model.savePreferences() }
        .onChange(of: model.completionEnabled) { _ in model.savePreferences() }
        .onChange(of: model.scale) { _ in model.savePreferences() }
        .onChange(of: model.volume) { _ in model.audio.updateVolume(); model.savePreferences() }
        .onChange(of: model.colorMode) { _ in model.updateAppearance(); model.savePreferences() }
        .onChange(of: model.fullChance) { _ in model.updateAppearance(); model.savePreferences() }
        .onChange(of: model.textChance) { _ in model.updateAppearance(); model.savePreferences() }
        .onChange(of: model.colorPaused) { _ in model.savePreferences() }
        .onChange(of: model.specialQuotes) { _ in model.updateAppearance(); model.savePreferences() }
        .onChange(of: model.bubbleTapAdvance) { _ in model.savePreferences() }
        .onChange(of: model.followCodex) { _ in model.savePreferences() }
    }

    private var clickExpressionSettings: some View {
        GroupBox(model.text("点击表情")) {
            VStack(alignment: .leading, spacing: 10) {
                Picker(model.text("第几次点击开始随机"), selection: Binding(get: { model.randomExpressionStartTap }, set: { model.setRandomExpressionStartTap($0) })) {
                    ForEach(1...10, id: \.self) { value in Text(model.text("第 %@ 次", String(value))).tag(value) }
                }
                HStack {
                    Text(model.text("仅修改当前宠物的连续点击次数。"))
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(model.text("恢复默认（第 3 次）")) { model.setRandomExpressionStartTap(3) }
                        .disabled(model.randomExpressionStartTap == 3)
                }
                Text(model.text("相邻点击间隔不超过 1 秒算连续点击，停止约 1.5 秒后恢复。每只 AI 独立保存；修改次数后重新计数。"))
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if model.profile == .gemini && model.selectedSkin != "gemini-hd" {
                    Text(model.text("旧版 Gemini 皮肤仍使用自己的微笑，切回高清皮肤后应用随机表情设置。"))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.padding(10)
        }
    }

    private var languageSettings: some View {
            GroupBox(model.text("界面语言")) {
                VStack(alignment: .leading, spacing: 10) {
                    Picker(model.text("界面语言"), selection: $model.language) {
                        ForEach(InterfaceLanguage.allCases, id: \.self) { Text(model.text($0.title)).tag($0) }
                    }
                }.padding(10)
            }
    }

    private var appearanceSettings: some View {
            GroupBox(model.text("外觀與顯示")) {
                VStack(alignment: .leading, spacing: 14) {
                    if model.profile == .gemini {
                        Picker("角色外观", selection: $model.selectedSkin) {
                            Text("Gemini 仓库猫娘").tag("gemini-hd")
                            Text("原猫娘").tag("default")
                        }
                    }
                    if model.profile == .deepseek { DSArtworkPicker(model: model) }
                    HStack {
                        ForEach([0.8, 1.0, 1.4], id: \.self) { value in
                            Button("\(Int(value * 100))%") { model.scale = value }
                        }
                    }
                    Toggle(model.text("提示音"), isOn: $model.soundOn)
                    WidgetAudioMenu(audio: model.audio)
                    Toggle(model.text("隐藏设置按钮"), isOn: $model.hideMenu)
                    HStack { Text(model.text("角色大小")).frame(width: 70, alignment: .leading); Slider(value: $model.scale, in: 0.6...2.5, step: 0.1); Text("\(Int(model.scale * 100))% ").monospacedDigit().frame(width: 48) }
                    HStack { Text(model.text("提示音量")).frame(width: 70, alignment: .leading); Slider(value: $model.volume, in: 0...1); Text(model.volume == 0 ? model.text("靜音") : "\(Int(model.volume * 100))% ").frame(width: 48) }
                    Picker(model.text("显示与位置"), selection: $model.followCodex) {
                        Text("仅在 \(model.profile.hostName) 窗口内").tag(true)
                        Text(model.text("整个桌面自由拖动")).tag(false)
                    }.pickerStyle(.radioGroup)
                    if !model.followCodex { Toggle(model.text("始终置顶"), isOn: $model.desktopTopmost) }
                    Text("关闭后，挂件会固定在桌面；开启时，\(model.profile.hostName) 隐藏或最小化后挂件也会隐藏。")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if let note = model.trackingNote { Text(note).font(.caption).foregroundStyle(.orange) }
                    Toggle(model.text("回答结束提醒"), isOn: $model.completionEnabled)
                    Text(model.profile == .deepseek ? "回复完成提醒使用温和微笑，点击返回后保持约 1.5 秒；按住摸头，连点可随机换表情。" : "普通点击有微笑反馈，连点达到设定次数后随机换脸；点击完成提醒返回后保持开心表情约 1.5 秒。")
                        .font(.caption).foregroundStyle(.secondary)
                    if model.profile == .gemini {
                        Text(model.text("Gemini 僅在本輪正常最終回覆已核對且狀態穩定後提醒；等待工具、確認或子任務時不提醒，同一輪只提醒一次。"))
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    Toggle(model.text("登入 Mac 時自動開啟"), isOn: $model.loginRequested)
                        .onChange(of: model.loginRequested) { value in
                            do {
                                try UnifiedStartup.setEnabled(value)
                                model.savePreferences()
                                loginError = nil
                                if UnifiedStartup.service.status == .requiresApproval { loginError = model.text("请在系统设置的「登录项」允许 AI额度挂件。") }
                            } catch { loginError = model.text("登入項目設定失敗：%@", String(describing: error.localizedDescription)) }
                        }
                    if let loginError { Text(loginError).font(.caption).foregroundStyle(.orange) }
                }.padding(10)
            }
    }

    private var colorSettings: some View {
            GroupBox(model.text("原版流光效果")) {
                VStack(alignment: .leading, spacing: 10) {
                    Picker(model.text("配色模式"), selection: $model.colorMode) {
                        ForEach(ColorMode.allCases, id: \.self) { Text(model.text($0.title)).tag($0) }
                    }
                    Toggle(model.text("暫停流光"), isOn: $model.colorPaused)
                    HStack { Text(model.text("全身變色機率")); Slider(value: $model.fullChance, in: 0...100); Text(String(format: "%.1f%%", model.fullChance)).frame(width: 55) }
                    HStack { Text(model.text("僅文字變色機率")); Slider(value: $model.textChance, in: 0...100); Text(String(format: "%.1f%%", model.textChance)).frame(width: 55) }
                    TextField(model.text("特殊語錄（以換行分隔）"), text: $model.specialQuotes)
                    Text(model.profile.quotaEnabled ? model.text("點擊先看額度；額度顯示時再點換語錄，繼續點換一句。") : "点一下显示语录，继续点击换一句。")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(10)
            }
    }

    private var quoteSettings: some View {
            GroupBox(model.text("自訂語錄 · 每行一則")) {
                VStack(alignment: .leading, spacing: 10) {
                    TextEditor(text: $model.quoteText).font(.system(size: 13)).frame(height: 145)
                        .scrollContentBackground(.hidden).padding(4)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                    HStack {
                        Button(model.text("還原內建語錄")) { model.resetQuotes() }
                        Spacer()
                        Button(model.text("儲存語錄")) { model.saveQuotes() }.buttonStyle(.borderedProminent)
                    }
                }.padding(10)
            }
    }
}
