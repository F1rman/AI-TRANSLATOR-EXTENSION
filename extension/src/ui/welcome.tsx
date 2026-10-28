import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Pin, Languages, LogIn, ShieldCheck } from 'lucide-react';
import { Brand } from './shared';
import './style.css';

const fallback = {
  welcomeTitle: 'Welcome to AI Translator',
  welcomeIntro: 'Translate typed or selected text with AI. Pro also translates webpages and can restore the original text.',
  welcomePin: 'Pin AI Translator to the toolbar and open it.',
  welcomeSignIn: 'Sign in with Google and choose your translation languages.',
  welcomeFirstResult: 'Paste text into the popup or select text on a webpage and click the translate icon. Page translation requires Pro.',
  welcomeAllowance: 'Free includes 100,000 source characters per calendar month and up to 4,000 per translation. Pro includes 2,000,000 per monthly subscription window and up to 50,000 per translation, for $4.99/month or $39.99/year.',
  welcomePrivacy: 'Translation text is sent for server-side AI processing. Instant selection sends selected text automatically when enabled. Pro page translation also processes newly appearing page text; optional page context sends up to 2,000 visible surrounding characters. Translation history stays on this device, separated by account, with no cloud sync.',
  welcomeOpenSettings: 'Open preferences', welcomeReadPrivacy: 'Read the privacy policy',
};
const message = (key: keyof typeof fallback) => globalThis.chrome?.i18n?.getMessage(key) || fallback[key];
const language = globalThis.chrome?.i18n?.getUILanguage() || navigator.language || 'en';
document.documentElement.lang = language;
document.documentElement.dir = /^(ar|fa|he)(-|$)/.test(language) ? 'rtl' : 'ltr';
document.title = message('welcomeTitle');
const media = matchMedia('(prefers-color-scheme: dark)');
let preferredTheme = 'system';
const applyTheme = () => { document.documentElement.dataset.theme = preferredTheme === 'system' ? media.matches ? 'dark' : 'light' : preferredTheme; };
applyTheme(); media.addEventListener('change', applyTheme);
if (globalThis.chrome?.storage?.local) {
  void chrome.storage.local.get('settings').then(({ settings }) => {
    const stored = settings as { theme?: unknown } | undefined;
    if (typeof stored?.theme === 'string' && ['light', 'dark', 'system'].includes(stored.theme)) preferredTheme = stored.theme;
    applyTheme();
  }).catch(() => undefined);
}

function Welcome() {
  const steps = [
    { icon: Pin, key: 'welcomePin' }, { icon: LogIn, key: 'welcomeSignIn' }, { icon: Languages, key: 'welcomeFirstResult' },
  ] as const;
  return <main className="welcome-shell">
    <header><Brand/><h1>{message('welcomeTitle')}</h1><p>{message('welcomeIntro')}</p></header>
    <ol className="welcome-steps">{steps.map(({ icon: Icon, key }) => <li key={key}><span className="section-icon"><Icon size={22}/></span><p>{message(key)}</p></li>)}</ol>
    <section className="welcome-allowance"><p>{message('welcomeAllowance')}</p></section>
    <footer><ShieldCheck size={22}/><p>{message('welcomePrivacy')}</p></footer>
    <nav className="welcome-actions"><button className="primary-button" onClick={() => typeof globalThis.chrome?.runtime?.openOptionsPage === 'function' ? void chrome.runtime.openOptionsPage() : window.location.assign('./options.html')}>{message('welcomeOpenSettings')}<ArrowRight size={18}/></button>
      <a href="https://ai-translator-ext.web.app/privacy" target="_blank" rel="noopener noreferrer">{message('welcomeReadPrivacy')}</a></nav>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Welcome/>);
