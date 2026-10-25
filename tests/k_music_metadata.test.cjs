const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { names, row, table, detail, artist, runtime } = require('./helpers/k_music.cjs');

const MELON_COVER = 'https://cdnimg.melon.co.kr/cm2/album/images/700/00/000/70000_500.jpg';

// Extension arrays come from the sandbox realm; copy them before deep comparison.
function values(list, pick) {
  return Array.from(list, pick);
}

function assertPermitted(provider, calls) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../sources', provider, 'manifest.json')));
  for (const { url } of calls) assert.ok(manifest.permissions.network.includes(new URL(url).hostname), url);
}

function albumPage(provider, rows) {
  return detail(provider, '70000', 'album').replace(table(provider), table(provider, rows));
}

function withoutArtwork(provider, ...args) {
  return row(provider, ...args).replace(/<img[^>]*>/, '');
}

function playerTrack(id, len) {
  return JSON.stringify({ track: { track_id: Number(id), len } });
}

function melonSong(id, playTime) {
  return JSON.stringify({ response: { RESULTCODE: '0', SONGINFO: { SONGID: id, PLAYTIME: playTime },
    GENRELIST: [{ GENRENAME: 'Ballad' }], CMPSRLIST: [{ ARTISTNAME: 'Writer One' }, { ARTISTNAME: 'Writer &amp; Two' }] } });
}

test('Bugs: list rows name every artist of a collaboration', () => {
  const popup = "Artist One||Artist One||90000||OK\\\\nArtist &amp; Two||Artist &amp; Two||90001||OK";
  const html = `<html><table><tr trackId="12345"><td>
    <p class="title"><a href="/track/12345">Signal &amp; Sound</a></p>
    <p class="artist"><a href="/artist/90000">Artist One</a>
    <a href="javascript:void(0);" class="more"
      onclick="bugs.layermenu.openMultiArtistSearchResultPopLayer(this, '${popup}', ''); return false;">Artist One</a></p>
  </td></tr>${row('bugs-music', '12346', 'Solo song')}</table></html>`;
  const { extension } = runtime('bugs-music', () => html);
  const results = extension.customSearch('Signal', { limit: 10 });
  assert.equal(results[0].artists, 'Artist One, Artist & Two');
  assert.equal(results[1].artists, names.artist);
});

test('Bugs: album tracks read running times from the player within a time budget', () => {
  const rows = ['12345', '12346', '12347', '12348'].map((id) => row('bugs-music', id, `Song ${id}`)).join('');
  let r;
  r = runtime('bugs-music', (url) => {
    const id = url.match(/\/player\/track\/(\d+)$/)?.[1];
    if (!id) return albumPage('bugs-music', rows);
    r.advance(4000);
    return id === '12346' ? playerTrack('99999', '01:00') : playerTrack(id, '03:45');
  });
  const album = r.extension.getAlbum('70000');
  assert.deepEqual(values(album.tracks, (track) => track.duration_ms), [225000, 0, 225000, 0]);
  assert.equal(r.calls.filter(({ url }) => url.includes('/player/track/')).length, 3);
  assertPermitted('bugs-music', r.calls);
  const requests = r.calls.length;
  assert.equal(r.extension.getAlbum('70000'), album);
  assert.equal(r.calls.length, requests);
  r.extension.cleanup();
  r.extension.getAlbum('70000');
  assert.ok(r.calls.length > requests);
});

test('Bugs: an unreadable player response leaves the album intact', () => {
  const { extension } = runtime('bugs-music', (url) => url.includes('/player/track/')
    ? '<html>Maintenance</html>' : albumPage('bugs-music', row('bugs-music')));
  const album = extension.getAlbum('70000');
  assert.equal(album.tracks[0].name, names.track);
  assert.equal(album.tracks[0].duration_ms, 0);
});

test('Bugs: the home feed adds genre charts', () => {
  const r = runtime('bugs-music', () => `<html>${table('bugs-music')}</html>`);
  const feed = r.extension.getHomeFeed();
  assert.ok(feed.sections.some((section) => section.uri === 'bugs:genre:kpop-idol'));
  assert.ok(r.calls.some(({ url }) => url.endsWith('/genre/chart/etc/nnewage/total/day')));
});

test('Genie: album tracks read running times from their song pages', () => {
  const rows = row('genie-music') + row('genie-music', '12346', 'Second song');
  const r = runtime('genie-music', (url) => {
    const id = new URL(url).searchParams.get('xgnm');
    return id ? detail('genie-music', id) : albumPage('genie-music', rows);
  });
  const album = r.extension.getAlbum('70000');
  assert.deepEqual(values(album.tracks, (track) => [track.name, track.duration_ms]),
    [[names.track, 225000], ['Second song', 225000]]);
  assertPermitted('genie-music', r.calls);
});

