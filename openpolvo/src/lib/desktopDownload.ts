/** URL do instalador ou página de releases da app desktop (Electron), definida no build do Vite. */
export function getDesktopDownloadUrl(): string {
  const raw = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL;
  return typeof raw === "string" ? raw.trim() : "";
}
