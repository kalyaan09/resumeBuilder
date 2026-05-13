/**
 * When true (default), Save may cascade font sizes so the PDF fits one page.
 * User can turn off in Settings → Resume Layout; manual font pick in Editor still disables auto-fit.
 */
export function autoFitOnExportEnabled(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return true;
  return (config.autoFitOnExport as boolean | undefined) ?? true;
}
