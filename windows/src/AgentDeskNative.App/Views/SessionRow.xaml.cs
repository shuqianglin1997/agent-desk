using System.Windows;
using System.Windows.Controls;

namespace AgentDeskNative.Windows;

public partial class SessionRow : UserControl
{
    public SessionRow()
    {
        InitializeComponent();
        ContextMenu = new ContextMenu();
    }

    private void SessionMenu(object sender, ContextMenuEventArgs e) => ViewMenus.Session((FrameworkElement)sender, e);
}