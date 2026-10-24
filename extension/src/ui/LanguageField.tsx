import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Settings } from '../shared/protocol';
import { messages } from './i18n';
import { findLanguages, languageEntries, languageName, normalizeLanguageSearch } from './languages';

type Option = { value: string; label: string; hint?: string; group: 'auto' | 'popular' | 'all' | 'custom' };
export function LanguageField({ label, value, automatic = false, settings, onChange, disabled = false }: { label: string; value: string; automatic?: boolean; settings: Settings; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(); const t = messages[settings.uiLanguage];
  const anchor = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null); const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 0, width: 280, maxHeight: 300 });
  const search = normalizeLanguageSearch(query);
  const matches = findLanguages(query);
  const options: Option[] = [];
  if (automatic && (!search || [t.auto, 'auto', 'detect language', 'автовизначення'].some((name) => normalizeLanguageSearch(name).includes(search)))) options.push({ value: 'auto', label: t.auto, group: 'auto' });
  const known = languageEntries.some((entry) => entry.value === value);
  if (!search && value !== 'auto' && !known) options.push({ value, label: value, group: 'custom' });
  for (const entry of matches) options.push({ value: entry.value, label: settings.uiLanguage === 'uk' ? entry.uk : entry.value, hint: entry.native, group: entry.popular && !search ? 'popular' : 'all' });
  const custom = query.trim();
  const exact = languageEntries.some((entry) => [entry.value, entry.uk, entry.native, ...entry.codes.split(' ')].some((name) => normalizeLanguageSearch(name) === search));
  if (custom && !exact && !['auto', 'detect language', 'автовизначення', normalizeLanguageSearch(t.auto)].includes(search)) options.push({ value: custom, label: `${t.useLanguage} “${custom}”`, group: 'custom' });
  const selected = languageName(value, settings.uiLanguage, t.auto);
  const choose = (next: string) => { onChange(next); setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const show = () => { setQuery(''); setActive(0); setOpen(true); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const height = Math.min(330, Math.max(130, below >= 200 || below > rect.top ? below : rect.top - 8));
      const top = below >= 200 || below > rect.top ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, width, maxHeight: height });
    };
    place(); searchInput.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    const outside = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('mousedown', outside); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, open, id]);
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) show(); else setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(options.length, 1)); }
    else if (event.key === 'Enter' && open) { event.preventDefault(); if (options[active]) choose(options[active].value); }
    else if (event.key === 'Home' && event.target === trigger.current) { event.preventDefault(); setActive(0); }
    else if (event.key === 'End' && event.target === trigger.current) { event.preventDefault(); setActive(options.length - 1); }
    else if (event.key === 'Tab' && open) setOpen(false);
  }
  return <div ref={anchor} className="language-field"><span id={`${id}-label`}>{label}</span><button ref={trigger} type="button" className="language-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : show()} onKeyDown={keyDown}><span id={`${id}-value`}>{selected}</span><ChevronDown size={14}/></button>{open && createPortal(<div ref={panel} className="language-menu" style={position}><div className="language-search"><Search size={15}/><input ref={searchInput} role="combobox" aria-label={t.searchLanguages} aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={options[active] ? `${id}-option-${active}` : undefined} placeholder={t.searchLanguages} value={query} maxLength={80} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={keyDown}/></div><div id={`${id}-list`} className="language-list" role="listbox" aria-label={label}>{options.map((option, index) => <React.Fragment key={`${option.group}-${option.value}`}>
    {(index === 0 || options[index - 1].group !== option.group) && option.group !== 'auto' && <div className="language-group" role="presentation">{option.group === 'popular' ? t.popularLanguages : option.group === 'custom' ? t.customLanguage : search ? t.searchResults : t.allLanguages}</div>}
    <button type="button" id={`${id}-option-${index}`} role="option" aria-selected={value === option.value} tabIndex={-1} className={`language-option ${active === index ? 'is-active' : ''}`} onMouseMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option.value)}><span><strong>{option.label}</strong>{option.hint && option.hint !== option.label && <small>{option.hint}</small>}</span>{value === option.value && <Check size={15}/>}</button>
  </React.Fragment>)}{options.length === 0 && <p className="language-empty">{t.noLanguages}</p>}</div></div>, document.body)}</div>;
}
