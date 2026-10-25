# V3 testing packages

Run `python3 v3/build.py` from this repository. Packages are written to
`v3/out/qobuz-v3.sflx` and `v3/out/deezer-v3.sflx`. Install explicitly and select
the testing provider in the application's download picker. The public registry
and existing providers are unchanged.

Requires the app's `apiV3@1` runtime feature. The app resolves source IDs with
the extension, persists the batch, owns PoW/session signing, downloads media
with a fresh DPoP proof for each connection, and publishes finalized files.
The extension cannot obtain session tokens, device private keys or media URLs.
V2 account/BYOA providers do not gain access to the shared V3 pool.

Import the operator-provided `v3-testing.env` in the extension's **V3 download
access** page. Never package that file or its token. Testing is limited to
Qobuz and Deezer FLAC. Only the host transfer path may run these downloads;
the extension download callback refuses legacy dispatch rather than silently
switching back to V2.

Qobuz metadata/matching is generated from the maintained source. Deezer uses
public metadata and verifies ISRC or exact title/artist plus duration.
