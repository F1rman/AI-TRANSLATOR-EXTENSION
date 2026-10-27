import { DEFAULT_SETTINGS } from '../shared/protocol';
import type { Account, ApiError, PageCommand, PageFrameState, PageState, Settings, Tone } from '../shared/protocol';
import { hasTranslatableText, isExcluded, MAX_JOB_CHARACTERS, MAX_JOB_SEGMENTS, splitText, TextDocument } from './dom';
import type { TranslationPart } from './dom';
import { errorDetails, isAborted, request, translateJob } from './jobs';
import { ContentUI, errorText } from './ui';
import { visiblePageContext } from './context';

interface PageRun { generation: number; abort: AbortController; queue: TranslationPart[][]; running: number }
type SelectionRequest = { type: 'selection:translate'; payload?: { text?: string } };
type AggregateRequest = { type: 'page:aggregate'; payload: PageState };
type ContentGlobal = typeof globalThis & { __aiTranslatorContentV1?: boolean };

/** Each frame is isolated. Only the service worker can broadcast commands across frames. */
class ContentController {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private text = new TextDocument(document);
  private ui: ContentUI;
  private observers = new Map<Document | ShadowRoot, MutationObserver>();
  private run?: PageRun;
  private generation = 0;
  private sessionId = '';
  private active = false;
  private restored = true;
  private pageError?: ApiError;
  private aggregate?: PageState;
  private languages = { sourceLanguage: 'auto', targetLanguage: 'Ukrainian' };
  private scanTimer?: ReturnType<typeof setTimeout>;
  private shadowTimer?: ReturnType<typeof setInterval>;
  private reportTimer?: ReturnType<typeof setTimeout>;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private selectionAbort?: AbortController;
  private selected?: { text: string; rect: DOMRect };
  private lastPointer?: { x: number; y: number };
  private readonly ready: Promise<void>;
  private maxCharacters = MAX_JOB_CHARACTERS;
  private maxSegments = MAX_JOB_SEGMENTS;
  private pageTone: Tone = 'neutral';
  private pageContext = false;

