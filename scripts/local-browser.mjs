import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startSite(outDir = 'dist') {
  const options = { host: '127.0.0.1', port: 0, strictPort: true };
  const server = await preview({ build: { outDir }, preview: options });
  return { url: `http://127.0.0.1:${server.httpServer.address().port}/`, close: () => server.close() };
}

export async function startIsolatedSite() {
  const outDir = await mkdtemp(join(tmpdir(), 'modelcheck-viewer-'));
  const clean = () => rm(outDir, { recursive: true, force: true });
  try {
    await build({ publicDir: false, build: { outDir, emptyOutDir: true }, logLevel: 'silent' });
    const site = await startSite(outDir);
    return {
      url: site.url,
      async close() {
        try { await site.close(); } finally { await clean(); }
      },
    };
  } catch (error) {
    await clean();
    throw error;
  }
}

export async function launchBrowser(channel = process.env.MODELCHECK_BROWSER || undefined) {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (channel) return chromium.launch({ channel, args });

  const installed = process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'msedge'];
  for (const candidate of [undefined, ...installed]) {
    try {
      return await chromium.launch({ channel: candidate, args });
    } catch (error) {
      if (!/Executable doesn't exist|Chromium distribution '.+' is not found/.test(error.message)) throw error;
    }
  }
  throw new Error('No Chromium browser found. Run npx playwright install chromium from ModelCheck.');
}