test('Genie: a song page failure keeps the album and its other running times', () => {
  const rows = row('genie-music') + row('genie-music', '12346', 'Second song');
  const { extension } = runtime('genie-music', (url) => {
    const id = new URL(url).searchParams.get('xgnm');
    if (id === '12345') return { ok: false, status: 503, body: '' };
    return id ? detail('genie-music', id) : albumPage('genie-music', rows);
  });
  assert.deepEqual(values(extension.getAlbum('70000').tracks, (track) => track.duration_ms), [0, 225000]);
});

test('Melon: a page without a running time reads it from the mobile song JSON', () => {
  const page = detail('melon-music').replace('"duration":"PT3M45S",', '');
  const r = runtime('melon-music', (url) => url.startsWith('https://m2.melon.com/') ? melonSong('12345', '225') : page);
  const track = r.extension.getTrack('12345');
  assert.equal(track.duration_ms, 225000);
  assert.equal(track.genre, 'Pop');
  assert.equal(track.composer, 'Writer One, Writer & Two');
  assert.ok(r.calls[1].url.endsWith('/m6/v1/song/info.json?songId=12345'));
  assertPermitted('melon-music', r.calls);

  const other = runtime('melon-music', (url) => url.startsWith('https://m2.melon.com/') ? melonSong('99999', '225') : page);
  assert.equal(other.extension.getTrack('12345').duration_ms, 0);
  const failing = runtime('melon-music', (url) => url.startsWith('https://m2.melon.com/')
    ? { ok: false, status: 500, body: '' } : page);
  assert.equal(failing.extension.getTrack('12345').name, names.track);
});

test('Melon: album tracks read running times, discs, and numbers from the mobile listing', () => {
  const rows = row('melon-music') + row('melon-music', '12346', 'Second song');
  const listing = JSON.stringify({ response: { RESULTCODE: '0', CDLIST: [
    { CDNO: '1', SONGLIST: [{ SONGID: '12345', ALBUMID: '70000', TRACKNO: '1', PLAYTIME: '225' }] },
    { CDNO: '2', SONGLIST: [{ SONGID: '12346', ALBUMID: '70000', TRACKNO: '1', PLAYTIME: '61' },
      { SONGID: '12346', ALBUMID: '80000', TRACKNO: '9', PLAYTIME: '1' }] },
  ] } });
  const r = runtime('melon-music', (url) => url.startsWith('https://m2.melon.com/') ? listing : albumPage('melon-music', rows));
  const album = r.extension.getAlbum('70000');
  assert.deepEqual(values(album.tracks, (track) => [track.disc_number, track.track_number, track.duration_ms]),
    [[1, 1, 225000], [2, 1, 61000]]);
  assert.ok(r.calls[1].url.endsWith('/m6/v1/album/song/list.json?albumId=70000'));
  assertPermitted('melon-music', r.calls);
  const requests = r.calls.length;
  assert.equal(r.extension.getAlbum('70000'), album);
  assert.equal(r.calls.length, requests);
});

test('Melon: albums keep songs that Melon cannot stream', () => {
  const unavailable = `<tr data-group-items="cd2"><td><input class="input_check disabled" value="12346">
    <a href="javascript:melon.link.goSongDetail('12346');" class="btn song_info"><span class="none">곡정보</span></a>
    <div class="wrap_song_info"><div class="ellipsis"><span> <span class="disabled">Demo &amp; Sketch</span> </span></div>
    <div class="ellipsis rank02"><a href="javascript:melon.link.goArtistDetail('90000');">Artist One</a></div></div>
    <span class="rank disabled">1</span></td></tr>`;
  const { extension } = runtime('melon-music', () => albumPage('melon-music', row('melon-music') + unavailable));
  const album = extension.getAlbum('70000');
  assert.deepEqual(values(album.tracks, (track) => [track.id, track.name, track.artists]),
    [['12345', names.track, names.artist], ['12346', 'Demo & Sketch', names.artist]]);
});

test('Melon: an unavailable mobile listing keeps the page order', () => {
  const rows = row('melon-music') + row('melon-music', '12346', 'Second song');
  const { extension } = runtime('melon-music', (url) => url.startsWith('https://m2.melon.com/')
    ? { ok: false, status: 500, body: '' } : albumPage('melon-music', rows));
  assert.deepEqual(values(extension.getAlbum('70000').tracks, (track) => [track.disc_number, track.track_number]),
    [[1, 1], [1, 2]]);
});

