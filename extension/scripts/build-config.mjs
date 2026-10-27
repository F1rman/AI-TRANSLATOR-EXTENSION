import targets from '../billing-targets.json' with { type: 'json' };

export function selectedEnvironment(args) {
  if (args.length === 0) return 'live';
  if (args.length !== 2 || args[0] !== '--environment' || !['live', 'test'].includes(args[1])) {
    throw new Error('Use --environment live or --environment test.');
  }
  return args[1];
}

/** Use the existing public Auth settings; API and billing targets belong to the build. */
export function buildConfig(environment, publicSettings, overrides = {}) {
  const target = targets[environment];
  if (!target) throw new Error('Choose the live or test build environment.');
  const selected = {
    VITE_BILLING_ENVIRONMENT: environment,
    VITE_API_BASE_URL: target.apiBaseUrl,
    VITE_BILLING_BASE_URL: target.billingBaseUrl,
  };
  for (const [name, value] of Object.entries(selected)) {
    if (overrides[name] !== undefined && overrides[name] !== value) {
      throw new Error(`${name} does not match the selected build environment.`);
    }
  }
  const names = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID', 'VITE_GOOGLE_CLIENT_ID'];
  const auth = Object.fromEntries(names.map(name => [name, overrides[name] ?? publicSettings[name] ?? '']));
  if (names.some(name => !auth[name])) throw new Error('Public Firebase and Chrome OAuth settings are required.');
  if (auth.VITE_FIREBASE_PROJECT_ID !== 'ai-translator-ext'
      || auth.VITE_FIREBASE_AUTH_DOMAIN !== 'ai-translator-ext.firebaseapp.com') {
    throw new Error('Both build environments use the existing AI Translator Firebase identity project.');
  }
  return { ...auth, ...selected };
}
