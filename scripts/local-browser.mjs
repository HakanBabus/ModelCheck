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
    await build({ build: { outDir, emptyOutDir: true }, logLevel: 'silent' });
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

export function launchBrowser(channel = process.env.MODELCHECK_BROWSER || undefined) {
  return chromium.launch({ channel, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}
