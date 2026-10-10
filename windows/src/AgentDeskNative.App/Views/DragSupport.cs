using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;

namespace AgentDeskNative.Windows;

public static class DragSupport
{
    public static readonly DependencyProperty EnabledProperty = DependencyProperty.RegisterAttached("Enabled", typeof(bool), typeof(DragSupport), new PropertyMetadata(false, Enable));
    public static readonly DependencyProperty TargetProperty = DependencyProperty.RegisterAttached("Target", typeof(bool), typeof(DragSupport), new PropertyMetadata(false, TargetChanged));
    public static bool GetEnabled(DependencyObject value) => (bool)value.GetValue(EnabledProperty);
    public static void SetEnabled(DependencyObject value, bool enabled) => value.SetValue(EnabledProperty, enabled);
    public static bool GetTarget(DependencyObject value) => (bool)value.GetValue(TargetProperty);
    public static void SetTarget(DependencyObject value, bool enabled) => value.SetValue(TargetProperty, enabled);
    private static PanelModel? Model(object? item) => item switch
    {
        GroupModel g => g.Owner,
        AccountModel a => a.Owner,
        SessionModel s => s.Account.Owner,
        _ => null
    };
    private const string Format = "AgentDeskNative.LocalOrder";
    private static void Enable(DependencyObject value, DependencyPropertyChangedEventArgs e)
    {
        if (value is not FrameworkElement element || !(bool)e.NewValue)
            return;
        Point start = default;
        bool armed = false;
        element.PreviewMouseLeftButtonDown += (_, args) =>
        {
            start = args.GetPosition(element);
            armed = true;
        };
        element.PreviewMouseLeftButtonUp += (_, _) => armed = false;
        element.PreviewMouseMove += (_, args) =>
        {
            var model = Model(element.DataContext);
            if (!armed || model == null || model.Sorting || args.LeftButton != MouseButtonState.Pressed)
                return;
            var point = args.GetPosition(element);
            if (Math.Abs(point.X - start.X) < SystemParameters.MinimumHorizontalDragDistance && Math.Abs(point.Y - start.Y) < SystemParameters.MinimumVerticalDragDistance)
                return;
            armed = false;
            model.Sorting = true;
            args.Handled = true;
            try
            {
                DragDrop.DoDragDrop(element, new DataObject(Format, element.DataContext), DragDropEffects.Move);
            }
            finally
            {
                model.Sorting = false;
                Mouse.Capture(null);
                model.MergeAccounts();
            }
        };
    }

    private static bool Compatible(object? source, object? target) => (source, target) switch
    {
        (GroupModel, GroupModel) => true,
        (AccountModel a, AccountModel b) => a.Value.App == b.Value.App,
        (SessionModel a, SessionModel b) => a.Account.Value.Id == b.Account.Value.Id,
        _ => false
    };
    private sealed class LineAdorner(UIElement element) : Adorner(element)
    {
        protected override void OnRender(DrawingContext drawing) => drawing.DrawRectangle((Brush)Application.Current.FindResource("Accent"), null, new Rect(0, 0, AdornedElement.RenderSize.Width, 2));
    }

    private static void TargetChanged(DependencyObject value, DependencyPropertyChangedEventArgs e)
    {
        if (value is not FrameworkElement element || !(bool)e.NewValue)
            return;
        element.AllowDrop = true;
        LineAdorner? line = null;
        void Clear()
        {
            if (line != null)
                AdornerLayer.GetAdornerLayer(element)?.Remove(line);
            line = null;
        }

        element.DragOver += (_, args) =>
        {
            if (!Compatible(args.Data.GetData(Format), element.DataContext))
                return;
            args.Effects = DragDropEffects.Move;
            args.Handled = true;
            if (line == null && AdornerLayer.GetAdornerLayer(element) is { } layer)
            {
                line = new LineAdorner(element)
                {
                    IsHitTestVisible = false
                };
                layer.Add(line);
            }
        };
        element.DragLeave += (_, _) => Clear();
        element.Drop += (_, args) =>
        {
            Clear();
            var source = args.Data.GetData(Format);
            var target = element.DataContext;
            if (!Compatible(source, target) || ReferenceEquals(source, target))
                return;
            args.Handled = true;
            var model = Model(target)!;
            if (source is GroupModel fromGroup && target is GroupModel toGroup)
                Ordering.MoveBefore(model.Store.Preferences.GroupOrder, fromGroup.App, toGroup.App);
            else if (source is AccountModel fromAccount && target is AccountModel toAccount)
            {
                Ordering.MoveBefore(model.Store.Accounts, fromAccount.Value, toAccount.Value);
            }
            else if (source is SessionModel fromSession && target is SessionModel toSession)
            {
                var account = fromSession.Account;
                var ids = account.Active.Concat(account.Recent).Select(s => s.Value.Id).Concat(model.Store.Preferences.SessionOrder.GetValueOrDefault(account.Value.Id) ?? []).Distinct().ToList();
                Ordering.MoveBefore(ids, fromSession.Value.Id, toSession.Value.Id);
                model.Store.Preferences.SessionOrder[account.Value.Id] = ids;
            }

            model.Store.Save();
        };
    }
}