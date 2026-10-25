const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../sources/ytmusic-spotiflac/index.js'), 'utf8');

// The app URL exposes a read-only query; only URLSearchParams is mutable.
class RuntimeURL {
  constructor(input, base) {
    const parsed = new URL(input, base);
    for (const key of ['href', 'protocol', 'host', 'hostname', 'pathname', 'search', 'hash']) {
      this[key] = parsed[key];
    }
    this.searchParams = Object.fromEntries(['get', 'getAll', 'has', 'toString'].map(
      key => [key, parsed.searchParams[key].bind(parsed.searchParams)],
    ));
    this.toString = () => parsed.href;
  }
}

function runtime() {
  let extension;
  const calls = { downloads: [], players: [], warnings: [] };
  const c = vm.createContext({
    URL: RuntimeURL, URLSearchParams,
    registerExtension(value) { extension = value; },
    log: { info() {}, debug() {}, error() {}, warn(...args) { calls.warnings.push(args); } },
    utils: { isDownloadCancelled: () => false, sleep() {} },
    storage: { get() {}, set() {} },
    file: {
      download(url, output) {
        calls.downloads.push({ url, output });
        return { success: true, path: output };
      },
    },
    fetch() { throw new Error('Unexpected network request'); },
  });
  vm.runInContext(source, c);
  return { c, calls, extension };
}

const audio = (itag, codec, extra = {}) => ({
  itag,
  mimeType: codec === 'opus' ? 'audio/webm; codecs="opus"' : 'audio/mp4; codecs="mp4a.40.2"',
  url: `https://media.example.test/audio?itag=${itag}`,
  bitrate: 128000,
  ...extra,
});

test('token query updates work with the app URL contract', () => {
  const { c } = runtime();
  const result = new URL(c.updateUrlQuery(
    'https://media.example.test/audio?existing=a%2Bb&pot=old#part',
    { pot: 'fresh_token', empty: '', absent: null },
  ));
  assert.equal(result.searchParams.get('pot'), 'fresh_token');
  assert.equal(result.searchParams.get('existing'), 'a+b');
  assert.equal(result.hash, '#part');
  assert.equal(result.searchParams.has('empty'), false);
});

test('cipher signatures and n challenges are written into the download URL', () => {
  const { c } = runtime();
  c.solveYouTubePlayerChallenge = () => ({ sig: 'solved+signature', n: 'new_n' });
  const cipher = new URLSearchParams({
    url: 'https://media.example.test/audio?keep=a%2Bb&n=old_n',
    s: 'encrypted', sp: 'sig',
  });
  const result = new URL(c.buildYouTubeFormatURL({ signatureCipher: cipher.toString() }, 'player'));
  assert.equal(result.searchParams.get('sig'), 'solved+signature');
  assert.equal(result.searchParams.get('n'), 'new_n');
  assert.equal(result.searchParams.get('keep'), 'a+b');
});

test('unsigned cipher URLs are not used after solving fails', () => {
  const { c } = runtime();
  c.solveYouTubePlayerChallenge = () => ({});
  const cipher = new URLSearchParams({ url: 'https://media.example.test/audio', s: 'encrypted' });
  assert.equal(c.buildYouTubeFormatURL({ signatureCipher: cipher.toString() }, 'player'), '');
});

test('a broken signature on the first format does not discard other Opus audio', () => {
  const { c } = runtime();
  const broken = audio(251, 'opus', { url: '', signatureCipher: 's=encrypted&url=https%3A%2F%2Fmedia.example.test%2Fbroken' });
  c.fetch = () => ({ ok: true, json: () => ({
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [broken, audio(250, 'opus'), audio(140, 'aac')] },
  }) });
  const result = c._tryInnerTubeClient('test-video', c.INNERTUBE_CLIENTS[0], {});
  assert.equal(result.itag, 250);
  assert.equal(result.extension, '.opus');
});

test('Opus from a later client wins over earlier AAC without downloading AAC', () => {
  const { c, calls } = runtime();
  c.INNERTUBE_CLIENTS = [{ name: 'first' }, { name: 'second' }];
  c._tryInnerTubeClient = (_, client) => {
    calls.players.push(client.name);
    const opus = client.name === 'second';
    return { clientName: client.name, itag: opus ? 251 : 140,
      extension: opus ? '.opus' : '.m4a', url: `https://media.example.test/${client.name}` };
  };
  const result = c.tryInnerTubeDownloadsLazily('id', {}, '/music/song.flac', '', '');
  assert.equal(result.audio_codec, 'opus');
  assert.deepEqual(calls.players, ['first', 'second']);
  assert.deepEqual(calls.downloads.map(d => d.output), ['/music/song.opus']);
});

