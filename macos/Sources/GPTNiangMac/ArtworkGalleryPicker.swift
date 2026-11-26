import SwiftUI

struct ArtworkGalleryPicker: View {
    @ObservedObject var model: WidgetModel
    private let columns4 = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)

    var body: some View {
        switch model.profile {
        case .gpt:
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("龙娘表情画廊（点选可固定常驻）").font(.subheadline.weight(.medium))
                    Spacer()
                    if model.selectedSkin != "default" {
                        Button("恢复日常") { model.selectedSkin = "default" }.font(.caption)
                    }
                }
                Text("共 8 张表情；长按本体约 0.25 秒可摸头，短按点击出气泡并同步切换情绪表情，未点击时保持静止。")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                galleryGrid(items: CompanionProfile.gptGalleryItems, thumbHeight: 58)
            }

        case .gemini:
            VStack(alignment: .leading, spacing: 10) {
                Picker("角色外观", selection: Binding(
                    get: { model.profile.isGeminiHD(skin: model.selectedSkin) ? "gemini-hd" : "default" },
                    set: { model.selectedSkin = $0 }
                )) {
                    Text("Gemini 仓库猫娘（8 表情）").tag("gemini-hd")
                    Text("原猫娘").tag("default")
                }
                if model.profile.isGeminiHD(skin: model.selectedSkin) {
                    HStack {
                        Text("猫娘表情画廊（点选可固定常驻）").font(.subheadline.weight(.medium))
                        Spacer()
                        if model.selectedSkin != "gemini-hd" {
                            Button("恢复日常") { model.selectedSkin = "gemini-hd" }.font(.caption)
                        }
                    }
                    Text("长按本体约 0.25 秒呼噜摸头，短按点击同步联动星星眼、反重力慌张等表情，未点击时保持静止。")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    galleryGrid(items: CompanionProfile.geminiHDGalleryItems, thumbHeight: 58)
                }
            }

        case .claude:
            VStack(alignment: .leading, spacing: 10) {
                Picker("角色外观", selection: Binding(
                    get: {
                        if model.profile.isClaudia(skin: model.selectedSkin) { return "claudia" }
                        if model.selectedSkin == "claude-original" { return "claude-original" }
                        return "claude-bust"
                    },
                    set: { model.selectedSkin = $0 }
                )) {
                    Text("Claudia 社区版（16 表情）").tag("claudia")
                    Text("旧版抱书半身像").tag("claude-bust")
                    Text("初版原图").tag("claude-original")
                }
                if model.profile.isClaudia(skin: model.selectedSkin) {
                    HStack {
                        Text("小克表情画廊（点选可固定常驻）").font(.subheadline.weight(.medium))
                        Spacer()
                        if model.selectedSkin != "claudia" {
                            Button("恢复日常") { model.selectedSkin = "claudia" }.font(.caption)
                        }
                    }
                    Text("源自 CrossPet / claudia-pet（CC BY-NC-SA 4.0）：长按摸头抱 Clawd 抱枕，完成提醒戴橙花王冠，短按语录同步配对表情，未点击时不主动变化。")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    let items = CompanionProfile.claudiaExpressions.map {
                        (skin: $0.id == "idle" ? "claudia" : "claudia-expr:" + $0.id, name: $0.name)
                    }
                    galleryGrid(items: items, thumbHeight: 56)
                }
            }

        case .deepseek:
            DSArtworkPicker(model: model)
        }
    }

    @ViewBuilder
    private func galleryGrid(items: [(skin: String, name: String)], thumbHeight: CGFloat) -> some View {
        LazyVGrid(columns: columns4, spacing: 6) {
            ForEach(0..<items.count, id: \.self) { index in
                let item = items[index]
                let selected = model.selectedSkin == item.skin
                Button { model.selectedSkin = item.skin } label: {
                    VStack(spacing: 3) {
                        if let image = model.galleryThumbnail(for: item.skin) {
                            Image(nsImage: image).resizable().interpolation(.high).scaledToFit().frame(height: thumbHeight)
                        }
                        Text(item.name).font(.caption2).lineLimit(1).minimumScaleFactor(0.8)
                    }.frame(maxWidth: .infinity).padding(5)
                        .background(selected ? Color.accentColor.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(selected ? Color.accentColor : .clear, lineWidth: 2))
                }.buttonStyle(.plain).accessibilityLabel(model.profile.title + " 表情：" + item.name)
            }
        }
    }
}
