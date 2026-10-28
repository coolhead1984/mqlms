const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const buildDirectory = path.join(root, 'build');
const svgPath = path.join(root, 'assets', 'icon.svg');

async function main() {
  fs.mkdirSync(buildDirectory, { recursive: true });
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(buildDirectory, 'icon.png'));
}

main().catch((error) => {
  console.error('Could not generate the macOS app icon:', error);
  process.exitCode = 1;
});
