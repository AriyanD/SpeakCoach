import fs from 'node:fs';

const variables = fs.readFileSync('android/variables.gradle', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const androidBuild = fs.readFileSync('android/app/build.gradle', 'utf8');
const capacitorConfig = fs.readFileSync('capacitor.config.ts', 'utf8');
const appVersionSource = fs.readFileSync('src/config/appVersion.ts', 'utf8');

function readGradleNumber(name) {
  const match = variables.match(new RegExp('\\b' + name + '\\s*=\\s*(\\d+)'));
  if (!match) throw new Error(`Could not read ${name} from android/variables.gradle`);
  return Number(match[1]);
}

const minSdk = readGradleNumber('minSdkVersion');
const compileSdk = readGradleNumber('compileSdkVersion');
const targetSdk = readGradleNumber('targetSdkVersion');
const capacitorPackages = [
  '@capacitor/android',
  '@capacitor/core',
  '@capacitor/filesystem',
  '@capacitor/network',
  '@capacitor/preferences',
];
const failures = [];
const expectedApplicationId = 'com.ariyand.speakcoach';
const applicationId = androidBuild.match(/applicationId\s+\"([^\"]+)\"/)?.[1];
const namespace = androidBuild.match(/namespace\s+\"([^\"]+)\"/)?.[1];
const versionCode = Number(androidBuild.match(/versionCode\s+(\d+)/)?.[1] ?? 0);
const androidVersion = androidBuild.match(/versionName\s+\"([^\"]+)\"/)?.[1];
const appVersion = appVersionSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
if (applicationId !== expectedApplicationId) failures.push(`Android applicationId must be ${expectedApplicationId} (found ${applicationId ?? 'missing'})`);
if (namespace !== expectedApplicationId) failures.push(`Android namespace must be ${expectedApplicationId} (found ${namespace ?? 'missing'})`);
if (!capacitorConfig.includes(`appId: '${expectedApplicationId}'`)) failures.push('Capacitor appId does not match the public Android application ID');
if (versionCode < 1) failures.push(`Android versionCode must be a positive integer (found ${versionCode})`);
if (androidVersion !== pkg.version || appVersion !== pkg.version) failures.push(`package.json, Android versionName and APP_VERSION must match (package=${pkg.version}, Android=${androidVersion}, app=${appVersion})`);

if (minSdk !== 23) failures.push(`minSdkVersion must remain 23 to set Android 6.0 as the minimum supported version (found ${minSdk})`);
if (compileSdk !== 34) failures.push(`compileSdkVersion must remain 34 while staying on Capacitor 6 (found ${compileSdk})`);
if (targetSdk !== 34) failures.push(`targetSdkVersion must remain 34 while staying on Capacitor 6 (found ${targetSdk})`);

for (const name of capacitorPackages) {
  const version = pkg.dependencies?.[name];
  if (!version || !version.replace(/^[~^]/, '').startsWith('6.')) {
    failures.push(`${name} must stay on major version 6 to avoid an accidental platform migration (found ${version ?? 'missing'})`);
  }
}

if (failures.length) {
  console.error('Android release compatibility check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Android compatibility check passed: minSdk 23 (Android 6.0+), Capacitor 6, compile/target SDK 34.');
