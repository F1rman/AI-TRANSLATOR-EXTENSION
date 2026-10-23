# AI Translator для Chrome

Manifest V3 розширення: переклад виділення, введеного тексту й сторінок через AI, Google-вхід, довільні мови, світла/темна тема та добова квота 20 000 символів.

## Поточний стан

- Код розширення та сервера реалізований. Сервер, Firestore, Cloud Tasks, Firebase Auth і публічні сторінки налаштовані у **`ai-translator-ext`**.
- Джерело перекладів — наявний `https://balubenko-ai.web.app/api/generate`. Токен доступний лише серверу через Secret Manager.
- **Google-вхід очікує Store ID та OAuth Client ID типу Chrome Extension.** Брендинг підтверджений, Google provider Firebase ввімкнений. Для збірки потрібно створити чернетку Store та окремий Chrome Extension OAuth-клієнт; наявний Web application клієнт Firebase зберігається. Як завершити — [docs/GOOGLE_SIGN_IN.md](docs/GOOGLE_SIGN_IN.md).
- ZIP з суфіксом `-draft` призначений для створення чернетки Store. Це ще не фінальна збірка з робочим входом. На модерацію нічого не надсилалося.

## Встановлення локально

1. Відкрити `chrome://extensions` у Chrome 120 або новішому.
2. Увімкнути режим розробника → **Load unpacked / Завантажити розпаковане розширення**.
3. Обрати папку `extension/dist` або розпакувати ZIP і обрати отриману папку.
4. Закріпити іконку розширення. Для вже відкритих сайтів оновити сторінку.
5. Після налаштування OAuth увійти з Google та обрати мову перекладу.

Виділення спочатку показує значок; AI-запит починається після кліку. Миттєвий режим вмикається окремо. Переклад сторінки працює далі після закриття popup; кнопки зупинки й оригіналу є на сторінці.

Поля сайтів, редаговані області, прихований текст і блоки коду виключені. Підтримуються звичайні HTTP(S)-сторінки, доступні фрейми та відкриті Shadow DOM. Внутрішні сторінки Chrome, Chrome Web Store, вбудований PDF-переглядач, зображення, canvas і закриті Shadow DOM не підтримуються.

## Розробка

```sh
npm ci
npm --prefix extension ci
npm --prefix extension run typecheck
npm --prefix extension test
npm run build
npm run package
```

Публічні Firebase/OAuth налаштування задаються у `extension/.env.production`; приклад — `extension/.env.example`. `API_ACCESS_TOKEN` не належить до налаштувань розширення.

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m pytest backend/tests -q
npx playwright install chromium
npm run qa:browser
```

Браузерна перевірка завантажує зібране розширення в Chromium і перевіряє DOM-переклад з контрольованим транспортом. Вона не підміняє перевірку справжнього Google-входу. Знімки та звіти зберігаються в `artifacts/`.

## Сервер

Стан розгортання — `deployment.json`. Код і змінні середовища описані в [backend/README.md](backend/README.md).

```sh
python3.12 scripts/deploy_backend.py
python3.12 scripts/deploy_hosting.py
```

Ці скрипти використовують авторизований gcloud-акаунт та вже створені ресурси. Сервер не приймає довільні промпти від розширення: він формує інструкцію перекладу, виконує завдання через Cloud Tasks і перевіряє ID сегментів у відповіді AI.

Квота рахується за Unicode-символами вихідного тексту, резервується до обробки, списується після успіху та відновлюється після помилки/скасування. Доба — UTC. Початкові обмеження: 24 сегменти, 4 000 символів на завдання, 2 активні завдання на акаунт.

Публічні сторінки: [головна](https://ai-translator-ext.web.app), [приватність](https://ai-translator-ext.web.app/privacy), [допомога](https://ai-translator-ext.web.app/support).

Ключ Firebase Admin SDK, `.env`, приватні ключі й локальні залежності виключені з Git та пакування. Вихідна збірка Google Translate залишається лише локальним довідковим матеріалом.
