// The application resolves, batches and transfers V3 downloads. This fallback
// contract never signs arbitrary data or exposes a remote media URL.
function v3Download(trackID, quality, outputPath, onProgress, options) {
    if (typeof apiV3 === "undefined" || apiV3.protocolVersion !== 1) {
        return {success: false, error_type: "client_update_required", error_message: "CLIENT_UPDATE_REQUIRED"};
    }
    // A legacy download dispatcher cannot safely resume a signed media stream.
    // It must hand this operation to the host queue, never the old V2 downloader.
    return {success: false, error_type: "v3_host_required", error_message: "CLIENT_UPDATE_REQUIRED"};
}
