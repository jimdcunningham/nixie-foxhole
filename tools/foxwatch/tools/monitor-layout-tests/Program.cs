using FoxWatchMonitor;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        using var form = new MonitorForm(SystemIcons.Application);
        _ = form.Handle; // Layout only: never show the dashboard or start polling.
        foreach (var width in new[] { 900, 760, 1200, 760, 900 })
        {
            form.ClientSize = new Size(width, 560);
            for (var pass = 0; pass < 3; pass++) Layout(form);
            var root = (TableLayoutPanel)form.Controls[0];
            var footer = (TableLayoutPanel)root.GetControlFromPosition(0, 2)!;
            var maximumHeight = width == 760 ? 110 : 70;
            if (footer.Height > maximumHeight)
                throw new Exception($"Footer reserves {footer.Height}px at {width}px wide (maximum {maximumHeight})");
            var buttons = Descendants(footer).Where(control => control is Button or CheckBox).ToArray();
            if (buttons.Length != 7) throw new Exception("Footer controls are missing");
            foreach (var button in buttons)
            {
                var bounds = new Rectangle(button.Location, button.Size);
                for (var parent = button.Parent; parent != footer; parent = parent!.Parent)
                    bounds.Offset(parent!.Location);
                if (!footer.ClientRectangle.Contains(bounds))
                    throw new Exception($"Footer clips {button.Text} at {width}px wide: {bounds}");
            }
            Console.WriteLine($"Footer layout passed: {width}px wide, {footer.Height}px high, all seven controls visible");
        }
    }

    private static void Layout(Control control)
    {
        foreach (Control child in control.Controls) Layout(child);
        control.PerformLayout();
    }

    private static IEnumerable<Control> Descendants(Control control)
    {
        foreach (Control child in control.Controls)
        {
            yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }
}
