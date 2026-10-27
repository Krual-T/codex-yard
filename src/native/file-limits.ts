// Base64 previews fit in the host's 16 MiB WebSocket frame. Browser downloads
// use HTTP and uploads are checked before the picker transfers their bytes.
export const previewLimit = 10 * 1024 * 1024;
