import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

function readPngDimensions(filePath) {
  const buf = readFileSync(filePath);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  // IHDR width & height at byte offsets 16..24
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('PWA manifest, PNG assets, and Capacitor configuration compliance', () => {
  it('provides a complete compliant manifest.json without combined "any maskable" purposes', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/manifest.json'), 'utf8'));

    expect(manifest.id).toBeTruthy();
    expect(manifest.name).toBe('Carnet du temps');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();

    expect(Array.isArray(manifest.icons)).toBe(true);
    const has192Any = manifest.icons.some(i => i.sizes === '192x192' && i.type === 'image/png' && i.purpose === 'any');
    const has512Any = manifest.icons.some(i => i.sizes === '512x512' && i.type === 'image/png' && i.purpose === 'any');
    const has512Maskable = manifest.icons.some(i => i.sizes === '512x512' && i.type === 'image/png' && i.purpose === 'maskable');
    const hasCombinedPurpose = manifest.icons.some(i => String(i.purpose || '').includes('any') && String(i.purpose || '').includes('maskable'));

    expect(has192Any).toBe(true);
    expect(has512Any).toBe(true);
    expect(has512Maskable).toBe(true);
    expect(hasCombinedPurpose).toBe(false);
  });

  it('has real generated PNG icon files with exact required resolutions', () => {
    const expected = [
      { file: 'public/pwa-192x192.png', width: 192, height: 192 },
      { file: 'public/pwa-512x512.png', width: 512, height: 512 },
      { file: 'public/pwa-maskable-512x512.png', width: 512, height: 512 },
      { file: 'public/apple-touch-icon.png', width: 180, height: 180 },
    ];

    for (const item of expected) {
      const fullPath = resolve(ROOT, item.file);
      expect(existsSync(fullPath)).toBe(true);
      expect(readPngDimensions(fullPath)).toEqual({ width: item.width, height: item.height });
    }
  });

  it('configures index.html with PNG apple-touch-icon (not SVG) and mobile meta tags', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+href="[^"]*apple-touch-icon\.png"/);
    expect(html).not.toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+href="[^"]*\.svg"/);
    expect(html).toMatch(/<meta[^>]+name="apple-mobile-web-app-capable"/);
    expect(html).toMatch(/<meta[^>]+name="theme-color"/);
  });

  it('includes valid Capacitor config pointing to webDir dist', () => {
    const capPath = resolve(ROOT, 'capacitor.config.ts');
    expect(existsSync(capPath)).toBe(true);
    const capText = readFileSync(capPath, 'utf8');
    expect(capText).toContain("appId: 'com.timetracker.carnetdutemps'");
    expect(capText).toContain("webDir: 'dist'");
  });
});
