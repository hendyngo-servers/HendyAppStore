using System.Diagnostics;
using System.Windows;

namespace HendyAppStore;
public partial class MainWindow : Window
{
    private const string StoreUrl = "https://hendy-app-store.pages.dev/";

    public MainWindow() { InitializeComponent(); }

    private void OpenStore_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo(StoreUrl) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show("Không thể mở trình duyệt mặc định. " + ex.Message, "Hendy App Store", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }
}
