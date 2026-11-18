const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');
const cinematicDir = path.join(rootDir, 'disha-cinematic');
const cinematicPublicDir = path.join(cinematicDir, 'public');
const cinematicDistDir = path.join(cinematicDir, 'dist');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  // Build outputs are exact mirrors, not append-only copies.
  const sourceNames = new Set(entries.map(entry => entry.name));
  for (const stale of fs.readdirSync(dest, { withFileTypes: true })) {
    if (!sourceNames.has(stale.name)) {
      fs.rmSync(path.join(dest, stale.name), { recursive: true, force: true });
    }
  }
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('⚡ [Build] Preparing Cloudflare Pages static & edge bundles...');

// 1. Ensure dist directory exists and copy public/* into dist/
copyDirRecursive(publicDir, distDir);
console.log('✅ [Build] Copied public/ -> dist/');

// 2. Ensure disha-cinematic directory exists and populate for legacy Pages configs
copyDirRecursive(publicDir, cinematicPublicDir);
copyDirRecursive(publicDir, cinematicDistDir);
console.log('✅ [Build] Populated disha-cinematic/public and disha-cinematic/dist');

console.log('🎉 [Build] Cloudflare Pages build complete!');
