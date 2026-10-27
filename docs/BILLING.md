# Пакети перекладів

Оплатою та цінами керує спільний BALUBENKO-STRIPE. AI Translator зберігає свої Google-акаунти у Firebase `ai-translator-ext` та перевіряє витрати на власному сервері. Кнопки «Купити пакет» й «Мої покупки» відкривають `/pay?product=ai-translator-extension` та `/account?product=ai-translator-extension` на `https://balubenko-stripe.web.app`. Для іншого billing-домену перед збіркою задай публічне `VITE_BILLING_BASE_URL` — точний HTTPS origin без шляху. Токени не передаються у посиланнях; на сайті користувач входить тим самим Google-акаунтом.

Пакет поповнює окремі баланси слів і картинок без строку дії. Free залишається 10 000 слів і 5 картинок за календарний місяць UTC, ручний Pro — 200 000 і 150. Сервер спочатку резервує місячний allowance, а потім покупки у FIFO-порядку. `/v1/me` та відповіді job мають `prepaid: {words, images, reservedWords, reservedImages}`; `words` і `images` — доступний придбаний залишок. Покупка не змінює `plan` на Pro.

## Доставка оплат

У Cloud Run налаштуй:

```dotenv
BILLING_ENVIRONMENT=live
BILLING_SERVICE_ACCOUNT=dedicated-billing-sender@your-billing-project.iam.gserviceaccount.com
BILLING_AUDIENCE=https://ai-translator-api-1060412514800.europe-west1.run.app/internal/billing-sync
```

Акаунт відправника має бути окремим від `TASK_SERVICE_ACCOUNT`. Сервер приймає лише Google OIDC ID token з точною audience та цим підтвердженим email. Firebase ID tokens користувачів і токени черги не дають права зарахувати покупку. До налаштування відправника endpoint повертає 503; development auth для цього endpoint немає. Скрипт `scripts/deploy_backend.py` вимагає явний `--environment test` або `--environment live`, щоб тестове оновлення не потрапило у робочий сервіс. Відправника можна передати через `--billing-sender`; якщо його не передати, скрипт зберігає вже налаштованого відправника.

BALUBENKO-STRIPE викликає `POST /internal/billing-sync` з тілом:

```json
{
  "orderId": "stable_order_id",
  "environment": "live",
  "productId": "ai-translator-extension",
  "authProjectId": "ai-translator-ext",
  "uid": "firebase_uid",
  "revision": 1,
  "purchasedAt": 1792886400,
  "words": 50000,
  "images": 20,
  "netGrantedWords": 50000,
  "netGrantedImages": 20,
  "paymentState": "paid"
}
```

Це приклад протоколу, а не початковий тариф. Ціни та обсяги задає адміністратор у BALUBENKO-STRIPE. Допустимі стани: `pending`, `paid`, `partially_refunded`, `refunded`, `disputed`, `failed`, `expired`. Додатні grant дозволені лише для `paid` і `partially_refunded`.

`orderId`, користувач, проєкт, середовище, дата й початкові обсяги незмінні. Більша `revision` застосовує актуальний кумулятивний grant; старі повідомлення ігноруються, однакові ревізії з різними даними відхиляються. Відповідь `{ok, applied, revision}` підтверджує завершену транзакцію, тому втрачений HTTP acknowledgement можна безпечно повторити.

Канонічні покупки зберігаються в `translationPurchases`, а акаунт — лише агрегований баланс і резерви активних job. Створення/завершення job і зміни відповідних покупок проходять однією Firestore-транзакцією. Повні повернення та спори змінюють cap лише своєї покупки; часткові повернення надходять як пропорційно зменшений cap. Доступний залишок дорівнює `max(0, grant − consumed − reserved)`. Боргу немає, інші покупки не зачіпаються. Прийнятий резерв може завершитися після повернення; скасований резерв повертається тільки в межах поточного cap. Виграний спір відновлює тільки невикористану частину, вже списане не додається повторно.

## Тестове середовище

Production за замовчуванням приймає лише `live`. `test`-повідомлення у live endpoint відхиляється до зміни будь-яких даних. Окремий staging Cloud Run сервіс використовує `BILLING_ENVIRONMENT=test`, власні queue/audience та робочий upstream лише для явно запущених перевірок. Firestore repository автоматично використовує колекції з префіксом `test_` для всіх даних перекладача, включно з акаунтами, резервами, покупками та ручними grants. Staging не читає й не змінює live-баланси. Ключів Stripe у розширенні й цьому backend немає.

