import SwiftUI

struct DSArtworkPicker: View {
    @ObservedObject var model: WidgetModel
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker("角色外观", selection: $model.selectedSkin) {
                    Text("互动模式 · 8 张表情").tag("ds-desktop-auto")
                    ForEach(0..<CompanionProfile.dsExpressions.count, id: \.self) { index in
                        let option = CompanionProfile.dsExpressions[index]
                        Text(option.name).tag("ds-desktop-" + option.id)
                    }
                    Text("旧版立绘（未补齐）").tag("default")
                }
                if model.selectedSkin != "ds-desktop-auto" {
                    Button("恢复互动") { model.selectedSkin = "ds-desktop-auto" }.font(.caption)
                }
            }
            HStack(spacing: 16) {
                Toggle("使用仓库原图", isOn: $model.dsUseOriginalArtwork)
                if model.selectedSkin == "ds-desktop-auto" {
                    Toggle("待机自动眨眼（约 5 秒）", isOn: $model.dsAutoBlink)
                }
            }
            Text(model.dsUseOriginalArtwork
                 ? "使用未补齐右耳的原图；长按约 0.25 秒摸头，短按随气泡切换表情，默认待机静止。"
                 : "已统一补齐右耳与侧发的 8 张表情；长按约 0.25 秒摸头，短按随气泡切换表情，默认待机静止。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(0..<CompanionProfile.dsExpressions.count, id: \.self) { index in
                    let option = CompanionProfile.dsExpressions[index]
                    let skin = "ds-desktop-" + option.id
                    let selected = model.selectedSkin == skin || (model.selectedSkin == "ds-desktop-auto" && option.id == "main")
                    Button { model.selectedSkin = skin } label: {
                        VStack(spacing: 3) {
                            if let image = model.galleryThumbnail(for: skin) {
                                Image(nsImage: image).resizable().interpolation(.high).scaledToFit().frame(height: 58)
                            }
                            Text(option.name).font(.caption2).lineLimit(1).minimumScaleFactor(0.8)
                        }.frame(maxWidth: .infinity).padding(5)
                            .background(selected ? Color.accentColor.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(selected ? Color.accentColor : .clear, lineWidth: 2))
                    }.buttonStyle(.plain).accessibilityLabel("DS 表情：" + option.name)
                }
            }
        }
    }
}
