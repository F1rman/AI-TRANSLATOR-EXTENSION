export const config = {
  apiBase: (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'ai-translator-ext.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ai-translator-ext',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  },
};
export const configured = Boolean(config.firebase.apiKey && config.firebase.appId && config.apiBase && import.meta.env.VITE_GOOGLE_CLIENT_ID);
