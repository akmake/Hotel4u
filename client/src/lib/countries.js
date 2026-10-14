// ISO-3166 alpha-2 codes; display names come from the browser (Intl.DisplayNames) in Hebrew.
const CODES = (
  'IL US GB FR DE RU UA IT ES NL BE CH AT PL RO HU CZ GR PT SE NO DK FI IE CA AU NZ AR BR MX CL CO PE ' +
  'ZA EG JO AE MA TR CY IN CN JP KR TH PH VN SG ET GE AZ AM KZ UZ BY MD LT LV EE BG RS HR SI SK BA ME MK AL ' +
  'IS LU MT LI MC SM AD VA PS SA QA BH KW OM IQ IR SY LB YE AF PK BD LK NP MM KH LA MY ID TW HK MO MN KP ' +
  'NG KE GH TZ UG RW SN CI CM AO ZM ZW BW NA MZ MG MU SC TN DZ LY SD SS ER DJ SO ' +
  'CU DO HT JM TT BS BB PA CR NI HN SV GT BZ VE EC BO PY UY GY SR'
).split(/\s+/);

let cache = null;
export function countryOptions() {
  if (cache) return cache;
  let dn = null;
  try { dn = new Intl.DisplayNames(['he'], { type: 'region' }); } catch { dn = null; }
  const list = CODES.map((code) => ({ code, name: dn?.of(code) || code }));
  const [first, ...rest] = list; // Israel first, the rest alphabetical
  cache = [first, ...rest.sort((a, b) => a.name.localeCompare(b.name, 'he'))];
  return cache;
}
