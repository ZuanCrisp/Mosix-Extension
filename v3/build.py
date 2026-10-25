#!/usr/bin/env python3
"""Build isolated V3 testing packages without modifying the public registry."""

import io
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent


def build():
    source = ROOT.parent / "sources" / "qobuz-web"
    manifest = json.loads((source / "manifest.json").read_text())
    manifest.update({
        "name": "qobuz-v3", "displayName": "Qobuz V3 (Testing)",
        "version": "0.1.0", "minAppVersion": "5.2.1",
        "requiredRuntimeFeatures": ["apiV3@1", "preparedContext@1"],
        "description": "Testing: host-managed V3 FLAC downloads with Qobuz metadata.",
    })
    manifest.pop("signedSession", None)
    manifest.pop("serviceHealth", None)
    manifest["capabilities"]["apiV3Providers"] = ["qobuz"]
    manifest["capabilities"].pop("replacesBuiltInProviders", None)
    wrapper = (ROOT / "host-download.js").read_text()
    adapter = """var registerV3Definition = registerExtension;
registerExtension = function (definition) {
    definition.download = v3Download;
    delete definition.completeGrant;
    registerV3Definition(definition);
};
"""
    # Metadata parsing and matching share the maintained source. The registered
    # download function is replaced before native code can invoke it.
    emit(manifest, wrapper + adapter + (source / "index.js").read_text())
    manifest = json.loads((ROOT / "deezer" / "manifest.json").read_text())
    emit(manifest, wrapper + (ROOT / "deezer" / "index.js").read_text())


def emit(manifest, script):
    directory = ROOT / "out" / manifest["name"]
    directory.mkdir(parents=True, exist_ok=True)
    files = {"manifest.json": json.dumps(manifest, indent=2) + "\n", "index.js": script}
    for name in ("LICENSE", "COPYING", "NOTICE"):
        files[name] = (ROOT.parent / name).read_text()
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, text in files.items():
            (directory / name).write_text(text)
            entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, text.encode(), compress_type=ZIP_DEFLATED, compresslevel=9)
    (ROOT / "out" / (manifest["name"] + ".sflx")).write_bytes(buffer.getvalue())


if __name__ == "__main__":
    build()
