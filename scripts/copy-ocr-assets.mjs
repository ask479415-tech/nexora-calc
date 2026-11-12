import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const publicOcr = resolve(root, 'public/ocr');
const workerSource = resolve(root, 'node_modules/tesseract.js/dist/worker.min.js');
const coreSource = resolve(root, 'node_modules/tesseract.js-core');
const languageSource = resolve(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');

if (!existsSync(workerSource)) throw new Error('Tesseract worker is missing. Run npm install first.');
if (!existsSync(coreSource)) throw new Error('Tesseract WASM core is missing. Run npm install first.');
if (!existsSync(languageSource)) throw new Error('English OCR trained data is missing. Run npm install first.');

rmSync(publicOcr, { recursive: true, force: true });
mkdirSync(join(publicOcr, 'core'), { recursive: true });
mkdirSync(join(publicOcr, 'lang'), { recursive: true });

copyFileSync(workerSource, join(publicOcr, 'worker.min.js'));
for (const name of readdirSync(coreSource)) {
  if (name.startsWith('tesseract-core') && (name.endsWith('.js') || name.endsWith('.wasm'))) {
    copyFileSync(join(coreSource, name), join(publicOcr, 'core', name));
  }
}
copyFileSync(languageSource, join(publicOcr, 'lang', 'eng.traineddata.gz'));

const coreFiles = readdirSync(join(publicOcr, 'core'));
for (const required of [
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js'
]) {
  if (!coreFiles.includes(required)) throw new Error('Missing required OCR core file: ' + required);
}
console.log('Bundled offline English OCR assets into public/ocr.');
