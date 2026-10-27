import React from 'react';
import { createRoot } from 'react-dom/client';
import { Brand } from './shared';
import './style.css';
const uk = navigator.language.startsWith('uk');
createRoot(document.getElementById('root')!).render(<main className="popup"><Brand/><section className="settings-card" role="status"><h1>{uk ? 'Переклад зображень недоступний' : 'Image translation is unavailable'}</h1><p>{uk ? 'AI Translator тепер працює з текстом і вебсторінками.' : 'AI Translator now translates text and webpages.'}</p><a href="options.html">{uk ? 'Відкрити налаштування' : 'Open settings'}</a></section></main>);
