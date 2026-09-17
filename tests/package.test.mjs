import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Pi discovers p-ui as exactly one extension', async () => {
  const agentDir = await realpath(await mkdtemp(join(tmpdir(), 'p-ui-discovery-')));
  try {
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ packages: [root] }));
    const loader = new DefaultResourceLoader({ cwd: agentDir, agentDir, noContextFiles: true });
    await loader.reload();

    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    assert.equal(extensions.extensions.length, 1);
    assert.equal(resolve(extensions.extensions[0].path), resolve(root, 'index.ts'));
    assert.deepEqual(loader.getPrompts().prompts, []);
    const packageThemes = loader.getThemes().themes.filter((theme) => theme.sourcePath?.startsWith(root));
    assert.equal(packageThemes.length, 1);
    assert.equal(packageThemes[0].name, 'prjct-theme');
    assert.equal(resolve(packageThemes[0].sourcePath), resolve(root, 'themes/prjct-theme.json'));
    assert.deepEqual(loader.getSkills().skills.filter((skill) => skill.filePath.startsWith(root)), []);

    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.pi.extensions, ['./index.ts']);
    assert.deepEqual(manifest.pi.themes, ['./themes/prjct-theme.json']);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
