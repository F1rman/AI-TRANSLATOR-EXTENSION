# Завершення Google-входу

Це одноразове налаштування власника акаунтів. Chrome Extension OAuth-клієнт прив'язаний до постійного ID розширення. Cloud/Firebase-доступ не надає доступу до браузерного Chrome Web Store Developer Dashboard.

## Поточний стан

Брендинг підтверджено Google. Item ID розширення: `aieamemimbcbbnmakifejomadhegogge`. Його origin `chrome-extension://aieamemimbcbbnmakifejomadhegogge` доданий до authorized domains Firebase. У Firebase Google provider вже ввімкнений з Client ID `1060412514800-sgi62cmd32etai488n2ubjjv89n6j447.apps.googleusercontent.com`.

OAuth-клієнт розширення вже доданий до збірки: `1060412514800-4j2utpmaak9lbknl5d077ffaoe6e3ei6.apps.googleusercontent.com`. Його конфігурацію надано з проєкту `ai-translator-ext`; чинний клієнт Google provider Firebase збережено.

Store public key збережено в [extension/store-public-key.txt](../extension/store-public-key.txt) та додано до збірки. Перевірено, що SHA-256 цього ключа дає ID `aieamemimbcbbnmakifejomadhegogge`, і Chromium завантажує розширення саме з цим ID.

Зібрано `artifacts/ai-translator-1.1.3.zip` для оновлення наявної чернетки Store. Версію підвищено для завантаження нового пакета. Налаштування Google-входу повністю задані; реальний вхід ще потрібно пройти у звичайному Google Chrome. Автоматизований Chromium перевіряє ID, ініціалізацію Firebase, інтерфейс та DOM-переклад; його обмеження Google identity не дозволяють підтвердити вхід користувача.

Firebase Google provider використовує OAuth-клієнт типу **Web application**; `chrome.identity` у розширенні використовує окремий клієнт типу **Chrome Extension**, прив'язаний до Item ID. За самим рядком Client ID визначити його тип неможливо: перевірити його можна на [сторінці Clients](https://console.cloud.google.com/auth/clients?project=ai-translator-ext). Наявний Firebase-клієнт зберігаємо; у `VITE_GOOGLE_CLIENT_ID` потрібно вказати саме Chrome Extension клієнт.

## Кроки налаштування

1. Зібрати ZIP: `npm run build` → `npm run package`.
2. У [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) відкрити наявний item `aieamemimbcbbnmakifejomadhegogge` і завантажити оновлений `artifacts/ai-translator-1.1.3.zip` у **Package**. Зберегти як чернетку, без подання на модерацію. Новий item не створювати.
3. У **Package → View public key** скопіювати public key. Видалити BEGIN/END PUBLIC KEY та переноси рядків. Приватного ключа для цього не потрібно.
4. У [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=ai-translator-ext) налаштувати назву **AI Translator**, контакт власника, зовнішню аудиторію та посилання на домашню сторінку/приватність. У полі **App logo** завантажити [ai-translator-oauth-120.png](../assets/branding/ai-translator-oauth-120.png) — готовий PNG 120×120. Великий оригінал — [ai-translator-logo-master.png](../assets/branding/ai-translator-logo-master.png). [Вимоги Google до логотипа](https://support.google.com/cloud/answer/15549049?hl=en): квадратне зображення, до 1 MB, рекомендовано 120×120. Для тестування додати потрібні Google-акаунти як test users; для публічного доступу перевести OAuth app у Production.
5. На сторінці **Clients** перевірити OAuth-клієнт `1060412514800-4j2utpmaak9lbknl5d077ffaoe6e3ei6.apps.googleusercontent.com`: тип **Chrome Extension**, Item ID — `aieamemimbcbbnmakifejomadhegogge`. Client ID і public key уже додані до збірки.
6. Додати до `extension/.env.production`:

```dotenv
VITE_GOOGLE_CLIENT_ID=1060412514800-4j2utpmaak9lbknl5d077ffaoe6e3ei6.apps.googleusercontent.com
# EXTENSION_PUBLIC_KEY можна не задавати: збірка читає extension/store-public-key.txt.
```

7. Origin розширення вже дозволений у Firebase. Для повторного налаштування: `python3.12 scripts/configure_google.py --client-id 1060412514800-4j2utpmaak9lbknl5d077ffaoe6e3ei6.apps.googleusercontent.com --extension-id aieamemimbcbbnmakifejomadhegogge`. Скрипт зберігає наявний Web application клієнт Google provider Firebase і додає extension origin до authorized domains. Він не замінює Firebase Web client на Chrome client.
8. Перезібрати розширення та ZIP. Завантажити розпаковану `extension/dist`, перевірити збіг ID з Store, увійти Google, виконати короткий переклад і переклад сторінки. Перевірити вихід і повторний вхід.
9. Оновити ZIP у тій самій чернетці. Новий Store item створювати не потрібно.

Фінальну перевірку Google-входу не можна позначати пройденою, поки її не виконано зі справжнім Google-акаунтом. Клієнтські Firebase config, OAuth Client ID і Store public key — публічні параметри; upstream API-токен до ZIP не додається.

Довідка: [стабільний ID та OAuth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth), [Firebase для Manifest V3](https://firebase.google.com/docs/auth/web/chrome-extension).
