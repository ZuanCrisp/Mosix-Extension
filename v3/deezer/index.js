function deezerGet(path) {
    var response = http.get("https://api.deezer.com" + path);
    if (!response || response.statusCode !== 200) throw new Error("PROVIDER_BUSY");
    var value = JSON.parse(response.body);
    if (!value || value.error) throw new Error("RESOURCE_UNAVAILABLE");
    return value;
}
function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9\u0080-\uffff]/g, "");
}
function checkAvailability(isrc, name, artist, options) {
    options = options || {};
    var track;
    if (/^\d{1,18}$/.test(String(options.deezer_id || ""))) {
        track = deezerGet("/track/" + options.deezer_id);
    } else if (/^[A-Za-z0-9]{12}$/.test(String(isrc || ""))) {
        track = deezerGet("/track/isrc:" + encodeURIComponent(isrc));
    } else {
        var results = deezerGet("/search/track?q=" + encodeURIComponent('track:"' + name + '" artist:"' + artist + '"') + "&limit=20");
        var candidates = results.data || [];
        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            if (normalize(candidate.title) === normalize(name) && normalize(candidate.artist && candidate.artist.name) === normalize(artist)) {
                track = deezerGet("/track/" + candidate.id);
                break;
            }
        }
    }
    if (!track || !track.id || track.readable === false) return {available:false};
    if (isrc && normalize(track.isrc) !== normalize(isrc)) return {available:false};
    if (!isrc && (normalize(track.title) !== normalize(name) || normalize(track.artist && track.artist.name) !== normalize(artist))) return {available:false};
    if (options.duration_ms > 0 && Math.abs(track.duration * 1000 - options.duration_ms) > 3000) return {available:false};
    return {available:true,track_id:String(track.id)};
}
registerExtension({initialize:function(){},cleanup:function(){},checkAvailability:checkAvailability,download:v3Download});
