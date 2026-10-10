using System.Windows;
using System.Windows.Controls;

namespace AgentDeskNative.Windows;

public partial class DiscoveredCard : UserControl
{
    public DiscoveredCard()
    {
        InitializeComponent();
    }

    private void Choose(object sender, RoutedEventArgs e) => ViewMenus.Discovered((Button)sender);
}