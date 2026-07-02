const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const legacyFiles = ['eslint.config.js', 'jest.config.ts'];

for (const file of legacyFiles) {
  const target = path.join(root, file);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
    console.log(`[OK] Removed legacy config: ${file}`);
  } else {
    console.log(`[OK] Legacy config not present: ${file}`);
  }
}