  constructor() {
    this.ui = new ContentUI(this.settings, {
      stop: () => this.pageAction('page:stop'),
      restore: () => this.pageAction('page:restore'),
      retry: () => this.pageAction('page:start'),
      login: () => { void this.login(); },
      closeSelection: () => { this.selectionAbort?.abort(); this.selected = undefined; },
    });
    this.ready = request<Settings>({ type: 'settings:get' }).then((settings) => {
      this.settings = settings;
      this.ui.setSettings(settings);
    }).catch(() => undefined);
    chrome.runtime.onMessage.addListener((message: PageCommand | SelectionRequest | AggregateRequest | { type: 'context:get' }, sender, respond) => {
      // No window-message or DOM bridge: webpage JavaScript cannot issue authenticated commands.
      if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
      if (message.type !== 'page:command' && message.type !== 'selection:translate' && message.type !== 'page:aggregate' && message.type !== 'context:get') return false;
      void this.ready.then(() => {
        if (message.type === 'context:get') { respond({ ok: true, data: visiblePageContext(document) });
        } else if (message.type === 'page:aggregate') {
          if (window.top === window && message.payload.sessionId === this.sessionId) {
            this.aggregate = message.payload;
            this.ui.showToolbar(message.payload, this.pageError);
          }
          respond({ ok: true, data: null });
        } else if (message.type === 'page:command') {
          const command = message.payload;
          if (!command || !['start', 'stop', 'restore', 'status'].includes(command.action)) return;
          if (command.action === 'start') {
            this.maxCharacters = Math.min(50000, Math.max(1, command.maxCharactersPerJob || MAX_JOB_CHARACTERS));
            this.maxSegments = Math.min(24, Math.max(1, command.maxSegments || MAX_JOB_SEGMENTS));
            this.pageTone = command.tone || 'neutral'; this.pageContext = command.usePageContext === true;
            this.start(command.sessionId, command.sourceLanguage, command.targetLanguage);
          }
          else if (command.action === 'stop' && command.sessionId === this.sessionId) this.stop();
          else if (command.action === 'restore' && command.sessionId === this.sessionId) this.restore();
          respond({ ok: true, data: this.state() });
        } else {
          const text = message.payload?.text || document.getSelection()?.toString() || '';
          if (text.trim()) this.translateSelection(text, this.selectionRect());
          respond({ ok: true, data: null });
        }
      }).catch((error: unknown) => respond({ ok: false, error: errorDetails(error) }));
      return true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings?.newValue) return;
      this.settings = { ...this.settings, ...changes.settings.newValue as Partial<Settings> };
      this.ui.setSettings(this.settings);
      if (this.settings.selectionMode === 'disabled') this.closeSelection();
    });
    document.addEventListener('pointerup', (event) => {
      if (this.ui.owns(event)) return;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.queueSelection();
    }, true);
    document.addEventListener('keyup', (event) => {
      if (event.key === 'Escape') { this.closeSelection(); return; }
      if (event.key === 'Shift' || event.key.startsWith('Arrow')) this.queueSelection();
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (!this.ui.owns(event)) this.closeSelection();
    }, true);
    document.addEventListener('selectionchange', () => {
      // Selectionchange also fires when copying/selecting our result; pointerup owns activation.
      if (!document.getSelection()?.toString().trim() && !this.selectionAbort) this.ui.hideSelection();
    });
    window.addEventListener('scroll', () => this.scheduleScan(), { passive: true, capture: true });
    window.addEventListener('resize', () => this.scheduleScan(), { passive: true });
    window.addEventListener('pagehide', () => { this.stop(); this.selectionAbort?.abort(); });
    window.addEventListener('popstate', () => this.navigation());
    window.addEventListener('hashchange', () => this.navigation());
  }

  private start(sessionId: string, sourceLanguage: string, targetLanguage: string): void {
    this.stopRun();
    const languageChanged = this.languages.sourceLanguage !== sourceLanguage || this.languages.targetLanguage !== targetLanguage;
    if (languageChanged) this.text.restore();
    this.languages = { sourceLanguage, targetLanguage };
    this.sessionId = sessionId;
    this.active = true;
    this.restored = false;
    this.pageError = undefined;
    this.aggregate = undefined;
    this.text.prepareResume();
    this.run = { generation: ++this.generation, abort: new AbortController(), queue: [], running: 0 };
    this.scan();
    // attachShadow() itself emits no observable document mutation. Discover late attached open roots.
    this.shadowTimer = setInterval(() => {
      if (!this.active) return;
      for (const root of this.text.roots) {
        if ([...root.querySelectorAll('*')].some((element) => element.shadowRoot && !this.observers.has(element.shadowRoot) && !isExcluded(element))) {
          this.scheduleScan();
          return;
        }
      }
    }, 2_500);
  }

  private stopRun(): void {
    this.run?.abort.abort();
    this.run = undefined;
    clearTimeout(this.scanTimer);
    clearInterval(this.shadowTimer);
    this.scanTimer = undefined;
    this.shadowTimer = undefined;
    this.generation++;
  }

  private stop(): void {
    this.active = false;
    this.aggregate = undefined;
    this.stopRun();
    this.report();
  }

  private restore(): void {
    this.active = false;
    this.stopRun();
    this.text.restore();
    this.restored = true;
    this.pageError = undefined;
    this.aggregate = undefined;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    this.report();
  }

  private navigation(): void {
    // SPA navigation must never let a previous page's pending responses change its successor.
    if (!this.restored) this.restore();
    this.closeSelection();
  }

  private scheduleScan(): void {
    if (!this.active) return;
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => { this.scanTimer = undefined; this.scan(); }, 220);
  }

  private scan(): void {
    const run = this.run;
    if (!this.active || !run) return;
    const fresh = this.text.collect();
    run.queue.push(...this.text.batches(fresh, this.maxCharacters, this.maxSegments));
    this.observeRoots();
    this.pump(run);
    this.report();
  }

  private observeRoots(): void {
    for (const root of this.text.roots) {
      if (this.observers.has(root)) continue;
      const observer = new MutationObserver((mutations) => {
        if (!this.active) return;
        let changed = false;
        for (const mutation of mutations) {
          const parent = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (parent?.closest('[data-ai-translator-ui]')) continue;
          if (mutation.type === 'characterData') {
            const node = mutation.target as Text;
            const known = this.text.records.has(node);
            if (this.text.changed(node) || (!known && hasTranslatableText(node.data))) changed = true;
          } else changed = true;
        }
        if (changed) this.scheduleScan();
      });
      observer.observe(root, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['hidden', 'style', 'class', 'contenteditable', 'translate', 'aria-hidden'],
      });
      this.observers.set(root, observer);
    }
    for (const [root, observer] of this.observers) {
      if (root instanceof ShadowRoot && !root.host.isConnected) { observer.disconnect(); this.observers.delete(root); }
    }
  }

  private pump(run: PageRun): void {
    if (run !== this.run || !this.active) return;
    while (run.running < 2 && run.queue.length) {
      const batch = run.queue.shift()!.filter((part) => part.record.node.isConnected && part.record.revision === part.revision && part.record.state === 'queued');
      if (!batch.length) continue;
      run.running++;
      void translateJob({ ...this.languages, mode: 'page', tone: this.pageTone, context: this.pageContext ? visiblePageContext(document) : '', segments: batch.map(({ id, text }) => ({ id, text })) }, run.abort.signal).then((result) => {
        if (run !== this.run || run.abort.signal.aborted) return;
        const translations = new Map(result.map((segment) => [segment.id, segment.text]));
        for (const part of batch) this.text.apply(part, translations.get(part.id)!);
      }).catch((error: unknown) => {
        if (run !== this.run || isAborted(error)) return;
        this.text.fail(batch);
        this.pageError = errorDetails(error);
        this.stop();
      }).finally(() => {
        run.running--;
        if (run !== this.run) return;
        this.pump(run);
        this.report();
        // A site may have rewritten a node while a response was in flight.
        if (this.active && [...this.text.records.values()].some((record) => record.state === 'ready')) this.scheduleScan();
      });
    }
  }

  private state(): PageFrameState {
    const counts = this.text.counts();
    const busy = !!this.run && (this.run.running > 0 || this.run.queue.length > 0 || !!this.scanTimer);
    return {
      sessionId: this.sessionId,
      status: this.restored ? 'idle' : this.pageError ? 'error' : !this.active ? 'paused' : busy ? 'translating' : 'translated',
      ...counts,
      ...(this.pageError ? { message: errorText(this.pageError, this.settings.uiLanguage) } : {}),
    };
  }

  private report(): void {
    const state = this.state();
    if (window.top === window) this.ui.showToolbar(this.aggregate?.sessionId === this.sessionId ? this.aggregate : state, this.pageError);
    if (!this.sessionId) return;
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(() => {
      void request({ type: 'page:report', payload: this.state() }).catch(() => undefined);
    }, 100);
  }

  private pageAction(type: 'page:start' | 'page:stop' | 'page:restore'): void {
    const action = type === 'page:start' ? request({ type, payload: this.languages }) : request({ type });
    void action.catch((error: unknown) => {
      this.pageError = errorDetails(error);
      this.stop();
    });
  }

  private queueSelection(): void {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      if (this.settings.selectionMode === 'disabled') return;
      const selection = document.getSelection();
      const text = selection?.toString() ?? '';
      const anchorRoot = selection?.anchorNode?.getRootNode();
      const parent = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement ?? (anchorRoot instanceof ShadowRoot ? anchorRoot.host : null);
      if (!text.trim() || !hasTranslatableText(text) || !parent || isExcluded(parent)) return;
      const rect = this.selectionRect();
      this.selected = { text, rect };
      if (this.settings.selectionMode === 'instant') this.translateSelection(text, rect);
      else this.ui.showSelectionIcon(rect, () => this.translateSelection(text, rect));
    }, 80);
  }

  private selectionRect(): DOMRect {
    const selection = document.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      const rect = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
      if (rect.width || rect.height) return rect;
    }
    return new DOMRect(this.lastPointer?.x ?? Math.max(12, innerWidth / 2 - 160), this.lastPointer?.y ?? 64, 0, 0);
  }

  private closeSelection(): void {
    clearTimeout(this.selectionTimer);
    this.selectionAbort?.abort();
    this.selectionAbort = undefined;
    this.selected = undefined;
    this.ui.hideSelection();
  }

  private translateSelection(text: string, rect: DOMRect): void {
    void this.runSelection(text, rect);
  }

  private async runSelection(text: string, rect: DOMRect): Promise<void> {
    this.selectionAbort?.abort();
    const abort = new AbortController();
    this.selectionAbort = abort;
    this.selected = { text, rect };
    this.ui.showSelection(rect, () => this.translateSelection(text, rect));
    let account: Account;
    try { account = await request<Account>({ type: 'account:get' }); }
    catch (error) { if (!abort.signal.aborted) this.ui.selectionFailure(errorDetails(error)); return; }
    if (abort.signal.aborted) return;
    const maxCharacters = account.limits?.maxCharactersPerJob || MAX_JOB_CHARACTERS;
    if (Array.from(text).length > maxCharacters) {
      this.ui.selectionFailure({ code: 'TEXT_TOO_LONG', message: this.settings.uiLanguage === 'uk' ? `Виділіть до ${maxCharacters.toLocaleString('uk')} символів.` : `Select up to ${maxCharacters.toLocaleString()} characters.` });
      return;
    }
    const pieces = splitText(text);
    const sourceLanguage = this.settings.sourceLanguage;
    const targetLanguage = this.settings.targetLanguage;
    const tone = account.features.tones.includes(this.settings.tone) ? this.settings.tone : 'neutral';
    const context = account.features.pageContext && this.settings.usePageContext ? visiblePageContext(document) : '';
    const batches: { id: string; text: string }[][] = [];
    let batch: { id: string; text: string }[] = [];
    let characters = 0;
    pieces.forEach((piece, index) => {
      if (!piece.text) return;
      if (batch.length >= account.limits.maxSegments || characters + Array.from(piece.text).length > maxCharacters) {
        batches.push(batch); batch = []; characters = 0;
      }
      batch.push({ id: String(index), text: piece.text });
      characters += Array.from(piece.text).length;
    });
    if (batch.length) batches.push(batch);
    const translated = new Map<string, string>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < batches.length) {
        const segments = batches[cursor++]!;
        const results = await translateJob({ sourceLanguage, targetLanguage, mode: 'selection', tone, context, segments }, abort.signal);
        for (const result of results) translated.set(result.id, result.text.trim());
      }
    };
    void Promise.all([worker(), worker()]).then(() => {
      if (abort.signal.aborted || this.selectionAbort !== abort) return;
      this.ui.selectionResult(pieces.map((piece, index) => piece.prefix + (translated.get(String(index)) ?? '') + piece.suffix).join(''));
    }).catch((error: unknown) => {
      if (abort.signal.aborted || this.selectionAbort !== abort || isAborted(error)) return;
      this.ui.selectionFailure(errorDetails(error));
      abort.abort();
    });
  }

  private async login(): Promise<void> {
    try {
      await request({ type: 'auth:login' });
      if (this.pageError && ['AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(this.pageError.code)) this.pageAction('page:start');
      if (this.selected) this.translateSelection(this.selected.text, this.selected.rect);
    } catch (error) {
      if (this.selected) this.ui.selectionFailure(errorDetails(error));
      else { this.pageError = errorDetails(error); this.report(); }
    }
  }
}

const contentGlobal = globalThis as ContentGlobal;
if (!contentGlobal.__aiTranslatorContentV1 && /^https?:$/.test(location.protocol)) {
  contentGlobal.__aiTranslatorContentV1 = true;
  new ContentController();
}
