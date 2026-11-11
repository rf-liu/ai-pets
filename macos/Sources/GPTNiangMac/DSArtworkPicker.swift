import SwiftUI

struct DSArtworkPicker: View {
    @ObservedObject var model: WidgetModel
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("角色外观", selection: $model.selectedSkin) {
                Text("互动眨眼 · 8 张表情").tag("ds-desktop-auto")
                ForEach(0..<CompanionProfile.dsExpressions.count, id: \.self) { index in
                    let option = CompanionProfile.dsExpressions[index]
                    Text(option.name).tag("ds-desktop-" + option.id)
                }
                Text("旧版立绘（未补齐）").tag("default")
            }
            Toggle("使用仓库原图", isOn: $model.dsUseOriginalArtwork)
            Text(model.dsUseOriginalArtwork ? "使用未补齐右耳的原图。自动眨眼、按住摸头；可固定表情。" : "已统一补齐右耳与侧发的 8 张表情。自动眨眼、按住摸头；可固定表情。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text("连续点击（每次间隔不超过 1 秒）从第 \(model.randomExpressionStartTap) 次起随机显示 10 种表情，包含两版微笑；停点约 1.5 秒后恢复。害羞不在随机池内。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(0..<CompanionProfile.dsExpressions.count, id: \.self) { index in
                    let option = CompanionProfile.dsExpressions[index]
                    let skin = "ds-desktop-" + option.id
                    Button { model.selectedSkin = skin } label: {
                        VStack(spacing: 3) {
                            if let image = model.artwork(for: skin) {
                                Image(nsImage: image).resizable().interpolation(.high).scaledToFit().frame(height: 70)
                            }
                            Text(option.name).font(.caption)
                        }.frame(maxWidth: .infinity).padding(5)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(model.selectedSkin == skin ? Color.accentColor : .clear, lineWidth: 2))
                    }.buttonStyle(.plain).accessibilityLabel("DS 表情：" + option.name)
                }
            }
        }
    }
}
