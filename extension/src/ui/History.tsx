import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { send } from '../shared/protocol';
import type { HistoryPage, UiLanguage } from '../shared/protocol';
import { messages } from './i18n';

export function History({ locale, refreshKey }: { locale: UiLanguage; refreshKey: string }) {
  const t = messages[locale];
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const scope = useRef(refreshKey); scope.current = refreshKey;
  const refresh = async () => { const key = refreshKey; const page = await send<HistoryPage>({ type: 'history:list' }); if (scope.current === key) setHistory(page); };
  useEffect(() => { setHistory(null); setError(''); let active = true; void refresh().catch(reason => { if (active) setError(reason.message); }); return () => { active = false; }; }, [refreshKey]);
  async function action(request: Parameters<typeof send>[0]) {
    setWorking(true); setError('');
    try { await send(request); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(false); }
  }
  return <section className="translation-history" aria-label={t.history}>
    <div className="history-heading"><h2>{t.history}</h2><button className="quiet-button" disabled={working || !history?.total} onClick={() => { if (confirm(t.historyConfirm)) void action({ type: 'history:clear' }); }}>{t.historyClear}</button></div>
    <p className="history-help">{t.historyLocal}</p>
    <label className="setting-toggle"><input type="checkbox" checked={history?.recording ?? true} disabled={!history || working} onChange={event => void action({ type: 'history:recording', payload: { enabled: event.target.checked } })}/><span>{t.historyRecording}</span></label>
    {history && history.limit < history.total && <p className="history-help">{t.historyMore}</p>}
    {history?.entries.length === 0 && <p className="history-help">{t.historyEmpty}</p>}
    {history?.entries.map(entry => <article className="history-entry" key={entry.id}>
      <div className="history-heading"><small>{entry.sourceLanguage} → {entry.targetLanguage} · {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(entry.createdAt)}</small><button className="icon-button" disabled={working} aria-label={t.historyDelete} onClick={() => void action({ type: 'history:delete', payload: { id: entry.id } })}><Trash2 size={16}/></button></div>
      <details><summary>{entry.source.slice(0, 140)}{entry.source.length > 140 ? '…' : ''}</summary><p dir="auto">{entry.source}</p><p className="history-translation" dir="auto">{entry.translation}</p></details>
    </article>)}
    {error && <p role="alert" className="error-box">{error}</p>}
  </section>;
}
