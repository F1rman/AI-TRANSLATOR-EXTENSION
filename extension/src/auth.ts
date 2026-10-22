import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, indexedDBLocalPersistence, initializeAuth, signInWithCredential, signOut } from 'firebase/auth/web-extension';
import { config, configured } from './config';
import { ExtensionError } from './shared/protocol';
import type { AuthState, User } from './shared/protocol';

const auth = configured ? initializeAuth(initializeApp(config.firebase), { persistence: indexedDBLocalPersistence }) : null;
function requireAuthConfig() {
  if (!auth) throw new ExtensionError({ code: 'NOT_CONFIGURED', message: 'Google sign-in is not configured in this build. See the setup guide.' });
  return auth;
}
function userInfo(): User | null {
  const user = auth?.currentUser;
  return user ? { uid: user.uid, name: user.displayName, email: user.email, picture: user.photoURL } : null;
}
export async function getAuthState(): Promise<AuthState> {
  await auth?.authStateReady();
  return { user: userInfo(), configured };
}
export async function login(): Promise<AuthState> {
  const currentAuth = requireAuthConfig();
  await currentAuth.authStateReady();
  if (currentAuth.currentUser) return getAuthState();
  const response = await chrome.identity.getAuthToken({ interactive: true });
  if (!response.token) throw new ExtensionError({ code: 'AUTH_REQUIRED', message: 'Google sign-in was cancelled.' });
  try {
    await signInWithCredential(currentAuth, GoogleAuthProvider.credential(null, response.token));
  } catch (error) {
    await chrome.identity.removeCachedAuthToken({ token: response.token });
    throw error;
  }
  return getAuthState();
}
export async function logout(): Promise<AuthState> {
  if (auth) await signOut(auth);
  await chrome.identity.clearAllCachedAuthTokens();
  return getAuthState();
}
export async function getIdToken(forceRefresh = false): Promise<string> {
  const currentAuth = requireAuthConfig();
  await currentAuth.authStateReady();
  if (!currentAuth.currentUser) throw new ExtensionError({ code: 'AUTH_REQUIRED', message: 'Sign in with Google to start translating.' });
  return currentAuth.currentUser.getIdToken(forceRefresh);
}
