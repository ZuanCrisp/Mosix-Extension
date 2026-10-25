const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime(provider, fetch) {
  let extension;
  const context = vm.createContext({
    URL, URLSearchParams,
    registerExtension(value) { extension = value; },
    log: { info() {}, debug() {}, warn() {}, error() {} },
    utils: { isDownloadCancelled: () => false, sleep() {} },
    gobackend: { getLocalTime: () => ({ hour: 12 }) },
    fetch,
  });
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../sources', provider, 'index.js'), 'utf8'
  ), context);
  return { context, extension };
}

for (const [country, domain, currency] of [
  ['US', 'music.amazon.com', 'USD'],
  ['GB', 'music.amazon.co.uk', 'GBP'],
  ['JP', 'music.amazon.co.jp', 'JPY'],
]) {
  test(`Amazon Home selects ${country} without changing the download catalog`, () => {
    const calls = [];
    const { context, extension } = runtime('amazon', (url, options) => {
      calls.push({ url, options });
      if (new URL(url).pathname === '/config.json') {
        return { ok: true, status: 200, json: () => ({
          deviceId: 'fixture', sessionId: 'fixture',
          csrf: { token: 'fixture', ts: '1', rnd: '2' },
        }) };
      }
      const headers = JSON.parse(JSON.parse(options.body).headers);
      assert.equal(headers['x-amzn-music-domain'], domain);
      assert.equal(headers['x-amzn-currency-of-preference'], currency);
      assert.equal(options.headers.Origin, `https://${domain}`);
      return { ok: true, status: 200, text: () => JSON.stringify({ methods: [{
        interface: 'Web.TemplatesInterface.v1_0.Touch.WidgetsInterface.VisualShovelerWidgetElement',
        header: 'Trending',
        items: [{ primaryText: 'Album', primaryLink: { deeplink: '/albums/B000000001' } }],
      }] }) };
    });
    extension.initialize({ homeCountry: country });
    const result = extension.getHomeFeed();
    assert.equal(result.success, true);
    assert.equal(result.sections.length, 1);
    assert.ok(calls.some(call => call.url.startsWith(`https://${domain}/config.json`)));
    assert.equal(vm.runInContext('_currentContext.host', context), 'music.amazon.com');
    assert.equal(context.getResourceContext('album', 'B000000001').host, 'music.amazon.com');
  });
}

test('Amazon restores the normal context when a regional Home request fails', () => {
  const { context, extension } = runtime('amazon', () => { throw new Error('offline'); });
  extension.initialize({ homeCountry: 'JP' });
  assert.equal(extension.getHomeFeed().success, false);
  assert.equal(vm.runInContext('_currentContext.host', context), 'music.amazon.com');
});

test('YouTube Home sends the selected country and isolates its cache', () => {
  const countries = [];
  const { extension } = runtime('ytmusic-spotiflac', (_, options) => {
    const body = JSON.parse(options.body);
    countries.push(body.context.client.gl);
    assert.equal(body.browseId, 'FEmusic_home');
    return { ok: true, json: () => ({ contents: {} }) };
  });
  extension.initialize({ homeCountry: 'JP' });
  extension.getHomeFeed();
  extension.getHomeFeed();
  extension.initialize({ homeCountry: 'GB' });
  extension.getHomeFeed();
  extension.initialize({ homeCountry: 'JP' });
  extension.getHomeFeed();
  assert.deepEqual(countries, ['JP', 'GB']);
});

test('YouTube Home preserves the previous default and rejects malformed country codes', () => {
  const countries = [];
  const { extension } = runtime('ytmusic-spotiflac', (_, options) => {
    countries.push(JSON.parse(options.body).context.client.gl);
    return { ok: true, json: () => ({ contents: {} }) };
  });
  extension.initialize({ homeCountry: '../bad' });
  extension.getHomeFeed();
  assert.deepEqual(countries, ['ID']);
});

for (const provider of ['apple-music', 'amazon', 'ytmusic-spotiflac']) {
  test(`${provider} advertises an existing country setting with a valid default`, () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../sources', provider, 'manifest.json'), 'utf8'
    ));
    const setting = manifest.settings.find(s => s.key === manifest.capabilities.homeFeedRegionSetting);
    assert.ok(['select', 'string'].includes(setting.type));
    assert.ok(setting.options.includes(setting.default));
    assert.ok(setting.options.every(code => /^[A-Z]{2}$/i.test(code)));
    assert.ok(setting.options.some(code => code.toUpperCase() === 'JP'));
    assert.ok(setting.options.some(code => code.toUpperCase() === 'GB'));
  });
}
