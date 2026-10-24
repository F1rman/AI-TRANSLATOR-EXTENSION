export const languages = [
  ['Ukrainian', 'Українська'], ['English', 'Англійська'], ['Polish', 'Польська'], ['German', 'Німецька'], ['French', 'Французька'], ['Spanish', 'Іспанська'], ['Italian', 'Італійська'], ['Portuguese', 'Португальська'], ['Czech', 'Чеська'], ['Slovak', 'Словацька'], ['Romanian', 'Румунська'], ['Hungarian', 'Угорська'], ['Dutch', 'Нідерландська'], ['Swedish', 'Шведська'], ['Norwegian', 'Норвезька'], ['Danish', 'Данська'], ['Finnish', 'Фінська'], ['Greek', 'Грецька'], ['Turkish', 'Турецька'], ['Arabic', 'Арабська'], ['Hebrew', 'Іврит'], ['Hindi', 'Гінді'], ['Chinese', 'Китайська'], ['Japanese', 'Японська'], ['Korean', 'Корейська'], ['Vietnamese', 'В’єтнамська'], ['Indonesian', 'Індонезійська'], ['Thai', 'Тайська'], ['Russian', 'Російська'], ['Belarusian', 'Білоруська'], ['Georgian', 'Грузинська'], ['Persian', 'Перська'], ['Swahili', 'Суахілі'], ['Latin', 'Латина'],
] as const;
const nativeAndCode = [
  ['Українська', 'uk ua'], ['English', 'en'], ['Polski', 'pl'], ['Deutsch', 'de'], ['Français', 'fr'], ['Español', 'es'], ['Italiano', 'it'], ['Português', 'pt pt-br'], ['Čeština', 'cs'], ['Slovenčina', 'sk'], ['Română', 'ro'], ['Magyar', 'hu'], ['Nederlands', 'nl'], ['Svenska', 'sv'], ['Norsk', 'no nb nn'], ['Dansk', 'da'], ['Suomi', 'fi'], ['Ελληνικά', 'el'], ['Türkçe', 'tr'], ['العربية', 'ar'], ['עברית', 'he'], ['हिन्दी', 'hi'], ['中文', 'zh zh-cn zh-tw'], ['日本語', 'ja'], ['한국어', 'ko'], ['Tiếng Việt', 'vi'], ['Bahasa Indonesia', 'id'], ['ไทย', 'th'], ['Русский', 'ru'], ['Беларуская', 'be'], ['ქართული', 'ka'], ['فارسی', 'fa'], ['Kiswahili', 'sw'], ['Latina', 'la'],
] as const;
export const languageEntries = languages.map(([value, uk], index) => ({ value, uk, native: nativeAndCode[index][0], codes: nativeAndCode[index][1], popular: index < 8 }));
export const normalizeLanguageSearch = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, '').toLocaleLowerCase().trim();
export function findLanguages(query: string) {
  const search = normalizeLanguageSearch(query);
  return languageEntries.filter((entry) => [entry.value, entry.uk, entry.native, entry.codes].some((name) => normalizeLanguageSearch(name).includes(search)));
}
export const languageName = (value: string, locale: 'uk' | 'en', automatic: string) => value === 'auto' ? automatic : locale === 'uk' ? languages.find(([name]) => name === value)?.[1] || value : value;
