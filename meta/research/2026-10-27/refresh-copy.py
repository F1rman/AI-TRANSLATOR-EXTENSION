import json
from pathlib import Path
from datetime import datetime, timezone
R=Path(__file__).resolve().parents[2]
def read(f):return json.loads((R/f).read_text())
def save(f,x):(R/f).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
names={
 'primaryKeyword':'webpage translator',
 'names':[
  {'text':'AI Translator – Text & Webpage Translator','keyword':'webpage translator','trademark':'caution','pattern':'Established brand + text and page tasks'},
  {'text':'AI Translator – Translate Text, Read Pages','keyword':'ai translator','trademark':'caution','pattern':'Established brand + user outcomes'},
  {'text':'Webpage Translator – AI Translator','keyword':'webpage translator','trademark':'caution','pattern':'Primary task + established brand'},
  {'text':'AI Translator: Selected Text & Page Translation','keyword':'ai translator','trademark':'caution','pattern':'Established brand + entry points'},
  {'text':'AI Translator','keyword':'ai translator','trademark':'caution','pattern':'Existing package brand only'}
 ],
 'shortDescriptions':[
  {'text':'Translate text with AI and keep local history. Pro adds webpage translation, tone and optional context.','keyword':'translate text'},
  {'text':'Translate selected text or paste into the popup. Upgrade to Pro for full-page translation and page context.','keyword':'translate selected text'},
  {'text':'AI webpage translator with a Free text plan and Pro page translation. Choose your language and restore originals.','keyword':'webpage translator'},
  {'text':'Read foreign-language text in your browser. Free includes 100,000 characters monthly; Pro adds page translation.','keyword':'page translation'},
  {'text':'Translate text, save local history, and choose neutral wording. Pro adds formal, friendly and technical tones.','keyword':'translate text'}
 ],
 'recommended':{'name':0,'short':0},
 'reason':'Retains the established AI Translator identity, includes the precisely researched webpage translator phrase, and names text translation as the Free entry point. The summary clearly reserves page translation, tones and page context for Pro.',
 'brandCollision':{'state':'caution','note':'Several current listings use AI Translator. Generic descriptive wording does not establish trademark clearance or a unique brand. Preserve the original icon and developer identity, and distinguish this product from similarly named listings.','examples':['https://chromewebstore.google.com/detail/hbblhboakojbegilahlbppmmkogdgehp','https://chromewebstore.google.com/detail/hkelkkhcmkhbpkenoogdeomannakpilk'],'verifiedAt':'2026-10-27'}
}
save('data/names.json',names)
loc=read('locales/en/messages.json')
loc['appName']['message']=names['names'][0]['text']
loc['appDescription']['message']=names['shortDescriptions'][0]['text']
loc['welcomeIntro']['message']='Translate typed or selected text with AI. Pro also translates webpages and can restore the original text.'
loc['welcomeFirstResult']['message']='Paste text into the popup or select text on a webpage and click the translate icon. Page translation requires Pro.'
loc['welcomeAllowance']['message']='Free includes 100,000 source characters per calendar month and up to 4,000 per translation. Pro includes 2,000,000 per monthly subscription window and up to 50,000 per translation, for $4.99/month or $39.99/year.'
loc['welcomePrivacy']['message']='Translation text is sent for server-side AI processing. Instant selection sends selected text automatically when enabled. Pro page translation also processes newly appearing page text; optional page context sends up to 2,000 visible surrounding characters. Translation history stays on this device, separated by account, with no cloud sync.'
save('locales/en/messages.json',loc)
description='''AI Translator helps you translate text while reading and working in your browser. Paste text into the popup, translate a selection on a webpage, or use the Pro webpage translator to read an eligible page in your chosen language.

TEXT TRANSLATION
• Translate typed or pasted text in the popup.
• Select text on a webpage and use the translation icon or context menu.
• Detect the source language automatically or choose it yourself.
• Copy the result and find completed translations in local history.

FREE
Free includes 100,000 source characters per calendar month and up to 4,000 characters per translation. Spaces count toward the limit. Your allowance resets on the first day of each month at 00:00 UTC; unused characters do not roll over.

Free uses neutral tone and shows the latest 20 history entries. Google sign-in is required to translate and track your account allowance.

PRO
Pro costs US$4.99 per month or US$39.99 per year and includes:
• 2,000,000 source characters per monthly subscription window, with up to 50,000 per translation. Annual billing still provides a separate monthly allowance.
• Page translation on eligible websites, including newly appearing text during an active session. Pause translation or restore the original text when needed.
• Neutral, formal, friendly and technical translation tones.
• Optional context from up to 2,000 visible surrounding characters on the current page. You control whether this is used.
• Access to up to 1,000 local history entries and a priority processing queue. Processing times can vary.

Your Pro allowance renews monthly from the subscription start date, including on the annual plan. Renewals do not carry unused characters forward. Manage or cancel renewal through your account; cancelling renewal keeps access until the end of the paid period.

HOW TO START
1. Pin AI Translator to the toolbar and open the popup.
2. Sign in with Google and choose your languages.
3. Paste or select text and translate. For webpage translation, choose Pro and then start translation on an eligible page.

PRIVACY AND LOCAL HISTORY
Requested source text is sent to the translation backend for AI processing. When instant-selection mode is enabled, selected text is sent automatically. An active Pro page session also sends eligible new page text as it appears. Optional Pro context excludes input fields, passwords and hidden text; it does not send page HTML as context.

History is stored in the extension on this device, separated by account and environment, without cloud synchronization. Recording can be disabled; entries can be deleted individually or cleared. Storage retains at most 1,000 entries or 25 MiB, removing the oldest when needed. Free shows the latest 20; downgrading alone does not delete older entries.

The interface is available in English and Ukrainian. Chrome internal pages and the Chrome Web Store cannot be translated.

Privacy: https://ai-translator-ext.web.app/privacy
Terms: https://balubenko-stripe.web.app/ai-translator-terms
Support: https://ai-translator-ext.web.app/support
'''
(R/'descriptions/en.txt').write_text(description)
d=read('data/dashboard.json')
d['singlePurpose']='Translate typed or selected text and, with Pro, eligible webpage text into a chosen language. Related controls provide language detection, optional visible page context, translation tones, local translation history, and restoring original webpage text.'
d['categoryEvidence']='Fresh 2026-10-27 snapshots: four of eight direct competitors use productivity/tools, two communication, one workflow and one education. Tools matches this extension’s primary translation workflow.'
just={
 'activeTab':"The popup reads selected text from the current tab’s accessible frames after the user opens the extension, using chrome.tabs.query and chrome.scripting.executeScript in extension/src/ui/main.tsx. This is a real current-tab user gesture flow. Because the package also declares persistent HTTP(S) host permissions for the selection icon, activeTab may be redundant on those sites; verify a narrower permission design separately before removal.",
 'contextMenus':"Adds Translate selection and Translate page commands using createMenus and chrome.contextMenus.onClicked in extension/src/background.ts. The selection command sends the chosen text to the content script; the page command starts the Pro workflow or opens the Pro purchase page for Free access. There is no current image command. Browser context menu entries require this API permission.",
 'storage':"Uses chrome.storage.local for language, theme, interface, selection, tone and page-context preferences, and chrome.storage.session for account/environment-scoped popup drafts, pending requests, page sessions and job ownership. These extension-wide settings and recoverable service-worker state cannot use an individual website’s storage. Completed translation history separately uses local IndexedDB, partitioned by account and environment, without cloud sync. Evidence: extension/src/background.ts settings/saveSettings/withSession, extension/src/shared/drafts.ts, and extension/src/shared/history.ts.",
 'scripting':"Reads selected text from accessible frames when the user opens the popup, and injects packaged content.js if an existing user-selected page lacks the content script. Evidence: extension/src/ui/main.tsx popup selection capture and extension/src/background.ts startPage fallback. chrome.scripting is needed for those dynamic operations; no remote executable code is fetched.",
 'identity':"Uses chrome.identity.getAuthToken for Google sign-in and exchanges the credential for Firebase authentication. The verified account authorizes translation, tracks monthly character usage and connects subscription access. Sign-out clears cached tokens. Only openid, email and profile scopes are requested; Gmail, Drive, contacts and other account content are not requested. Evidence: extension/src/auth.ts login/logout/getIdToken and manifest.oauth2.scopes.",
 'webNavigation':"Enumerates documents and frames for user-started Pro page translation and handles their lifecycle. Navigation cancels jobs tied to old documents; eligible new frames join an active page session. History-state and fragment navigation end the old session. Evidence: extension/src/background.ts startPage/changePage getAllFrames and onCommitted/onDOMContentLoaded/onHistoryStateUpdated/onReferenceFragmentUpdated. activeTab does not provide these frame and navigation events. These events are used to manage active translation, not to compile browsing history.",
 'http://*/*':"Runs packaged content.js on ordinary HTTP webpages and accessible frames so the selected-text icon is ready on arbitrary sites. After user activation, Pro page translation reads eligible text, observes newly appearing text, replaces translations and restores originals. Optional context reads only eligible visible surrounding text. A fixed domain list would exclude arbitrary sites; activeTab alone would require manual activation before the current automatic selection-icon experience. Optional per-site permission would require a separate product-flow change. Evidence: manifest.content_scripts.matches/all_frames and extension/src/content/index.ts, dom.ts and context.ts. No image translation or image download is offered.",
 'https://*/*':"Provides the same selection icon, requested text translation and user-started Pro page translation on ordinary HTTPS sites and accessible frames. It also allows HTTPS requests to translation and authentication services. Backend-only host access would not support translating arbitrary websites; activeTab alone would not supply the pre-existing selection icon before a toolbar/menu action. Evidence: manifest.host_permissions/content_scripts, extension/src/content/index.ts/dom.ts/context.ts, extension/src/background.ts api, and extension/src/auth.ts. Chrome internal pages and the Web Store remain restricted. No image translation or image download is offered."
}
for p in d['permissions']:
 p['justification']=just[p['permission']]
 p['unused']=False
 if p['permission']=='activeTab':
  p['redundant']=True;p['review']='Real current-tab selection flow; potentially redundant with persistent HTTP(S) access. The marketing workflow does not remove permissions.'
