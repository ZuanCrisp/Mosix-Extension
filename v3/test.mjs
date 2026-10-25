import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
execFileSync('python3', [join(root, 'build.py')]);
for (const provider of ['qobuz', 'deezer']) {
  const path = join(root, 'out', `${provider}-v3`);
  const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.capabilities.apiV3Providers, [provider]);
  assert.ok(manifest.requiredRuntimeFeatures.includes('apiV3@1'));
  assert.equal(manifest.signedSession, undefined);
  let definition;
  const context = vm.createContext({registerExtension(value) { definition = value; }, log: {info() {}, warn() {}, error() {}, debug() {}}});
  vm.runInContext(readFileSync(join(path, 'index.js'), 'utf8'), context);
  assert.equal(typeof definition.checkAvailability, 'function');
  assert.equal(definition.download, context.v3Download);
  assert.equal(definition.download('1', 'LOSSLESS', '/unused').error_message, 'CLIENT_UPDATE_REQUIRED');
  context.apiV3 = {protocolVersion: 1};
  assert.equal(definition.download('1', 'LOSSLESS', '/unused').error_type, 'v3_host_required');
  if (provider === 'deezer') {
    const track = {id: 123, isrc: 'USAAA2600001', title: 'Example', artist: {name: 'Example artist'}, duration: 200};
    context.http = {get() { return {statusCode: 200, body: JSON.stringify(track)}; }};
    assert.equal(definition.checkAvailability(track.isrc, track.title, track.artist.name, {duration_ms: 200000}).track_id, '123');
    assert.equal(definition.checkAvailability('USAAA2600002', track.title, track.artist.name, {}).available, false);
    assert.equal(definition.checkAvailability(track.isrc, track.title, track.artist.name, {duration_ms: 100000}).available, false);
  }
}
console.log('V3 package contracts passed for both providers.');
