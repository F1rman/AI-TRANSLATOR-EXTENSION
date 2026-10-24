# Матеріали для Chrome Web Store

**Назва:** AI Translator

**Короткий опис EN:** Translate selected text and whole webpages with AI. Restore originals in one click.

**Короткий опис UK:** Перекладайте виділений текст і сторінки за допомогою AI. Повертайте оригінал одним кліком.

## Опис EN

Understand every word, without losing your place. AI Translator translates selected text, text you type, and entire webpages with AI.

- Select a phrase and click the small translation icon.
- Translate a webpage while keeping its links and structure.
- Translate newly appearing page text as you scroll.
- Restore the original text whenever you want.
- Choose a language from the list or enter any other language name.
- Search the language list by English, Ukrainian, native name or language code.
- Pro: right-click a public static image to create and download a PNG with translated text.
- Make it yours with light/dark themes and Ukrainian/English interfaces.

Sign in with Google. Free access includes 20,000 source characters per account each day, resetting at midnight UTC. Long pages may exceed the remaining allowance. AI-generated translations can contain errors.

Pro access is granted manually and includes five successful image translations per UTC day. There is no payment or subscription checkout. PNG, JPEG and WebP images must be static, no larger than 10 MB and 20 megapixels. AI editing can alter small details; inspect the result before use.

Page text is sent for translation only when you start page translation; the optional instant-selection mode sends selected text automatically. Website inputs, editable areas, hidden elements, and code blocks are excluded. Internal Chrome pages, PDF documents and canvas text are not supported. Page translation skips image text; Pro image translation is a separate context-menu action.

For Pro image translation, selected image bytes are sent to our server and OpenAI. A vision step recognizes and translates visible text; image editing receives the exact replacements and creates a new PNG. Original and translated images are stored privately with authenticated owner access for 24 hours; automatic deletion may occur later. Failed and cancelled jobs trigger immediate deletion attempts. The text allowance stays 20,000 characters on both plans.

## Посилання

- Homepage: https://ai-translator-ext.web.app
- Privacy: https://ai-translator-ext.web.app/privacy
- Support: https://ai-translator-ext.web.app/support

## Пояснення дозволів

- Site access HTTP(S): показ значка виділення та переклад текстових вузлів і доступних фреймів.
- activeTab / scripting: отримання виділення та підключення скрипта на поточній вкладці.
- contextMenus: переклад виділення, сторінки або картинки через праву кнопку.
- storage: мови, тема, стан активного перекладу та відновлення popup.
- identity: Google-вхід без доступу до пошти, файлів або контактів.
- webNavigation: скасування застарілих завдань і обробка фреймів після навігації.

## Дані для Privacy practices

Описати обробку базових даних акаунта, токенів сесії та тексту сайту відповідно до опублікованої політики. Дані потрібні для входу, перекладу й квоти; рекламного використання немає. Усі JavaScript-модулі входять у пакет; AI API повертає дані, а не виконуваний код.

Для 1.1.0 також розкрити обробку вибраних зображень сайту, оригіналу та згенерованого PNG, Pro entitlement і окремих image-лічильників. URL картинки зберігається лише в session storage розширення для відновлення; backend отримує байти, а не URL. Сховище картинок приватне, доступ до файлів має лише власник завдання. Нових Chrome-дозволів у 1.1.0 немає.

Пакет релізу: `artifacts/ai-translator-1.1.0.zip`. Розгорнутий опис для копіювання також оновлений у `meta/descriptions/en.txt`; варіанти SEO-назви залишаються чернетками.

Скріншоти в `artifacts/screenshots/`. Перед поданням перевірити фінальний OAuth, актуальний ZIP, контакт розробника та знімки потрібного Store розміру. Подання на модерацію — окремий етап.
