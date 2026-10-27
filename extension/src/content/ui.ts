import type { ApiError, PageFrameState, Settings } from '../shared/protocol';

const COPY = {
  uk: {
    name: 'AI Translator', translate: 'Перекласти', loading: 'Перекладаємо…', copy: 'Копіювати', copied: 'Скопійовано', close: 'Закрити',
    stop: 'Зупинити', restore: 'Оригінал', retry: 'Продовжити', signIn: 'Увійти з Google', ready: 'Сторінку перекладено',
    watching: 'Новий текст перекладатиметься автоматично', paused: 'Переклад призупинено', blocks: 'блоків', failed: 'з помилкою',
    auth: 'Увійди з Google, щоб почати переклад.', quota: 'Місячний ліміт символів вичерпано. Перейдіть на Pro або дочекайтеся оновлення ліміту у вашому акаунті.',
    network: 'Не вдалося з’єднатися. Перевір інтернет і продовж переклад.', long: 'Виділи до 20 000 символів для одного перекладу.',
    invalid: 'AI повернув неповний переклад. Спробуй ще раз.',
    rate: 'Сервіс тимчасово зайнятий. Спробуй трохи пізніше.',
    generic: 'Не вдалося перекласти. Спробуй ще раз.',
  },
  en: {
    name: 'AI Translator', translate: 'Translate', loading: 'Translating…', copy: 'Copy', copied: 'Copied', close: 'Close',
    stop: 'Stop', restore: 'Original', retry: 'Continue', signIn: 'Sign in with Google', ready: 'Page translated',
    watching: 'New text will be translated automatically', paused: 'Translation paused', blocks: 'blocks', failed: 'failed',
    auth: 'Sign in with Google to start translating.', quota: 'Your monthly character allowance is used up. Upgrade to Pro or wait for the reset shown in your account.',
    network: 'Could not connect. Check your connection and continue.', long: 'Select up to 20,000 characters for one translation.',
    invalid: 'The AI returned an incomplete translation. Please try again.',
    rate: 'The service is busy. Please try again shortly.',
    generic: 'Could not translate. Please try again.',
  },
};

export function errorText(error: ApiError, language: Settings['uiLanguage']): string {
  const t = COPY[language];
  if (['AUTH_REQUIRED', 'UNAUTHENTICATED', 'TOKEN_EXPIRED'].includes(error.code)) return t.auth;
  if (error.code === 'QUOTA_EXCEEDED') return t.quota;
  if (error.code === 'TEXT_TOO_LONG') return error.message || t.long;
  if (error.code === 'PRO_REQUIRED') return language === 'uk' ? 'Ця можливість доступна з Pro. Відкрийте розширення, щоб оформити підписку.' : 'This feature requires Pro. Open the extension to upgrade.';
  if (error.code === 'UPDATE_REQUIRED') return language === 'uk' ? 'Оновіть AI Translator і повторіть спробу.' : 'Update AI Translator and try again.';
  if (error.code === 'INVALID_TRANSLATION') return t.invalid;
  if (['CONCURRENCY_LIMIT', 'UPSTREAM_RATE_LIMIT'].includes(error.code)) return t.rate;
  if (['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE'].includes(error.code)) return t.network;
  return t.generic;
}