test('failed Opus downloads can fall back to truthful AAC after trying all clients', () => {
  const { c, calls } = runtime();
  c.INNERTUBE_CLIENTS = [{ name: 'first' }, { name: 'second' }];
  c._tryInnerTubeClient = (_, client) => client.name === 'first'
    ? { clientName: 'first', itag: 251, extension: '.opus', url: 'https://media.example.test/opus' }
    : { clientName: 'second', itag: 140, extension: '.m4a', url: 'https://media.example.test/aac' };
  c.file.download = (url, output) => {
    calls.downloads.push({ url, output });
    return output.endsWith('.opus') ? { success: false, error: 'HTTP 403' } : { success: true, path: output };
  };
  const result = c.tryInnerTubeDownloadsLazily('id', {}, '/music/song.flac', '', '');
  assert.equal(result.audio_codec, 'aac');
  assert.equal(result.actual_extension, '.m4a');
  assert.deepEqual(calls.downloads.map(d => d.output), ['/music/song.opus', '/music/song.m4a']);
});

test('a single client retains AAC as fallback if its preferred Opus transfer fails', () => {
  const { c } = runtime();
  c.INNERTUBE_CLIENTS = [c.INNERTUBE_CLIENTS[0]];
  c.fetch = () => ({ ok: true, json: () => ({
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [audio(251, 'opus'), audio(140, 'aac')] },
  }) });
  c.file.download = (url, output) => output.endsWith('.opus')
    ? { success: false, error: 'HTTP 403' }
    : { success: true, path: output };
  const result = c.tryInnerTubeDownloadsLazily('id', {}, '/music/song.flac', '', '');
  assert.equal(result.audio_codec, 'aac');
});

test('new direct clients replace the broken Android VR first choice', () => {
  const { c } = runtime();
  assert.equal(c.INNERTUBE_CLIENTS[0].name, 'tv_samsung');
  assert.ok(c.INNERTUBE_CLIENTS.some(client => client.name === 'web_embedded'));
  assert.ok(!c.INNERTUBE_CLIENTS.some(client => client.name === 'android_vr'));
});

test('video-only streams are never offered as Opus audio', () => {
  const { c } = runtime();
  const formats = [{ itag: 248, mimeType: 'video/webm; codecs="vp9"', url: 'https://media.example.test/video' }];
  assert.equal(c.chooseYouTubeFormat(formats, {}, false), null);
});

test('first working Opus skips the remaining client requests', () => {
  const { c, calls } = runtime();
  c.INNERTUBE_CLIENTS = [{ name: 'first' }, { name: 'unused' }];
  c._tryInnerTubeClient = (_, client) => {
    calls.players.push(client.name);
    return { clientName: client.name, itag: 251, extension: '.opus', url: 'https://media.example.test/opus' };
  };
  assert.equal(c.tryInnerTubeDownloadsLazily('id', {}, '/music/song.flac', '', '').audio_codec, 'opus');
  assert.deepEqual(calls.players, ['first']);
});

test('a client timeout does not skip a later working Opus source', () => {
  const { c } = runtime();
  c.INNERTUBE_CLIENTS = [{ name: 'timeout' }, { name: 'working' }];
  c._tryInnerTubeClient = (_, client) => {
    if (client.name === 'timeout') throw new Error('request timed out');
    return { clientName: client.name, itag: 251, extension: '.opus', url: 'https://media.example.test/opus' };
  };
  assert.equal(c.tryInnerTubeDownloadsLazily('id', {}, '/music/song.flac', '', '').audio_codec, 'opus');
});

test('PO token refresh is inserted into the real media URL and can recover 403', () => {
  const { c, calls } = runtime();
  c.INNERTUBE_CLIENTS = [{ ...c.INNERTUBE_CLIENTS[0], requiresGvsPoToken: true }];
  c.getGvsPoToken = (_, __, ___, bypass) => bypass ? 'new_token' : 'old_token';
  c.fetch = () => ({ ok: true, json: () => ({
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [audio(251, 'opus')] },
  }) });
  c.file.download = (url, output) => {
    calls.downloads.push(url);
    return new URL(url).searchParams.get('pot') === 'new_token'
      ? { success: true, path: output } : { success: false, error: 'HTTP 403' };
  };
  assert.equal(c.tryInnerTubeDownloadsLazily('id', {}, '/music/song.flac', '', '').audio_codec, 'opus');
  assert.deepEqual(calls.downloads.map(url => new URL(url).searchParams.get('pot')), ['old_token', 'new_token']);
});

test('JS clients send the current player timestamp and share the player cache', () => {
  const { c } = runtime();
  let scripts = 0;
  let requests = 0;
  c.fetch = (url, options) => {
    if (url.endsWith('/base.js')) {
      scripts++;
      return { ok: true, text: () => 'var config={signatureTimestamp:20849};' };
    }
    requests++;
    assert.equal(JSON.parse(options.body).playbackContext.contentPlaybackContext.signatureTimestamp, 20849);
    return { ok: true, json: () => ({
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [audio(251, 'opus')] },
    }) };
  };
  const page = { playerUrl: 'https://www.youtube.com/s/player/example/base.js' };
  for (const client of c.INNERTUBE_CLIENTS.filter(client => client.requiresJsPlayer)) {
    assert.equal(c._tryInnerTubeClient('id', client, page).extension, '.opus');
  }
  assert.equal(scripts, 1);
  assert.equal(requests, 2);
});