Перевірки: `npm run test:backend`, `npm --prefix extension run typecheck`, `npm run test:extension`, `npm run build`. Backend-тести покривають повтори й перестановку зарахувань, конкурентні покупки/списання, місячний rollover, повернення й спори, резерви під час refund, prepaid images та неправильну identity/environment. Браузерні тести перевіряють кнопки покупки/історії, оновлення балансу та доступ після вичерпання місячної квоти.


## Розгорнуте тестове середовище

Тестовий API: https://ai-translator-api-test-1060412514800.europe-west1.run.app. Канонічні публічні параметри записані у `deployment.test.json`; робочий `deployment.json` і налаштування розширення залишаються окремими.

```sh
python3 scripts/deploy_backend.py --environment test --dry-run
python3 scripts/deploy_backend.py --environment test --billing-sender billing-runtime@balubenko-stripe.iam.gserviceaccount.com
```

Оновлення вже зібраним образом без повторного Cloud Build:

```sh
python3 scripts/deploy_backend.py --environment test --skip-build --image europe-west1-docker.pkg.dev/ai-translator-ext/ai-translator/backend:test-billing-20261026 --billing-sender billing-runtime@balubenko-stripe.iam.gserviceaccount.com
```

- Cloud Run `ai-translator-api-test`: мінімум 0, максимум 2 інстанси, 1 CPU, 2 GiB, timeout 600 с.
- Runtime `ai-translator-test-runtime@ai-translator-ext.iam.gserviceaccount.com`: Firestore, перевірка Firebase Auth, постановка задач; доступ лише до наявного upstream secret через Secret Manager reference та спільного image bucket.
- Queue `translation-jobs-test`: до 1 запиту/с та 2 паралельних задач. OIDC-відправник `ai-translator-test-tasks@ai-translator-ext.iam.gserviceaccount.com` відрізняється від робочого.
- Recovery scheduler `recover-translation-jobs-test` викликає лише тестовий `/internal/reconcile` щохвилини. Робочий scheduler не змінюється.
- Billing sender `billing-runtime@balubenko-stripe.iam.gserviceaccount.com`, exact audience `https://ai-translator-api-test-1060412514800.europe-west1.run.app/internal/billing-sync`. Цьому відправнику надано `roles/firebaseauth.viewer` у `ai-translator-ext` для перевірки токенів користувачів.
- Auth authorized domains містять `balubenko-stripe.web.app`. Вхід на платіжній сторінці використовує Firebase Web App перекладача; токени Google Cloud CLI мають іншу OAuth audience і для входу покупця не підходять.

Спільний image bucket використовує випадкові UUID шляхів job, тому тестові задачі не перезаписують робочі картинки. Усі записи Firestore staging мають `test_` prefix. Індекси purchase lots і виключення вкладених activeJobs із індексації додані через Firestore Admin API без зміни клієнтських rules. У staging дозволено реальний upstream: запускайте лише невеликі синтетичні перевірки, вони також витрачають AI-токени.

## Розширення 1.2.0 і перевірка середовища

`GET /v1/me` повертає `billing: {environment: "live" | "test", purchasesEnabled: boolean}`. `purchasesEnabled` істинне лише за наявності налаштованих billing sender та audience. Ця ознака не замінює перевірку каталогів або наявності live-цін. Background паралельно читає public `/api/config?productId=ai-translator-extension` без токенів/cookies, перевіряє environment і Firebase identity та додає клієнтський `billingAvailability`. Перед кожним `billing:open` ці дані запитуються повторно. Без `billing` у старому API чи без central config купівля вимкнена; звичайний переклад працює. Історія доступна при збігу середовища навіть за вимкнених нових покупок.

Середовища задаються `extension/billing-targets.json`. Live: `https://balubenko-stripe.web.app`; test: `https://balubenko-stripe-test.web.app`. Відповідні API відрізняються суфіксом сервісу `-test`. `npm run build`/`npm run package` пишуть лише `extension/dist` і release ZIP; `npm run build:test`/`npm run package:test` — `extension/dist-test` та `-test.zip`. Скрипт відхиляє явні VITE overrides, що суперечать вибраному середовищу, й зберігає стабільний Store ID. Packaging перевіряє public build metadata, версію та ID. Ці команди не змінюють cloud state.
