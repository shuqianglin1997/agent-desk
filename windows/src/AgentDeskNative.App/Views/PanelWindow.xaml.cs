using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;

namespace AgentDeskNative.Windows;

public partial class Panel : Window, IDisposable
{
    public PanelModel Model
    {
        get;
    }

    private readonly ThemeManager theme;
    private readonly Hotkey? hotkey;
    private PetWindow? pet;
    private bool disposed, followsPet, settling;
    private readonly bool keepOpen;
    private DateTimeOffset lastHidden;
    public event Action<string>? BackgroundError;
    public Panel(Store state, ThemeManager themes, bool demo, bool keep, bool inspection)
    {
        theme = themes;
        keepOpen = keep;
        Model = new PanelModel(state, demo);
        InitializeComponent();
        DataContext = Model;
        ShowInTaskbar = keep || inspection;
        Icon = Brand.Image();
        Model.ConfigurationChanged = UpdatePet;
        Model.RequestHide = Hide;
        Model.Prompt = (title, value) => InlineDialog.Ask(this, title, value);
        Model.Confirm = text => InlineDialog.Confirm(this, text);
        Model.ConfirmDelete = account => InlineDialog.Delete(this, account);
        Model.BackgroundError += value =>
        {
            if (!IsVisible)
                BackgroundError?.Invoke(value);
        };
        Deactivated += (_, _) => Dispatcher.BeginInvoke(() =>
        {
            if (!IsActive && !Model.Interacting && !Model.Sorting && !keepOpen && pet?.IsMouseOver != true)
                Hide();
        }, DispatcherPriority.Background);
        IsVisibleChanged += (_, _) =>
        {
            if (!IsVisible)
                lastHidden = DateTimeOffset.UtcNow;
            Model.SetVisible(IsVisible, pet?.IsVisible == true);
        };
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape)
            {
                var dialog = OwnedWindows.OfType<InlineDialog>().FirstOrDefault(d => d.IsVisible);
                if (dialog != null)
                    dialog.Cancel();
                else if (!Model.Interacting)
                    Hide();
                e.Handled = true;
            }
        };
        Closing += (_, e) =>
        {
            if (!disposed)
            {
                e.Cancel = true;
                Hide();
            }
        };
        SourceInitialized += (_, _) => ApplyTheme();
        theme.Changed += ApplyTheme;
        if (!demo)
        {
            hotkey = new Hotkey(this, TogglePanel);
            if (!hotkey.Registered)
                Model.Notify("Ctrl+Alt+P 已被其他程序占用；仍可从托盘打开。");
        }

        UpdatePet();
        Loaded += async (_, _) => await Model.Start();
    }

    private void ApplyTheme()
    {
        bool acrylic = OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000);
        Background = acrylic ? Brushes.Transparent : (Brush)FindResource("PanelFill");
        // Dark acrylic alone reads as flat grey; a denser tint keeps it close to Windows 11 dark flyouts.
        Backdrop.Opacity = !acrylic ? 1 : theme.Name == "Dark" ? .82 : .35;
        Model.UseDarkIcons(theme.Name != "Light");
        if (new System.Windows.Interop.WindowInteropHelper(this).Handle != 0)
            NativeWindow.Apply(this, theme.Name != "Light");
        pet?.Configure();
    }

    private void UpdatePet()
    {
        var p = Model.Store.Preferences;
        bool petWasVisible = pet?.IsVisible == true;
        if (p.PetEnabled && p.PetVisible)
        {
            if (pet == null)
            {
                pet = new PetWindow(Model.Store, ToggleFromPet, () => Model.Run(async () =>
                {
                    var busy = Model.BusyAccount;
                    if (busy != null && !Model.Demo)
                        await Model.Clients.Open(busy);
                }), ShowInTaskbar);
                pet.LocationChanged += (_, _) =>
                {
                    if (IsVisible && followsPet && !settling)
                        PositionPanel();
                };
                pet.IsVisibleChanged += (_, _) => Model.SetVisible(IsVisible, pet.IsVisible);
            }

            pet.Configure();
            if (!pet.IsVisible)
                pet.Show();
        }
        else
            pet?.Hide();
        if (IsVisible && pet?.IsVisible == true)
        {
            // A pet that appears while the panel is open must not land on top of it.
            if (!petWasVisible)
                PositionPanel();
            // A pet that changes size keeps the panel still and resettles beside it.
            else if (followsPet || PanelPlacement.Overlaps(NativeWindow.Rectangle(this), NativeWindow.Rectangle(pet)))
                SettlePetBesidePanel();
        }
        Model.SetVisible(IsVisible, pet?.IsVisible == true);
    }

    public void TrayToggle()
    {
        if (DateTimeOffset.UtcNow - lastHidden < TimeSpan.FromMilliseconds(400))
            return;
        TogglePanel();
    }

    public void TogglePanel()
    {
        if (IsVisible)
            Hide();
        else
            OpenPanel();
    }

    private void ToggleFromPet()
    {
        if (IsVisible)
            Hide();
        else
        {
            followsPet = true;
            ShowPanel();
        }
    }

    public void OpenPanel()
    {
        followsPet = false;
        ShowPanel();
    }

    private void ShowPanel()
    {
        PositionPanel();
        Show();
        Activate();
        Model.Opened();
    }

    private void PositionPanel()
    {
        bool petShown = pet?.IsVisible == true;
        bool attached = followsPet && petShown;
        var area = NativeWindow.Area(attached ? pet : null);
        double scale = NativeWindow.Scale(area);
        var placed = PanelPlacement.Compute(area, attached ? NativeWindow.Rectangle(pet!) : null, Width * scale, Height * scale, 12 * scale);
        if (!attached && petShown && PanelPlacement.Overlaps(placed, NativeWindow.Rectangle(pet!)))
        {
            // Opened from the tray or hotkey while the pet sits in that corner: sit beside the pet instead.
            followsPet = true;
            area = NativeWindow.Area(pet);
            scale = NativeWindow.Scale(area);
            placed = PanelPlacement.Compute(area, NativeWindow.Rectangle(pet!), Width * scale, Height * scale, 12 * scale);
        }

        NativeWindow.Move(this, placed.X, placed.Y);
    }

    private void SettlePetBesidePanel()
    {
        var panel = NativeWindow.Rectangle(this);
        var petArea = NativeWindow.Area(pet);
        double petScale = NativeWindow.Scale(petArea), gap = 12 * NativeWindow.Scale(NativeWindow.Area(this));
        var current = NativeWindow.Rectangle(pet!);
        double width = pet!.Width * petScale, height = pet.Height * petScale;
        bool right = current.X + current.Width / 2 >= panel.X + panel.Width / 2;
        var wanted = new Bounds(right ? panel.Right + gap : panel.X - gap - width, panel.Bottom - height, width, height);
        var placed = PanelPlacement.ClampPet(wanted, NativeWindow.Screens());
        if (PanelPlacement.Overlaps(placed, panel) && !right)
            placed = PanelPlacement.ClampPet(wanted with { X = panel.Right + gap }, NativeWindow.Screens());
        settling = true;
        try
        {
            pet.MoveTo(placed.X, placed.Y);
        }
        finally
        {
            settling = false;
        }

        followsPet = true;
        // Only when the screen edge leaves no room beside the panel does the panel move.
        if (PanelPlacement.Overlaps(NativeWindow.Rectangle(pet), panel))
            PositionPanel();
    }

    public void TogglePet() => Model.TogglePet.Execute(null);
    public void ResetPet() => pet?.ResetPosition();

    public void Capture(string directory, int dpi = 96)
    {
        Directory.CreateDirectory(directory);
        SaveImage(this, Path.Combine(directory, $"{theme.Name.ToLowerInvariant()}-{Model.Page}.png"), dpi);
        if (pet?.IsVisible == true)
            SaveImage(pet, Path.Combine(directory, $"{theme.Name.ToLowerInvariant()}-pet.png"), dpi);
    }
    public void DemoScroll(double offset)
    {
        if (!Model.Demo)
            return;
        accountsView.ScrollToVerticalOffset(offset);
        accountsView.UpdateLayout();
    }

    internal static void SaveImage(FrameworkElement view, string path, int dpi)
    {
        view.UpdateLayout();
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(view.ActualWidth * dpi / 96), (int)Math.Ceiling(view.ActualHeight * dpi / 96), dpi, dpi, PixelFormats.Pbgra32);
        bitmap.Render(view);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(path);
        encoder.Save(file);
    }

    public void Dispose()
    {
        disposed = true;
        hotkey?.Dispose();
        theme.Changed -= ApplyTheme;
        Model.Dispose();
        pet?.Close();
        Close();
    }
}
