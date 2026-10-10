using System.Windows;

namespace AgentDeskNative.Windows;

public partial class InlineDialog : Window
{
    private InlineDialog(Window owner, string heading, string text, string? value = null, bool recycle = false)
    {
        InitializeComponent();
        Owner = owner;
        Title = heading;
        Heading.Text = heading;
        Description.Text = text;
        Input.Visibility = value == null ? Visibility.Collapsed : Visibility.Visible;
        Input.Text = value ?? "";
        Recycle.Visibility = recycle ? Visibility.Visible : Visibility.Collapsed;
        Loaded += (_, _) =>
        {
            if (value != null)
            {
                Input.Focus();
                Input.SelectAll();
            }
        };
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == System.Windows.Input.Key.Escape)
            {
                DialogResult = false;
                e.Handled = true;
            }
        };
    }

    private void Accept(object sender, RoutedEventArgs e) => DialogResult = true;
    public void Cancel() => DialogResult = false;
    public static string? Ask(Window owner, string heading, string value)
    {
        var dialog = new InlineDialog(owner, heading, "", value);
        return dialog.ShowDialog() == true ? dialog.Input.Text : null;
    }

    public static bool Confirm(Window owner, string text) => new InlineDialog(owner, "确认操作", text).ShowDialog() == true;
    public static (bool Confirm, bool Recycle) Delete(Window owner, Account account)
    {
        var dialog = new InlineDialog(owner, "移除账号“" + account.Name + "”？", "默认只移除 AgentDesk Native 记录，客户端数据将保留。\n" + account.ProfilePath, recycle: !account.Default);
        return (dialog.ShowDialog() == true, dialog.Recycle.IsChecked == true);
    }
}