d['publicationStatus']='Owner-supplied existing draft item, not a confirmed public listing. 2026-10-27 own-listing collection found no parsed listing; absence from search is reported only for the checked results.'
d['releaseChecks']=[
 'Choose and apply listing copy in the Store dashboard; all files here are local proposals and have not been published.',
 'Apply proposed manifest locale keys/default_locale in source separately before localized message catalogs can be packaged. The current UI dictionaries support English and Ukrainian, while manifest catalogs are absent.',
 'Review broad persistent website access and the potentially redundant activeTab permission against the actual selection-icon workflow.',
 'Owner should confirm current privacy and terms pages match monthly characters, recurring billing, local history and opt-in visible context before Store submission.',
 'Run a real account sign-in/sign-out and production purchase/cancellation acceptance flow where required; deterministic marketing captures do not prove real billing acceptance.'
]
d['billing']={'currency':'USD','freeMonthlyCharacters':100000,'proMonthlyCharacters':2000000,'freeMaxCharactersPerTranslation':4000,'proMaxCharactersPerTranslation':50000,'proMonthlyPrice':4.99,'proAnnualPrice':39.99,'annualAllowance':'Monthly windows, not all annual characters at once','sourceEvidence':['docs/RELEASE_1.3.0.md','backend/app/limits.json','extension/src/ui/shared.tsx']}
d['dataHandling']={'transfers':'Requested text and opted-in page context go to the translation backend for server-side AI processing. Instant selection automatically sends selected text when enabled; an active page translation session processes eligible new text.','history':'Local IndexedDB; separated by account/environment, no cloud sync, maximum 1,000 entries or 25 MiB. Free view latest20, Pro up to1000. Delete/clear/disable supported.','pageContext':'Pro opt-in; at most2,000 visible surrounding characters; input/password/hidden text and HTML excluded.'}
d['verifiedAt']='2026-10-27'
save('data/dashboard.json',d)
recommendations=read('data/recommendations.json')
for x in recommendations:
 if 'Review ask' in x['title']:
  x['integrationPoints']=[
   'extension/src/background.ts: submitJob after rememberJob(job), before return job',
   'extension/src/background.ts: handle translation:get after ownJob/API/rememberJob, before return job',
   'extension/src/background.ts: requireUi(sender) for proposed review:rate and review:dismiss handlers',
   'extension/src/ui/main.tsx: idle popup footer; keep exactly 420px width',
   'extension/src/shared/protocol.ts: RuntimeRequest proposals; meta/locales/en/messages.json review strings'
  ]
  x['code']=x['code'].replace('// case \'review:rate\': return rateReview();',"// case 'review:rate': requireUi(sender); return rateReview();").replace('// case \'review:dismiss\': return dismissReview();',"// case 'review:dismiss': requireUi(sender); return dismissReview();")
  x['code']=x['code'].replace('// Also reject these two message types when sender.tab is present: only the\n// packaged popup may dismiss or launch the review page, not content scripts.','// Reuse existing requireUi(sender), which checks runtime ID and packaged URL.\n// Content scripts cannot dismiss or launch the review page.\n// Isolate storage failure with try/catch so a review counter cannot fail translation.')
  x['code']=x['code'].replace("if (request.type === 'translation:get') await recordTranslationSuccess(job);","if (request.type === 'translation:get') {\n  try { await recordTranslationSuccess(job); } catch { /* review telemetry is optional */ }\n}").replace('await recordTranslationSuccess(job);\n// POST', 'try { await recordTranslationSuccess(job); } catch { /* optional local state */ }\n// POST')
 if 'activeTab' in x['title'] and not x.get('code'):
  x['code']='// Separate source-review suggestion, not applied by this marketing task.\n// extension/scripts/build.mjs currently declares activeTab AND wildcard HTTP(S) hosts.\n// Confirm popup selection, fallback content injection and all_frames behavior after\n// removing activeTab in an isolated branch; then compare requested permissions.\n// Keep persistent host permission explanations tied to the automatic selection icon.\n// Do not remove wildcard hosts without designing and testing a different activation flow.'
 if 'Welcome page' in x['title']:
  x['reason']='A toolbar popup has a real first-use path: pin, Google sign-in, choose languages and translate text. Existing onInstalled only creates menus; there is no packaged welcome page. Recommend a small local welcome page on first install only, using the new character limits and explicitly marking page translation as Pro.'
  x['code']+='\n// Keep popup width fixed 420px; this welcome tab has its own responsive layout.\n// The refreshed welcomeAllowance/welcomeFirstResult strings distinguish Free\n// text translation from Pro webpage translation. Never display images or word packages.\n'
 for k in ['title','code']:assert isinstance(x[k],str) and x[k]
