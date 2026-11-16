import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cliPackagePath = require.resolve('@capacitor/cli/package.json');
const cliPackage = JSON.parse(readFileSync(cliPackagePath, 'utf8'));

if (cliPackage.version !== '6.2.3') {
  throw new Error(
    `The Capacitor tar compatibility patch is validated for @capacitor/cli 6.2.3, not ${cliPackage.version}. Review the upstream template import before changing this guard.`
  );
}

const templatePath = join(dirname(cliPackagePath), 'dist', 'util', 'template.js');
const source = readFileSync(templatePath, 'utf8');

if (source.includes('tar_1.extract(') && !source.includes('tar_1.default.extract(')) {
  console.log('[postinstall] Capacitor CLI tar import is already compatible.');
} else {
  const defaultImport = /const tar_1 = tslib_1\.__importDefault\(require\(["']tar["']\)\);/;
  if (!defaultImport.test(source) || !source.includes('tar_1.default.extract(')) {
    throw new Error(
      'Unexpected @capacitor/cli template.js structure. The tar compatibility patch was not applied; inspect the installed CLI before continuing.'
    );
  }

  const patched = source
    .replace(defaultImport, 'const tar_1 = require("tar");')
    .replace('tar_1.default.extract(', 'tar_1.extract(');

  writeFileSync(templatePath, patched, 'utf8');
  console.log('[postinstall] Patched Capacitor CLI 6.2.3 to use the named tar.extract export from secure tar 7.x.');
}
