export function formatFileSize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, Math.abs(bytes))) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 0 })} ${units[unit]}`;
}

/** null is a missing file; zero is an existing empty file. */
export function compareFileSizes(before: number | null, after: number | null) {
  const delta = (after ?? 0) - (before ?? 0);
  const signed = `${delta < 0 ? '−' : delta > 0 ? '+' : ''}${formatFileSize(Math.abs(delta))}`;
  const exact = `${delta < 0 ? '−' : delta > 0 ? '+' : ''}${Math.abs(delta).toLocaleString()} B`;
  let label: string;
  if (before === null && after === null) label = 'No File';
  else if (before === null) label = `Added · ${signed}`;
  else if (after === null) label = `Deleted · ${signed}`;
  else if (!delta) label = 'No Size Change';
  else if (!before) label = `${signed} · Previously Empty`;
  else {
    const percent = Math.abs(delta / before * 100);
    const formatted = percent < .01 ? '<0.01' : percent.toLocaleString(undefined, { maximumFractionDigits: 2 });
    label = `${signed} (${delta < 0 ? '−' : '+'}${formatted}%)`;
  }
  return { delta, label, exact };
}