const css = `
:host { all:initial!important; color-scheme:light; --app-background:#f3f6f9; --app-surface-1:#ffffff; --app-surface-2:#edf1f5; --app-surface-3:#e4eaf0; --app-foreground:#171a1d; --app-muted:#586572; --app-income:#23764f; --app-expense:#b3344c; --app-on-accent:#ffffff; --app-divider:color-mix(in srgb,var(--app-foreground) 16%,transparent); --app-accent-soft:color-mix(in srgb,var(--app-income) 10%,var(--app-surface-1)); font:13px/1.5 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
* { box-sizing:border-box; }
[data-theme=dark] { color-scheme:dark; --app-background:#08141e; --app-surface-1:#1b2530; --app-surface-2:#25323f; --app-surface-3:#344453; --app-foreground:#f1f5f9; --app-muted:#bac7d3; --app-income:#75d6a7; --app-expense:#ff9bae; --app-on-accent:#08141e; --app-divider:color-mix(in srgb,var(--app-foreground) 16%,transparent); --app-accent-soft:color-mix(in srgb,var(--app-income) 10%,var(--app-surface-1)); }
@media (prefers-color-scheme:dark) { [data-theme=system] { color-scheme:dark; --app-background:#08141e; --app-surface-1:#1b2530; --app-surface-2:#25323f; --app-surface-3:#344453; --app-foreground:#f1f5f9; --app-muted:#bac7d3; --app-income:#75d6a7; --app-expense:#ff9bae; --app-on-accent:#08141e; --app-divider:color-mix(in srgb,var(--app-foreground) 16%,transparent); --app-accent-soft:color-mix(in srgb,var(--app-income) 10%,var(--app-surface-1)); } }
/* A functional edge keeps extension controls distinct on arbitrary page backgrounds. */
.card { background:var(--app-surface-1); color:var(--app-foreground); border:1px solid var(--app-divider); border-radius:20px; font:13px/1.5 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.toolbar { position:fixed; z-index:2147483647; width:min(324px,calc(100vw - 24px)); right:20px; bottom:20px; padding:16px; }
.headline { display:flex; align-items:center; gap:9px; font-weight:650; letter-spacing:-.15px; font-size:14px; }
.mark { display:grid; place-items:center; flex:none; width:32px; height:32px; border-radius:12px; background:var(--app-accent-soft); color:var(--app-income); font-size:16px; font-weight:750; }
.state { margin:12px 0 2px; font-weight:600; font-size:13px; }
.detail { font-size:12px; line-height:1.5; color:var(--app-muted); overflow-wrap:anywhere; }
.progress { height:5px; margin:12px 0; background:var(--app-surface-2); border-radius:5px; overflow:hidden; }
.progress span { display:block; height:100%; background:var(--app-income); border-radius:5px; transition:width .2s; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
button { appearance:none; cursor:pointer; border:0; border-radius:12px; min-width:44px; min-height:44px; color:var(--app-foreground); background:var(--app-surface-2); padding:10px 12px; font:600 13px/1.4 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; transition:background .15s; }
button:hover:not(:disabled) { background:var(--app-surface-3); } button:focus-visible { outline:2px solid var(--app-income); outline-offset:2px; }
button:disabled { opacity:.55; cursor:default; } button.primary { background:var(--app-income); color:var(--app-on-accent); }
button.primary:hover:not(:disabled) { background:color-mix(in srgb,var(--app-income) 88%,var(--app-foreground)); }
button.close { display:grid; place-items:center; flex:none; margin-left:auto; padding:8px; font-size:22px; line-height:1; font-weight:400; color:var(--app-muted); }
.chip { position:fixed; z-index:2147483647; display:flex; align-items:center; gap:8px; padding:6px 12px 6px 6px; background:var(--app-surface-1); color:var(--app-foreground); border:1px solid var(--app-divider); border-radius:12px; font-weight:650; }
.chip .mark { width:30px; height:30px; font-size:14px; }
.bubble { position:fixed; z-index:2147483647; width:min(370px,calc(100vw - 24px)); padding:16px; }
.translation { margin-top:13px; white-space:pre-wrap; overflow-wrap:anywhere; max-height:min(340px,55vh); overflow:auto; font-size:14px; line-height:1.65; user-select:text; }
.error { color:var(--app-expense); }
.pending { display:flex; gap:8px; align-items:center; color:var(--app-muted); padding:12px 0 4px; }
.spinner { width:16px; height:16px; flex:none; border-radius:50%; border:2px solid var(--app-surface-3); border-top-color:var(--app-income); animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
[hidden] { display:none!important; }
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = element('button', primary ? 'primary' : undefined, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

interface Actions {
  stop: () => void;
  restore: () => void;
  retry: () => void;
  login: () => void;
  closeSelection: () => void;
}

export class ContentUI {
  readonly host: HTMLDivElement;
  private container: HTMLDivElement;
  private toolbar?: HTMLDivElement;
  private dismissedToolbarSessionId?: string;
  private chip?: HTMLButtonElement;
  private bubble?: HTMLDivElement;
  private anchor?: DOMRect;
  private lastState?: PageFrameState;
  private lastError?: ApiError;
  private selectionRetry?: () => void;
  private selectionText = '';
  private selectionError?: ApiError;
  private selectionLoading = false;

  constructor(private settings: Settings, private readonly actions: Actions) {
    this.host = element('div');
    this.host.setAttribute('data-ai-translator-ui', '');
    this.host.style.setProperty('all', 'initial', 'important');
    this.host.style.setProperty('position', 'static', 'important');
    this.host.style.setProperty('z-index', '2147483647', 'important');
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = element('style');
    style.textContent = css;
    this.container = element('div');
    this.container.dataset.theme = settings.theme;
    shadow.append(style, this.container);
    (document.documentElement || document).appendChild(this.host);
    // Keep interacting with extension controls from altering the page's current selection.
    shadow.addEventListener('pointerdown', (event) => {
      if ((event.target as Element | null)?.closest('button')) event.preventDefault();
    });
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.container.dataset.theme = settings.theme;
    if (this.lastState) this.showToolbar(this.lastState, this.lastError);
    if (this.bubble) this.renderSelection();
  }

  owns(event: Event): boolean { return event.composedPath().includes(this.host); }

  showToolbar(state: PageFrameState, error?: ApiError): void {
    this.lastState = state;
    this.lastError = error;
    if (state.status === 'idle' || state.sessionId === this.dismissedToolbarSessionId) {
      this.toolbar?.remove();
      this.toolbar = undefined;
      return;
    }
    const t = COPY[this.settings.uiLanguage];
    const card = element('div', 'card toolbar');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', t.name);
    const head = element('div', 'headline');
    const close = button('×', () => {
      this.dismissedToolbarSessionId = state.sessionId;
      this.toolbar?.remove();
      this.toolbar = undefined;
    });
    close.className = 'close';
    close.setAttribute('aria-label', t.close);
    close.title = t.close;
    head.append(element('span', 'mark', '文'), element('span', undefined, t.name), close);
    const title = element('div', 'state', state.status === 'translating' ? t.loading : state.status === 'translated' ? t.ready : t.paused);
    const detail = element('div', 'detail', error ? errorText(error, this.settings.uiLanguage) : state.message || (state.status === 'translated' ? t.watching : `${state.completed} / ${state.total} ${t.blocks}${state.failed ? ` · ${state.failed} ${t.failed}` : ''}`));
    title.setAttribute('aria-live', 'polite');
    const progress = element('div', 'progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(state.total));
    progress.setAttribute('aria-valuenow', String(state.completed));
    const bar = element('span');
    bar.style.width = `${state.total ? Math.min(100, state.completed / state.total * 100) : 0}%`;
    progress.append(bar);
    const actions = element('div', 'actions');
    if (state.status === 'translating' || state.status === 'translated') actions.append(button(t.stop, this.actions.stop));
    else actions.append(button(error && ['AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(error.code) ? t.signIn : t.retry, error && ['AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(error.code) ? this.actions.login : this.actions.retry, true));
    actions.append(button(t.restore, this.actions.restore));
    card.append(head, title, detail, progress, actions);
    this.toolbar?.replaceWith(card);
    if (!this.toolbar) this.container.append(card);
    this.toolbar = card;
  }

  showSelectionIcon(rect: DOMRect, onClick: () => void): void {
    this.hideSelection();
    this.anchor = rect;
    const t = COPY[this.settings.uiLanguage];
    this.chip = button('', onClick);
    this.chip.className = 'chip';
    this.chip.setAttribute('aria-label', t.translate);
    this.chip.append(element('span', 'mark', '文'), element('span', undefined, t.translate));
    this.container.append(this.chip);
    this.position(this.chip, rect);
  }

  showSelection(rect: DOMRect, retry: () => void): void {
    this.chip?.remove();
    this.chip = undefined;
    this.anchor = rect;
    this.selectionRetry = retry;
    this.selectionText = '';
    this.selectionError = undefined;
    this.selectionLoading = true;
    this.renderSelection();
  }

  selectionResult(text: string): void {
    this.selectionLoading = false;
    this.selectionError = undefined;
    this.selectionText = text;
    this.renderSelection();
  }

  selectionFailure(error: ApiError): void {
    this.selectionLoading = false;
    this.selectionError = error;
    this.renderSelection();
  }

  hideSelection(): void {
    this.chip?.remove();
    this.bubble?.remove();
    this.chip = undefined;
    this.bubble = undefined;
  }

  private renderSelection(): void {
    const t = COPY[this.settings.uiLanguage];
    const card = element('div', 'card bubble');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', t.name);
    const head = element('div', 'headline');
    const close = button('×', () => { this.actions.closeSelection(); this.hideSelection(); });
    close.className = 'close';
    close.setAttribute('aria-label', t.close);
    head.append(element('span', 'mark', '文'), element('span', undefined, t.name), close);
    card.append(head);
    if (this.selectionLoading) {
      const pending = element('div', 'pending');
      pending.append(element('span', 'spinner'), element('span', undefined, t.loading));
      pending.setAttribute('role', 'status');
      card.append(pending);
    } else if (this.selectionError) {
      const message = element('div', 'translation error', errorText(this.selectionError, this.settings.uiLanguage));
      message.setAttribute('role', 'alert');
      const actions = element('div', 'actions');
      const auth = ['AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(this.selectionError.code);
      actions.append(button(auth ? t.signIn : t.retry, auth ? this.actions.login : () => this.selectionRetry?.(), true));
      card.append(message, actions);
    } else {
      const translation = element('div', 'translation', this.selectionText);
      translation.dir = 'auto';
      translation.setAttribute('aria-live', 'polite');
      const actions = element('div', 'actions');
      const copy = button(t.copy, () => {
        const write = navigator.clipboard?.writeText(this.selectionText) ?? Promise.reject(new Error('Clipboard unavailable'));
        void write.then(() => { copy.textContent = t.copied; }).catch(() => {
          // Users can still select the result on pages that disable clipboard access.
          const selection = document.getSelection();
          const range = document.createRange();
          range.selectNodeContents(translation);
          selection?.removeAllRanges();
          selection?.addRange(range);
        });
      });
      actions.append(copy);
      card.append(translation, actions);
    }
    this.bubble?.replaceWith(card);
    if (!this.bubble) this.container.append(card);
    this.bubble = card;
    this.position(card, this.anchor ?? new DOMRect(innerWidth / 2, 60, 0, 0));
  }

  private position(node: HTMLElement, anchor: DOMRect): void {
    const width = node.getBoundingClientRect().width || 280;
    const height = node.getBoundingClientRect().height || 50;
    const left = Math.min(Math.max(12, anchor.left), Math.max(12, innerWidth - width - 12));
    const below = anchor.bottom + 9;
    const top = below + height < innerHeight - 12 ? below : Math.max(12, Math.min(anchor.top - height - 9, innerHeight - height - 12));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }
}