save('data/recommendations.json',recommendations)
# Keep older dated research intact; current data uses refreshed English and Ukrainian evidence.
old=read('data/keywords.json'); old['date']='2026-10-27';old['hl']='en';old['primary']='webpage translator';old['secondary']=['translate selected text','ai translator','full page translator'];old['ownId']='aieamemimbcbbnmakifejomadhegogge';old['ownRank']=None;old['rankStatus']='not_found_in_checked_results';old['researchStatus']='Fresh English and Ukrainian Store/autocomplete probes succeeded; own public listing was not parsed.';old['provisional']=False
raw=read('research/2026-10-27/keywords-en.json')
reasons={
 'webpage translator':('primary',3,'Describes the verified Pro webpage workflow, with the strongest demand heuristic and no exact phrase among top-result names. It does not imply that Free includes page translation.'),
 'ai translator':('secondary',3,'Matches established brand and verified AI text workflow; crowded results and mixed device/voice intent make a task-led modifier useful.'),
 'translate selected text':('secondary',3,'Precisely matches the Free selection workflow; broad demand proxy and stronger competition.'),
 'full page translator':('secondary',3,'Accurately describes Pro; use with clear Pro labeling and no universal website compatibility claim.'),
 'text translator':('description',3,'Accurate Free task but broad autocomplete includes image/voice/camera intent unsupported by this product.'),
 'context menu translator':('description',3,'Verified entry point, smaller demand heuristic and less descriptive of the complete product.')
}
phr=[]
for q in raw:
 dec,rel,why=reasons[q['phrase']];a=q['assessment']
 p={k:q.get(k) for k in ['phrase','hl','retrievedAt','storeUrl','autocompleteUrl','storeStatus','autocompleteStatus','ownRank','resultsChecked','errors']}
 p.update(relevance=rel,demand=a['demand'],competition=a['competition'],inTopNames=a['phraseInTopNames'],top10Users=a['top10TotalUsers'],resultsOver100kUsers=a['resultsOver100kUsers'],autocompleteExtensions=a['autocompleteExtensions'],decision=dec,reason=why,provisional=bool(q['errors']),rankStatus='observed' if q['ownRank'] else 'not_found_in_checked_results',autocomplete=q['autocomplete'])
 phr.append(p)
