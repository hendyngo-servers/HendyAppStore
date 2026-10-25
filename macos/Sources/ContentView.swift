import SwiftUI

struct ContentView: View {
    private let storeURL = URL(string: "https://hendy-app-store.pages.dev/")!
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("H").font(.system(size: 24, weight: .black)).foregroundStyle(Color.black).frame(width: 46, height: 46).background(Color(red: 0.33, green: 0.9, blue: 0.76), in: RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading) {
                    Text("Hendy App Store").font(.title2.bold())
                    Text("macOS release portal").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("Phần mềm và bản phát hành, tập trung tại một nơi.").font(.largeTitle.bold())
            Text("Mở cổng Hendy Store để xem metadata, SHA-256 và các bản cài đặt đã phát hành.").foregroundStyle(.secondary)
            Button { openURL(storeURL) } label: { Label("Mở Hendy Store", systemImage: "arrow.up.right.square") }.buttonStyle(.borderedProminent).tint(Color(red: 0.33, green: 0.9, blue: 0.76))
            Text("Tệp DMG được đóng gói bởi CI. Ký Developer ID và notarization cần chứng chỉ Apple được cấu hình riêng.").font(.footnote).foregroundStyle(.secondary)
            Spacer()
        }.padding(30).frame(minWidth: 600, minHeight: 360).background(Color(red: 0.04, green: 0.07, blue: 0.13))
    }
}
