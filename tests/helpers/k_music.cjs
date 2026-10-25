const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const providers = ['bugs-music', 'melon-music', 'genie-music'];
const names = { track: 'Signal & Sound', album: 'Example Album', artist: 'Artist One' };

function meta(key, value) {
  return `<meta property="${key}" content="${value}">`;
}

function row(provider, id = '12345', title = 'Signal &amp; Sound', albumId = '70000') {
  if (provider === 'bugs-music') {
    return `<tr data-track-id="${id}"><td>
      <p class="title"><a href="/track/${id}">${title}</a></p>
      <p class="artist"><a href="/artist/90000">Artist One</a></p>
      <a class="album" href="/album/${albumId}">Example Album</a>
      <img src="https://image.bugsm.co.kr/album/images/200/700/70000.jpg">
    </td></tr>`;
  }
  if (provider === 'melon-music') {
    return `<tr data-song-no="${id}"><td>
      <a class="title" href="javascript:playSong(1,${id})">${title}</a>
      <a class="artist" href="/artist/detail.htm?artistId=90000">Artist One</a>
      <a href="/album/detail.htm?albumId=${albumId}">Example Album</a>
      <img src="https://cdnimg.melon.co.kr/cover.jpg?resize=120">
    </td></tr>`;
  }
  return `<tr data-song-no="${id}"><td>
    <a class="title" href="/detail/songInfo?xgnm=${id}"><span class="icon">TITLE</span>${title}</a>
    <a class="artist" href="/detail/artistInfo?xxnm=90000">Artist One</a>
    <a class="albumtitle" href="/detail/albumInfo?axnm=${albumId}">Example Album</a>
    <img src="http://image.genie.co.kr/cover_100x100.jpg">
  </td></tr>`;
}

function table(provider, rows) {
  const content = rows || row(provider);
  if (provider === 'bugs-music') return `<table class="trackList byAlbum">${content}</table>`;
  if (provider === 'melon-music') return `<div class="service_list_song"><table>${content}</table></div>`;
  return `<table class="list-wrap">${content}</table>`;
}

function genieInfo(kind, name) {
  return `<div class="${kind}"><h2 class="name">${name}</h2>
    <img src="http://image.genie.co.kr/cover_100x100.jpg">
    <img src="txt_5.png"><span class="value"><a href="/detail/artistInfo?xxnm=90000">Artist One</a></span>
    <img src="txt_6.png"><span class="value"><a href="/detail/albumInfo?axnm=70000">Example Album</a></span>
    <img src="txt_8.png"><span class="value">3:45</span>
    <img src="txt_12.png"><span class="value">2026.10.01</span>
  </div><!-- E. info-zone -->`;
}

function detail(provider, id = '12345', type = 'track') {
  const name = type === 'track' ? 'Signal &amp; Sound' : names.album;
  const recommendations = `<table>${row(provider, '99999', 'Unrelated song', '88888')}</table>`;
  if (provider === 'bugs-music') {
    const url = `https://music.bugs.co.kr/${type}/${id}`;
    const data = {
      '@type': type === 'track' ? 'MusicRecording' : 'MusicAlbum', url, name,
      byArtist: { name: names.artist }, duration: 'PT3M45S',
      inAlbum: { name: names.album, url: 'https://music.bugs.co.kr/album/70000' },
      image: 'https://image.bugsm.co.kr/cover.jpg', datePublished: '2026-10-01',
    };
    return `<html><h1>Player help</h1>${meta('og:url', url)}
      <script type="application/ld+json">${JSON.stringify(data)}</script>
      <header class="pgTitle"><h1>${name}</h1></header>
      <table><tr><th>아티스트</th><td><a href="/artist/90000">Artist One</a></td></tr>
      <tr><th>앨범</th><td><a href="/album/70000">Example Album</a></td></tr></table>
      ${type === 'album' ? table(provider) : ''}${recommendations}</html>`;
  }
  if (provider === 'melon-music') {
    const url = `https://www.melon.com/${type === 'track' ? 'song' : 'album'}/detail.htm?${type === 'track' ? 'songId' : 'albumId'}=${id}`;
    const data = {
      '@type': type === 'track' ? 'MusicRecording' : 'MusicAlbum', sameAs: url, name,
      inAlbum: { name: names.album, '@id': 'https://www.melon.com/album/detail.htm?albumId=70000' },
      duration: 'PT3M45S', image: 'https://cdnimg.melon.co.kr/cover.jpg',
    };
    return `<html><h1>Melon</h1>${meta('og:url', url)}
      <script type="application/ld+json">${JSON.stringify(data)}</script>
      <div class="section_info"><div class="song_name"><strong class="none">곡명</strong>${name}</div>
      <div class="artist"><a href="/artist/detail.htm?artistId=90000">Artist One</a></div>
      <dl><dt>앨범</dt><dd><a href="/album/detail.htm?albumId=70000">Example Album</a></dd>
      <dt>발매일</dt><dd>2026.10.01</dd><dt>장르</dt><dd>Pop</dd></dl></div>
      ${type === 'album' ? table(provider) : ''}${recommendations}</html>`;
  }
  return `<html><h1>Play</h1><script>var iSnsSeq = "${id}";</script>
    ${genieInfo(type === 'track' ? 'song-main-infos' : 'album-detail-infos', name)}
    ${type === 'album' ? table(provider) : ''}${recommendations}</html>`;
}

function artist(provider) {
  if (provider === 'bugs-music') {
    return `<html><header class="pgTitle"><h1>Artist One</h1></header>
      <figure class="albumInfo"><a href="/album/70000"></a>
      <div class="albumTitle"><a>Example Album</a></div><time>2026.10.01</time></figure>
      ${table(provider)}</html>`;
  }
  if (provider === 'melon-music') {
    return `<html>${meta('og:title', names.artist)}${meta('og:url', 'https://www.melon.com/artist/timeline.htm?artistId=90000')}
      <li class="album11_li"><a href="javascript:goAlbumDetail('70000')" class="ellipsis">Example Album</a></li>
      ${table(provider)}</html>`;
  }
  return `<html>${genieInfo('artist-main-infos', names.artist)}${table(provider)}</html>`;
}

function artistAlbums(page = 1, total = 11) {
  const start = (page - 1) * 10;
  const rows = Array.from({ length: Math.max(0, Math.min(10, total - start)) }, (_, i) => {
    const id = 70000 + start + i;
    return `<li class="list-album"><a onclick="fnViewAlbumLayer('${id}')" class="album-thumb">
      <img src="https://image.genie.co.kr/cover.jpg"></a>
      <dl><dt><a>Album ${id}</a></dt><dd class="desc">2026.10.01 1곡</dd></dl></li>`;
  }).join('');
  return `<html>전체 <strong>${total}</strong>${rows}</html>`;
}

function runtime(provider, respond = () => detail(provider)) {
  const calls = [];
  let extension;
  let time = 1_000_000;
  const context = vm.createContext({
    registerExtension(value) { extension = value; },
    Date: class extends Date { static now() { return time; } },
    log: { info() {}, debug() {}, warn() {}, error() {} },
    http: { get(url, headers) {
      calls.push({ url, headers });
      const value = respond(url, headers);
      return typeof value === 'string' ? { ok: true, status: 200, body: value } : value;
    } },
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../sources', provider, 'index.js'), 'utf8'), context, { timeout: 1000 });
  return { c: context, extension, calls, advance(ms) { time += ms; } };
}

module.exports = { providers, names, meta, row, table, detail, artist, artistAlbums, runtime };
