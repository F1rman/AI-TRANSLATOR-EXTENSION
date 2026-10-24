# Listing copy and Store form

Prepared 2026-10-23 from the packaged extension and current source. All work in this task is confined to meta/. The existing Store item aieamemimbcbbnmakifejomadhegogge is a draft; no listing was published, uploaded, or hosted.

## Ready material

- Primary keyword: webpage translator, selected by the research task. Recommended name: “Webpage Translator – AI Translator” (names option 0, 34 characters). This keeps the existing brand and puts the primary phrase first.
- Recommended short description: “Read pages in your language with a webpage translator. Translate selected text and show the original when needed.” (short option 1, 113 characters). The other four options remain selectable independently.
- data/names.json contains five names and five short descriptions. All pass the 75/132 character limits. “AI Translator” remains an exact current-name alternative. No candidate contains a third-party brand. Similar AI Translator listings exist, so generic-word flags are not trademark clearance.
- descriptions/en.txt is 434 words, plain text, with the primary phrase three times. It covers selection and popup translation, page replacement, dynamic text, restoration, UI languages, account requirements, daily allowance, processing, and limits.
- data/dashboard.json recommends Productivity → Tools from the competitor category tally (4/8). It provides single-purpose text and covers all six manifest permissions plus both HTTP(S) host patterns. No unused permission was found. activeTab is explicitly marked potentially redundant because broad host grants overlap its current-tab flow.
- locales/en/messages.json drafts the recommended name and short description plus English review/welcome strings. No other language catalog or translated description was created: translate mode was not requested.
- data/recommendations.json contains adapted, unapplied review and welcome code, the manifest-locale source change, and activeTab follow-up. Review counting uses five unique confirmed completed jobs; repeated polls do not increment the count. Both submitJob and translation:get must record completed results, including idempotent POST retries that skip GET polling. The recommendation uses real background/UI paths, local storage, runtime-ID review links, a 14-day first dismissal, a permanent second dismissal, and idle-only placement. A page batch counts as one result, so a long page may reach the threshold within one session.

## Locale findings

The actual built directory extension/dist was audited, not a source directory without a manifest. It has no _locales, no default_locale, and literal name/description fields. The UI's separate uk/en dictionaries do not establish packaged listing locale coverage.

- audits/locales-built.json: 0/55 baseline catalogs; literal manifest strings and absent _locales.
- audits/locales-with-en-draft.json: English draft visible as an overlay; 54 baseline catalogs still missing, and the manifest remains incompatible with directly packaging that overlay until the proposed source changes are implemented.
- The official Chrome locale table was checked on 2026-10-23 and still matches the skill's 55-locale baseline: https://developer.chrome.com/docs/extensions/reference/api/i18n#locales .

Future implementation must edit extension/scripts/build.mjs, copy source catalogs into the build, and rebuild; generated dist files should not be edited directly. The proposed manifest lines are default_locale: 'en', name: '__MSG_appName__', description: '__MSG_appDescription__'. A broader UI string migration is separate. English copy has not undergone external or native-speaker review.

## Evidence and boundaries

- extension/dist/manifest.json establishes version 1.0.1, permissions, HTTP(S) content scripts, all_frames, Google scopes, literal metadata, and no locale configuration.
- extension/src/background.ts: createMenus, startPage, changePage, submitJob, ownJob, navigation handlers, and the existing onInstalled listener establish context-menu translation, frame targeting, authenticated jobs, cancellation, restoration, and lack of onboarding.
- extension/src/content/dom.ts and extension/src/content/index.ts establish eligible text traversal, dynamic updates, input/code/hidden exclusions, conservative restoration, selection modes, and page progress. They do not establish support for every website or every language.
- extension/src/ui/main.tsx, extension/src/ui/i18n.ts, extension/src/content/ui.ts, and extension/src/shared/protocol.ts establish popup translation, 4,000-character input, appearance options, and separate Ukrainian/English interfaces.
- extension/src/auth.ts establishes Chrome Identity plus Firebase sign-in. The built configuration exists, but docs/GOOGLE_SIGN_IN.md explicitly records that real Google-account sign-in still needs a regular Chrome test. No marketing check marks it verified.
- backend/app/config.py and backend/app/service.py establish 20,000 source Unicode characters per user per UTC day, reservation before processing, settlement after success, and two concurrent jobs. artifacts/backend-smoke.json verifies a real task/provider translation and quota behavior, not a real end-user Google login.
- hosting/privacy.html establishes temporary server job text/results, expiry marking after 24 hours with later TTL deletion, Google account processing, and OpenAI processing via the generation API. Copy does not promise offline use, zero retention, or that text never leaves the browser.
- Contact balubenko.ink@gmail.com was supplied by the owner. Only owned product artwork should be used; no third-party logos or endorsements are proposed by this copy task.

Validation: audits/copy-and-store-form.json records 5/5 names, 5/5 shorts, word and keyword counts, plain-text check, exact 8/8 permission coverage, locale state, and unverified/unimplemented features. No extension, backend, account, or live listing was changed by this task.
