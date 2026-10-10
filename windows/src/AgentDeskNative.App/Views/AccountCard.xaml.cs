using System.Windows;
using System.Windows.Controls;

namespace AgentDeskNative.Windows;

public partial class AccountCard : UserControl
{
    public AccountCard()
    {
        InitializeComponent();
        ContextMenu = new ContextMenu();
    }

    // Trim the name to its column, leaving room for the running dot beside it.
    private void NameCellSized(object sender, SizeChangedEventArgs e) => NameText.MaxWidth = System.Math.Max(0, e.NewSize.Width - 17);

    private void AccountMenu(object sender, ContextMenuEventArgs e) => ViewMenus.Account((FrameworkElement)sender, e);
}