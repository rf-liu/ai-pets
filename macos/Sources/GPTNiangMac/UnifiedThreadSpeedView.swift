import SwiftUI

struct UnifiedThreadSpeedView: View {
    let profile: CompanionProfile
    @ObservedObject var store: ThreadSpeedStore
    @ObservedObject var model: WidgetModel
    let onSelection: (CompanionProfile) -> Void
    var body: some View {
        VStack(spacing: 0) {
            Picker("切换 AI 速度", selection: Binding(get: { profile }, set: onSelection)) {
                ForEach(CompanionProfile.allCases) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented).labelsHidden().padding(.horizontal,22).padding(.top,14).padding(.bottom,8)
            ThreadSpeedView(store: store, model: model)
        }.frame(width:620,height:726)
    }
}
