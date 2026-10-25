const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sources = path.join(__dirname, '../sources');
for (const entry of fs.readdirSync(sources, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(sources, entry.name, 'manifest.json'), 'utf8'));
  if (!manifest.signedSession) continue;
  test(`${manifest.name} verification returns through the host application's callback`, () => {
    assert.equal(manifest.signedSession.callbackUrl, undefined,
      'A fixed callback can open a different app when Mosix and an older host build are both installed');
  });
}
