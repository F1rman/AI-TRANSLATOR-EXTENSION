import type { Segment } from '../shared/protocol';

export const MAX_JOB_CHARACTERS = 4_000;
export const MAX_JOB_SEGMENTS = 24;
const MAX_SEGMENT_CHARACTERS = 1_800;
const OMIT = 'script,style,noscript,template,pre,code,kbd,samp,textarea,input,select,option,form,svg,math,canvas,[translate="no"],[data-ai-translator-ui]';
const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|LI|MAIN|NAV|OL|P|SECTION|TABLE|TD|TH|UL)$/;

export type RecordState = 'ready' | 'queued' | 'translated' | 'failed';
export interface TextPart { prefix: string; text: string; suffix: string }
export interface TextRecord {
  id: number;
  node: Text;
  source: string;
  applied?: string;
  revision: number;
  state: RecordState;
  context: Element;
  parts: TextPart[];
  results: Map<number, string>;
}
export interface TranslationPart extends Segment {
  record: TextRecord;
  revision: number;
  part: number;
}

/** Split without dropping whitespace, breaking surrogate pairs, or relying on Latin punctuation. */
export function splitText(source: string, max = MAX_SEGMENT_CHARACTERS): TextPart[] {
  if (max < 2) throw new Error('The segment limit must be at least two characters.');
  const chunks: string[] = [];
  let remaining = source;
  while (remaining.length > max) {
    let cut = max;
    // Keep UTF-16 surrogate pairs intact. The backend counts code points; this limit is conservative.
    if (/[\uD800-\uDBFF]/.test(remaining[cut - 1] ?? '')) cut--;
    const candidate = remaining.slice(0, cut);
    const sentences = [...candidate.matchAll(/[.!?。！？؟]+(?:[\s\u200B]+|(?=[\p{L}\p{N}]))/gu)];
    const sentence = sentences.at(-1);
    const sentenceEnd = sentence ? sentence.index! + sentence[0].length : 0;
    const whitespace = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n')) + 1;
    if (sentenceEnd >= max / 3) cut = sentenceEnd;
    else if (whitespace >= max / 3) cut = whitespace;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push(remaining);
  return chunks.map((chunk) => {
    const prefix = chunk.match(/^\s*/u)?.[0] ?? '';
    const suffix = chunk.slice(prefix.length).match(/\s*$/u)?.[0] ?? '';
    return { prefix, text: chunk.slice(prefix.length, chunk.length - suffix.length), suffix };
  });
}

export function hasTranslatableText(text: string): boolean {
  return /\p{L}/u.test(text);
}

function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function excludedSelf(element: Element): boolean {
  if (element.matches(OMIT) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  // Also works in DOM test environments and before browsers compute isContentEditable.
  const editable = element.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden';
}

export function isExcluded(element: Element): boolean {
  for (let cursor: Element | null = element; cursor; cursor = parentAcrossShadow(cursor)) if (excludedSelf(cursor)) return true;
  return false;
}

function contextFor(element: Element): Element {
  let context = element;
  while (!BLOCK.test(context.tagName)) {
    const parent = context.parentElement;
    if (!parent || parent.tagName === 'BODY') break;
    context = parent;
  }
  return context;
}

function rendered(element: Element): boolean {
  if (element.getClientRects().length > 0) return true;
  if (getComputedStyle(element).display !== 'contents') return false;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return range.getClientRects().length > 0;
}

/** Stores originals only in this document; never writes HTML or changes element identity. */
export class TextDocument {
  readonly records = new Map<Text, TextRecord>();
  readonly roots = new Set<Document | ShadowRoot>();
  private nextId = 0;

  constructor(private readonly document: Document, private readonly isRendered = rendered) {}

  collect(): TextRecord[] {
    this.prune();
    this.roots.clear();
    this.roots.add(this.document);
    const fresh: TextRecord[] = [];
    const visit = (root: Document | ShadowRoot) => {
      const base = root instanceof Document ? root.body : root;
      if (!base) return;
      if (base instanceof Element && isExcluded(base)) return;
      const walker = this.document.createTreeWalker(base, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Rejected ancestors prune their complete subtree; avoid rechecking every ancestor per node.
            if (excludedSelf(element)) return NodeFilter.FILTER_REJECT;
            if (element.shadowRoot) {
              this.roots.add(element.shadowRoot);
              visit(element.shadowRoot);
            }
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node as Text;
        const textRoot = text.getRootNode();
        const parent = text.parentElement ?? (textRoot instanceof ShadowRoot ? textRoot.host : null);
        if (!parent || !this.isRendered(parent) || !hasTranslatableText(text.data)) continue;
        let record = this.records.get(text);
        if (record && text.data !== (record.applied ?? record.source)) this.invalidate(record);
        if (!record) {
          record = {
            id: ++this.nextId, node: text, source: text.data, revision: 0, state: 'ready',
            context: contextFor(parent), parts: splitText(text.data), results: new Map(),
          };
          this.records.set(text, record);
        }
        if (record.state === 'ready') fresh.push(record);
      }
    };
    visit(this.document);
    return fresh;
  }

  invalidate(record: TextRecord): void {
    record.source = record.node.data;
    record.applied = undefined;
    record.revision++;
    record.state = 'ready';
    record.parts = splitText(record.source);
    record.results.clear();
    if (!hasTranslatableText(record.source)) this.records.delete(record.node);
  }

  changed(node: Text): boolean {
    const record = this.records.get(node);
    if (!record || node.data === (record.applied ?? record.source)) return false;
    this.invalidate(record);
    return true;
  }

  /** Keep a paragraph's text nodes together to provide context, up to the API batch bounds. */
  batches(records: TextRecord[], maxCharacters = MAX_JOB_CHARACTERS, maxSegments = MAX_JOB_SEGMENTS): TranslationPart[][] {
    const groups = new Map<Element, TextRecord[]>();
    for (const record of records) {
      const group = groups.get(record.context) ?? [];
      group.push(record);
      groups.set(record.context, group);
    }
    const batches: TranslationPart[][] = [];
    let batch: TranslationPart[] = [];
    let length = 0;
    const flush = () => {
      if (batch.length) batches.push(batch);
      batch = [];
      length = 0;
    };
    for (const group of groups.values()) {
      const groupLength = group.reduce((sum, record) => sum + record.parts.reduce((n, part, index) => n + (record.results.has(index) ? 0 : part.text.length), 0), 0);
      const groupCount = group.reduce((sum, record) => sum + record.parts.filter((part, index) => !!part.text && !record.results.has(index)).length, 0);
      if (length + groupLength > maxCharacters || batch.length + groupCount > maxSegments) flush();
      for (const record of group) {
        record.state = 'queued';
        record.parts.forEach((part, index) => {
          if (record.results.has(index)) return;
          if (!part.text) { record.results.set(index, ''); return; }
          if (length + part.text.length > maxCharacters || batch.length >= maxSegments) flush();
          batch.push({ id: `n${record.id}r${record.revision}p${index}`, text: part.text, record, revision: record.revision, part: index });
          length += part.text.length;
        });
      }
    }
    flush();
    return batches;
  }

  apply(part: TranslationPart, translated: string): boolean {
    const { record } = part;
    if (!record.node.isConnected || record.revision !== part.revision || record.state === 'failed') return false;
    if (record.node.data !== record.source) {
      this.invalidate(record);
      return false;
    }
    record.results.set(part.part, translated.trim());
    if (record.results.size !== record.parts.length) return false;
    const result = record.parts.map((piece, index) => piece.prefix + record.results.get(index)! + piece.suffix).join('');
    record.applied = result;
    record.state = 'translated';
    record.node.data = result;
    return true;
  }

  fail(parts: TranslationPart[]): void {
    for (const { record, revision } of parts) {
      if (record.revision === revision && record.state !== 'translated') record.state = 'failed';
    }
  }

  prepareResume(): void {
    for (const record of this.records.values()) {
      if (record.state !== 'translated') {
        record.revision++;
        record.state = 'ready';
        // Keep successfully translated chunks of a long node when the user resumes a paused page.
        // collect() clears them if the site's source text changed in the meantime.
      }
    }
  }

  restore(): void {
    for (const record of this.records.values()) {
      // A site owns its current state; never overwrite edits made after our replacement.
      if (record.node.isConnected && record.applied !== undefined && record.node.data === record.applied) record.node.data = record.source;
    }
    this.records.clear();
  }

  counts(): { total: number; completed: number; failed: number } {
    this.prune();
    const records = [...this.records.values()];
    return {
      total: records.length,
      completed: records.filter((record) => record.state === 'translated').length,
      failed: records.filter((record) => record.state === 'failed').length,
    };
  }

  private prune(): void {
    for (const [node] of this.records) if (!node.isConnected) this.records.delete(node);
  }
}