test('Melon: search results take artwork from the mobile web results', () => {
  const mobile = `<ul><li class="list_item" d-albumId="70000"
    d-albumImage="//cdnimg.melon.co.kr/cm2/album/images/700/00/000/70000_500.jpg?abc/melon/resize/144/optimize/90"
    d-songId="12345"></li></ul>`;
  const rows = withoutArtwork('melon-music') + withoutArtwork('melon-music', '12346', 'Same album')
    + withoutArtwork('melon-music', '12347', 'Other album', '80000');
  const r = runtime('melon-music', (url) => url.startsWith('https://m.app.melon.com/')
    ? mobile : `<html>${table('melon-music', rows)}</html>`);
  const results = r.extension.customSearch('Signal', { limit: 10 });
  assert.deepEqual(values(results, (track) => track.cover_url), [MELON_COVER, MELON_COVER, '']);
  assert.ok(r.calls[1].url.includes('/search/mobile4web/searchsong_list.htm?keyword=Signal&startIndex=1&pageSize=3'));
  assert.match(r.calls[1].headers['User-Agent'], /iPhone/);
  assertPermitted('melon-music', r.calls);
});

test('Melon: search with artwork on every row makes no extra request', () => {
  const r = runtime('melon-music', () => `<html>${table('melon-music')}</html>`);
  r.extension.customSearch('Signal', { limit: 10 });
  assert.equal(r.calls.length, 1);
});

test('Melon: popular artist tracks reuse album artwork, then the mobile search results', () => {
  const albums = `<html><li class="album11_li"><img src="${MELON_COVER}">
    <a href="javascript:goAlbumDetail('70000')" class="ellipsis">Example Album</a></li></html>`;
  const older = 'https://cdnimg.melon.co.kr/cm2/album/images/800/00/000/80000_500.jpg';
  const mobile = `<li class="list_item" d-albumId="80000" d-albumImage="${older}?abc" d-songId="12346"></li>`;
  const songs = withoutArtwork('melon-music') + withoutArtwork('melon-music', '12346', 'Older song', '80000');
  const r = runtime('melon-music', (url) => url.includes('/artist/album.htm') ? albums
    : url.includes('/artist/song.htm') ? `<html>${table('melon-music', songs)}</html>`
      : url.startsWith('https://m.app.melon.com/') ? mobile : artist('melon-music'));
  const value = r.extension.getArtist('90000');
  assert.deepEqual(values(value.top_tracks, (track) => track.cover_url), [MELON_COVER, older]);
  assert.ok(r.calls.at(-1).url.includes(`keyword=${encodeURIComponent(names.artist)}&`));
  assertPermitted('melon-music', r.calls);
});

test('Melon: the home feed lists DJ playlists', () => {
  const dj = `<html><a href="javascript:melon.link.goDjPlaylistDetail('','','55555');" title="Example playlist - 페이지 이동">
    <img src="https://cdnimg.melon.co.kr/dj.jpg"></a></html>`;
  const { extension } = runtime('melon-music', (url) => url.includes('/dj/today/') ? dj : `<html>${table('melon-music')}</html>`);
  const section = extension.getHomeFeed().sections.find((item) => item.uri === 'melon-music:dj-today');
  assert.deepEqual([section.items[0].id, section.items[0].item_type, section.items[0].name, section.items[0].cover_url],
    ['55555', 'playlist', 'Example playlist', 'https://cdnimg.melon.co.kr/dj.jpg']);
});

for (const [provider, url] of [
  ['melon-music', 'https://m.app.melon.com/song/detail.htm?songId=12345'],
  ['melon-music', 'https://m2.melon.com/song/detail.htm?songId=12345'],
  ['genie-music', 'https://mw.genie.co.kr/detail/songInfo?xgnm=12345'],
]) {
  test(`${provider}: mobile URL import returns the requested track (${url})`, () => {
    const { extension } = runtime(provider);
    const value = extension.handleUrl(url);
    assert.equal(value.type, 'track');
    assert.equal(value.track.id, '12345');
  });
}

for (const [provider, url] of [
  ['melon-music', 'https://evilmelon.com/song/detail.htm?songId=12345'],
  ['melon-music', 'https://melon.com.example.invalid/song/detail.htm?songId=12345'],
  ['genie-music', 'https://evilgenie.co.kr/detail/songInfo?xgnm=12345'],
  ['genie-music', 'https://genie.co.kr.example.invalid/detail/songInfo?xgnm=12345'],
]) {
  test(`${provider}: subdomain matching rejects a lookalike host (${url})`, () => {
    const { extension, calls } = runtime(provider);
    if (provider === 'genie-music') assert.equal(extension.handleUrl(url), null);
    else assert.throws(() => extension.handleUrl(url), /Unsupported/);
    assert.equal(calls.length, 0);
  });
}
