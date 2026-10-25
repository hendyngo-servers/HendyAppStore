import SwiftUI

struct ContentView: View {
    private let storeURL = URL(string: "https://hendy-app-store.pages.dev/")!
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.035, green: 0.07, blue: 0.14), Color(red: 0.08, green: 0.15, blue: 0.26)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Text("H").font(.system(size: 30, weight: .black)).foregroundStyle(Color(red: 0.02, green: 0.1, blue: 0.16)).frame(width: 54, height: 54).background(Color(red: 0.33, green: 0.9, blue: 0.76), in: RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading) {
                        Text("Hendy App Store").font(.title2.bold()).foregroundStyle(.white)
                        Text("Verified release portal").font(.subheadline).foregroundStyle(.white.opacity(0.6))
                    }
                }
                Spacer()
                Text("Tất cả bản phát hành của bạn.").font(.largeTitle.bold()).foregroundStyle(.white)
                Text("Mở kho phần mềm chính thức để xem phiên bản, checksum và tải xuống khi artifact đã sẵn sàng.").font(.body).foregroundStyle(.white.opacity(0.7))
                Button { openURL(storeURL) } label: {
                    Label("Mở Hendy Store", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity).padding()
                }.buttonStyle(.borderedProminent).tint(Color(red: 0.33, green: 0.9, blue: 0.76)).foregroundStyle(Color(red: 0.02, green: 0.1, blue: 0.16))
                Text("Ứng dụng mở cổng HTTPS; việc cài ứng dụng iOS qua OTA vẫn cần manifest, chữ ký và hồ sơ cấp phép Apple hợp lệ.").font(.footnote).foregroundStyle(.white.opacity(0.5))
                Spacer()
            }.padding(28)
        }
    }
}
