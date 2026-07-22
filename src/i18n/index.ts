import type { LocaleStrings, SupportedLocale } from './locale';
export type { LocaleStrings };
export { resolveLocale } from './locale';
import en from './en';
import zhCn from './zh-cn';
import zhTw from './zh-tw';
import ja from './ja';
import ko from './ko';
import de from './de';
import fr from './fr';
import es from './es';
import ptBr from './pt-br';
import ru from './ru';

const LOCALE_MAP: Readonly<Record<SupportedLocale, LocaleStrings>> = {
  'en': en,
  'zh-cn': zhCn,
  'zh-tw': zhTw,
  'ja': ja,
  'ko': ko,
  'de': de,
  'fr': fr,
  'es': es,
  'pt-br': ptBr,
  'ru': ru,
};

export function getStrings(locale: string): LocaleStrings {
  if (locale in LOCALE_MAP) {
    return LOCALE_MAP[locale as SupportedLocale];
  }
  return en;
}

export function format(message: string, ...args: (string | number)[]): string {
  let result = message;
  for (let i = 0; i < args.length; i++) {
    result = result.replace(`{${i}}`, String(args[i]));
  }
  return result;
}