old['phrases']=phr
old['primaryRationale']=reasons['webpage translator'][2]
old['methodology']='Store top10 installed-user totals and Google autocomplete are editorial comparison signals, not search volume or ranking forecasts. Same-language dated queries are compared. Null own rank means absent only among successfully checked results, not proof of publication status.'
uk=read('research/2026-10-27/keywords-uk.json')
ukphr=[]
for q in uk:
 a=q['assessment'];p={k:q.get(k) for k in ['phrase','hl','retrievedAt','storeUrl','autocompleteUrl','storeStatus','autocompleteStatus','ownRank','resultsChecked','errors']};p.update(relevance=3,demand=a['demand'],competition=a['competition'],inTopNames=a['phraseInTopNames'],top10Users=a['top10TotalUsers'],decision='secondary',reason='Natural Ukrainian query for a verified text or Pro webpage translation task; research does not create a translated listing.',provisional=bool(q['errors']),rankStatus='not_found_in_checked_results');ukphr.append(p)
old['localeResearch']=[x for x in old.get('localeResearch',[]) if x.get('hl')!='uk']+[{'hl':'uk','date':'2026-10-27','status':'researched','phrases':ukphr}]
old['limitations']=['No absolute search-volume or ranking guarantee is claimed.','Own listing fetch returned no parsed listing and web open was unavailable; owner context identifies an unpublished draft.','Non-English/Ukrainian probes remain dated2026-10-23 historical evidence, not refreshed2026-10-27 measurements.','Competitor assets are research references only, never product marketing artwork.','Page translation is Pro-only; image translation and prepaid word packages are not marketed.']
save('data/keywords.json',old)
save('research/2026-10-27/own-status.json',{'id':old['ownId'],'date':'2026-10-27','ownerContext':'Existing unpublished draft item','url':'https://chromewebstore.google.com/detail/'+old['ownId']+'?hl=en','collectorStatus':'error','error':'No listing data parsed; collector may not distinguish an unpublished item from a changed page format.','webOpenStatus':'unavailable','publicationVerified':False,'rankRule':'Absent among10 successfully checked results for these queries only; no public listing or universal rank is inferred.'})
# Exact copy and complete declared-permission coverage checks.
manifest=read('../extension/dist/manifest.json') if False else json.loads((R.parent/'extension/dist/manifest.json').read_text())
validation={'date':'2026-10-27','version':manifest['version'],'names':[{'text':x['text'],'characters':len(x['text']),'within75':len(x['text'])<=75}for x in names['names']],'shortDescriptions':[{'text':x['text'],'characters':len(x['text']),'within132':len(x['text'])<=132}for x in names['shortDescriptions']],'descriptionWords':len(description.split()),'primaryPhraseOccurrences':description.lower().count('webpage translator'),'plainText':not any(t in description for t in ['```','##','**']),'declaredPermissions':manifest['permissions']+manifest.get('host_permissions',[])+manifest.get('optional_permissions',[])+manifest.get('optional_host_permissions',[]),'justifiedPermissions':[x['permission']for x in d['permissions']],'englishDraftKeys':list(loc),'noRetiredOfferClaims':all(s not in description.lower() for s in ['buy a package','purchased balance','10,000 source words','five images','daily allowance'])}
assert all(x['within75'] for x in validation['names']);assert all(x['within132']for x in validation['shortDescriptions']);assert set(validation['declaredPermissions'])==set(validation['justifiedPermissions']);assert validation['noRetiredOfferClaims']
save('audits/copy-and-store-form.json',validation)
print(json.dumps({'names':[(x['characters'],x['text'])for x in validation['names']],'summaries':[(x['characters'],x['text'])for x in validation['shortDescriptions']],'words':validation['descriptionWords'],'permissions':len(validation['declaredPermissions']),'draftKeys':len(loc)},ensure_ascii=False))
