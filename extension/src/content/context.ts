import { isExcluded } from './dom';

/** Read rendered surrounding text only. Never inspect values, HTML, or off-screen text. */
export function visiblePageContext(document: Document, limit = 2000): string {
  const window = document.defaultView;
  if (!window || !document.body) return '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let length = 0;
  let node: Node | null;
  const intersects = (rect: DOMRect) => rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.right > bounds.left && rect.top < bounds.bottom && rect.left < bounds.right;
  let bounds = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  const contained = (rect: DOMRect) => rect.top >= bounds.top && rect.left >= bounds.left && rect.bottom <= bounds.bottom && rect.right <= bounds.right;
  const ancestors = (element: Element): Element[] => {
    const result: Element[] = [];
    let current: Element | null = element;
    while (current) {
      result.push(current);
      const root = current.getRootNode();
      current = current.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return result;
  };
  while ((node = walker.nextNode()) && length < limit) {
    const parent = node.parentElement;
    if (!parent || isExcluded(parent) || parent.closest('button,[role="textbox"],[aria-hidden="true"]')) continue;
    const chain = ancestors(parent);
    if (chain.some(element => Number(window.getComputedStyle(element).opacity) <= 0)) continue;
    if ('checkVisibility' in parent && !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) continue;
    bounds = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    let unsupportedClip = false;
    for (const element of chain) {
      const style = window.getComputedStyle(element);
      // Complex masks cannot be mapped to a safe text rectangle; omit that subtree.
      if (style.clipPath !== 'none' || style.maskImage !== 'none' || style.clip !== 'auto') { unsupportedClip = true; break; }
      const clipsX = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
      const clipsY = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const rect = element.getBoundingClientRect();
      if (clipsX) { bounds.left = Math.max(bounds.left, rect.left + element.clientLeft); bounds.right = Math.min(bounds.right, rect.left + element.clientLeft + element.clientWidth); }
      if (clipsY) { bounds.top = Math.max(bounds.top, rect.top + element.clientTop); bounds.bottom = Math.min(bounds.bottom, rect.top + element.clientTop + element.clientHeight); }
    }
    if (unsupportedClip || bounds.left >= bounds.right || bounds.top >= bounds.bottom) continue;
    const points = Array.from(node.textContent || '');
    if (!points.length || !points.join('').trim()) continue;
    const offsets = [0]; for (const point of points) offsets.push(offsets[offsets.length - 1] + point.length);
    const visible: string[] = [];
    let remaining = limit - length - (chunks.length ? 1 : 0);
    const read = (start: number, end: number): void => {
      if (remaining <= 0 || start >= end) return;
      const range = document.createRange(); range.setStart(node!, offsets[start]); range.setEnd(node!, offsets[end]);
      const rectangles = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
      if (!rectangles.some(intersects)) return;
      if (rectangles.every(contained)) {
        const count = Math.min(remaining, end - start); visible.push(points.slice(start, start + count).join('')); remaining -= count; return;
      }
      if (end - start === 1) return;
      const middle = start + Math.floor((end - start) / 2);
      read(start, middle); read(middle, end);
    };
    read(0, points.length);
    const piece = visible.join('').replace(/\s+/gu, ' ').trim();
    if (!piece) continue;
    chunks.push(piece); length += Array.from(piece).length + (chunks.length > 1 ? 1 : 0);
  }
  return chunks.join('\n');
}
