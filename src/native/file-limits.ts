// Text/RPC reads must fit the host's 16 MiB WebSocket frame after serialization.
// Binary previews, uploads and downloads use HTTP instead.
export const previewLimit = 10 * 1024 * 1024;
// Binary documents travel over HTTP, outside the JSON WebSocket frame budget.
export const fileTransferLimit = 64 * 1024 * 1024;
