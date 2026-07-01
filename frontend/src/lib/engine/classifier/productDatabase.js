/**
 * productDatabase.js
 *
 * Local knowledge base for product classification. No network calls,
 * no external APIs — this is a curated dictionary of brands, category
 * keywords, and known model-name patterns for common consumer
 * electronics/appliances, used entirely client-side (or server-side
 * in Node) for free, offline classification.
 *
 * Structure:
 *  - CATEGORIES: canonical category list + the standard/expected
 *    manufacturer warranty length used as a fallback when an invoice
 *    doesn't explicitly state a duration.
 *  - BRANDS: known brand names + which categories they commonly sell in
 *    (helps disambiguate, e.g. "Samsung" makes phones AND TVs AND fridges).
 *  - CATEGORY_KEYWORDS: keyword -> category signal, with weights.
 *  - MODEL_PATTERNS: regex patterns that strongly imply a specific
 *    category/brand pair when matched (e.g. iPhone model numbers).
 */

export const CATEGORIES = Object.freeze({
  SMARTPHONE: 'Smartphone',
  LAPTOP: 'Laptop',
  TELEVISION: 'Television',
  REFRIGERATOR: 'Refrigerator',
  AIR_CONDITIONER: 'Air Conditioner',
  SMARTWATCH: 'Smartwatch',
  AUDIO_DEVICE: 'Audio Device',
  GAMING_CONSOLE: 'Gaming Console',
  WASHING_MACHINE: 'Washing Machine',
  MICROWAVE: 'Microwave / Oven',
  TABLET: 'Tablet',
  CAMERA: 'Camera',
  PRINTER: 'Printer',
  MONITOR: 'Monitor',
  KEYBOARD_MOUSE: 'Keyboard / Mouse',
  POWER_BANK: 'Power Bank / Charger',
  VACUUM_CLEANER: 'Vacuum Cleaner',
  WATER_PURIFIER: 'Water Purifier',
  OTHER_ELECTRONICS: 'Other Electronics',
});

/**
 * Standard manufacturer warranty length (in months) typically offered
 * for each category in the Indian consumer market. Used as a FALLBACK
 * expected value — never overrides an explicitly detected duration from
 * the invoice text, only fills in when detection fails or to flag an
 * invoice's stated warranty as unusually short/long for its category.
 */
export const EXPECTED_WARRANTY_MONTHS = Object.freeze({
  [CATEGORIES.SMARTPHONE]: 12,
  [CATEGORIES.LAPTOP]: 12,
  [CATEGORIES.TELEVISION]: 12,
  [CATEGORIES.REFRIGERATOR]: 12, // + commonly 10yr on compressor specifically
  [CATEGORIES.AIR_CONDITIONER]: 12, // + commonly 5-10yr on compressor
  [CATEGORIES.SMARTWATCH]: 12,
  [CATEGORIES.AUDIO_DEVICE]: 12,
  [CATEGORIES.GAMING_CONSOLE]: 12,
  [CATEGORIES.WASHING_MACHINE]: 24,
  [CATEGORIES.MICROWAVE]: 12,
  [CATEGORIES.TABLET]: 12,
  [CATEGORIES.CAMERA]: 12,
  [CATEGORIES.PRINTER]: 12,
  [CATEGORIES.MONITOR]: 36,
  [CATEGORIES.KEYBOARD_MOUSE]: 12,
  [CATEGORIES.POWER_BANK]: 6,
  [CATEGORIES.VACUUM_CLEANER]: 12,
  [CATEGORIES.WATER_PURIFIER]: 12,
  [CATEGORIES.OTHER_ELECTRONICS]: 12,
});

/**
 * Known brands mapped to the categories they commonly sell in.
 * Order in the array signals relative likelihood (most common first),
 * used as a tiebreaker when keyword signals are ambiguous.
 */
export const BRANDS = Object.freeze({
  apple: { display: 'Apple', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.LAPTOP, CATEGORIES.TABLET, CATEGORIES.SMARTWATCH, CATEGORIES.AUDIO_DEVICE, CATEGORIES.MONITOR] },
  samsung: { display: 'Samsung', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.TELEVISION, CATEGORIES.REFRIGERATOR, CATEGORIES.WASHING_MACHINE, CATEGORIES.MONITOR, CATEGORIES.TABLET, CATEGORIES.AIR_CONDITIONER, CATEGORIES.MICROWAVE] },
  sony: { display: 'Sony', categories: [CATEGORIES.AUDIO_DEVICE, CATEGORIES.TELEVISION, CATEGORIES.CAMERA, CATEGORIES.GAMING_CONSOLE] },
  dell: { display: 'Dell', categories: [CATEGORIES.LAPTOP, CATEGORIES.MONITOR] },
  hp: { display: 'HP', categories: [CATEGORIES.LAPTOP, CATEGORIES.PRINTER, CATEGORIES.MONITOR] },
  lenovo: { display: 'Lenovo', categories: [CATEGORIES.LAPTOP, CATEGORIES.TABLET, CATEGORIES.MONITOR] },
  asus: { display: 'Asus', categories: [CATEGORIES.LAPTOP, CATEGORIES.MONITOR, CATEGORIES.MONITOR] },
  acer: { display: 'Acer', categories: [CATEGORIES.LAPTOP, CATEGORIES.MONITOR] },
  lg: { display: 'LG', categories: [CATEGORIES.TELEVISION, CATEGORIES.REFRIGERATOR, CATEGORIES.WASHING_MACHINE, CATEGORIES.AIR_CONDITIONER, CATEGORIES.MICROWAVE, CATEGORIES.MONITOR] },
  bosch: { display: 'Bosch', categories: [CATEGORIES.WASHING_MACHINE, CATEGORIES.REFRIGERATOR, CATEGORIES.VACUUM_CLEANER] },
  whirlpool: { display: 'Whirlpool', categories: [CATEGORIES.REFRIGERATOR, CATEGORIES.WASHING_MACHINE, CATEGORIES.MICROWAVE] },
  haier: { display: 'Haier', categories: [CATEGORIES.REFRIGERATOR, CATEGORIES.WASHING_MACHINE, CATEGORIES.AIR_CONDITIONER, CATEGORIES.TELEVISION] },
  voltas: { display: 'Voltas', categories: [CATEGORIES.AIR_CONDITIONER, CATEGORIES.REFRIGERATOR] },
  daikin: { display: 'Daikin', categories: [CATEGORIES.AIR_CONDITIONER] },
  blue_star: { display: 'Blue Star', categories: [CATEGORIES.AIR_CONDITIONER, CATEGORIES.REFRIGERATOR] },
  bose: { display: 'Bose', categories: [CATEGORIES.AUDIO_DEVICE] },
  jbl: { display: 'JBL', categories: [CATEGORIES.AUDIO_DEVICE] },
  boat: { display: 'boAt', categories: [CATEGORIES.AUDIO_DEVICE, CATEGORIES.SMARTWATCH] },
  sennheiser: { display: 'Sennheiser', categories: [CATEGORIES.AUDIO_DEVICE] },
  oneplus: { display: 'OnePlus', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.AUDIO_DEVICE, CATEGORIES.TELEVISION, CATEGORIES.SMARTWATCH] },
  xiaomi: { display: 'Xiaomi', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.TELEVISION, CATEGORIES.POWER_BANK, CATEGORIES.AUDIO_DEVICE, CATEGORIES.SMARTWATCH, CATEGORIES.VACUUM_CLEANER] },
  redmi: { display: 'Redmi', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.TELEVISION] },
  realme: { display: 'realme', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.SMARTWATCH, CATEGORIES.AUDIO_DEVICE] },
  vivo: { display: 'vivo', categories: [CATEGORIES.SMARTPHONE] },
  oppo: { display: 'OPPO', categories: [CATEGORIES.SMARTPHONE] },
  google: { display: 'Google', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.OTHER_ELECTRONICS] },
  nothing: { display: 'Nothing', categories: [CATEGORIES.SMARTPHONE, CATEGORIES.AUDIO_DEVICE] },
  garmin: { display: 'Garmin', categories: [CATEGORIES.SMARTWATCH] },
  fitbit: { display: 'Fitbit', categories: [CATEGORIES.SMARTWATCH] },
  microsoft: { display: 'Microsoft', categories: [CATEGORIES.GAMING_CONSOLE, CATEGORIES.LAPTOP, CATEGORIES.KEYBOARD_MOUSE] },
  nintendo: { display: 'Nintendo', categories: [CATEGORIES.GAMING_CONSOLE] },
  canon: { display: 'Canon', categories: [CATEGORIES.CAMERA, CATEGORIES.PRINTER] },
  nikon: { display: 'Nikon', categories: [CATEGORIES.CAMERA] },
  gopro: { display: 'GoPro', categories: [CATEGORIES.CAMERA] },
  epson: { display: 'Epson', categories: [CATEGORIES.PRINTER] },
  logitech: { display: 'Logitech', categories: [CATEGORIES.KEYBOARD_MOUSE, CATEGORIES.AUDIO_DEVICE] },
  anker: { display: 'Anker', categories: [CATEGORIES.POWER_BANK, CATEGORIES.AUDIO_DEVICE] },
  kent: { display: 'Kent', categories: [CATEGORIES.WATER_PURIFIER] },
  eureka_forbes: { display: 'Eureka Forbes', categories: [CATEGORIES.WATER_PURIFIER, CATEGORIES.VACUUM_CLEANER] },
  dyson: { display: 'Dyson', categories: [CATEGORIES.VACUUM_CLEANER] },
  philips: { display: 'Philips', categories: [CATEGORIES.AUDIO_DEVICE, CATEGORIES.OTHER_ELECTRONICS, CATEGORIES.WATER_PURIFIER] },
  panasonic: { display: 'Panasonic', categories: [CATEGORIES.TELEVISION, CATEGORIES.REFRIGERATOR, CATEGORIES.MICROWAVE, CATEGORIES.AUDIO_DEVICE] },
  ifb: { display: 'IFB', categories: [CATEGORIES.WASHING_MACHINE, CATEGORIES.MICROWAVE] },
  godrej: { display: 'Godrej', categories: [CATEGORIES.REFRIGERATOR, CATEGORIES.WASHING_MACHINE, CATEGORIES.AIR_CONDITIONER] },
});

/**
 * Keyword -> category signal mapping. Each keyword carries a weight
 * (relative strength of signal). Multiple keyword hits accumulate score
 * per category during classification; the highest-scoring category wins.
 *
 * Keywords are stored normalized (lowercase, no punctuation) since they
 * are matched against `normalizeKey()`-processed text.
 */
export const CATEGORY_KEYWORDS = Object.freeze({
  [CATEGORIES.SMARTPHONE]: [
    { kw: 'smartphone', weight: 5 },
    { kw: 'iphone', weight: 6 },
    { kw: 'mobile phone', weight: 5 },
    { kw: 'android phone', weight: 5 },
    { kw: '5g phone', weight: 4 },
    { kw: 'imei', weight: 6 },
    { kw: 'phone', weight: 2 },
  ],
  [CATEGORIES.LAPTOP]: [
    { kw: 'laptop', weight: 6 },
    { kw: 'notebook', weight: 4 },
    { kw: 'macbook', weight: 6 },
    { kw: 'ultrabook', weight: 5 },
    { kw: 'chromebook', weight: 5 },
    { kw: 'ssd', weight: 1 },
    { kw: 'ram', weight: 1 },
    { kw: 'intel core', weight: 2 },
    { kw: 'ryzen', weight: 2 },
  ],
  [CATEGORIES.TELEVISION]: [
    { kw: 'television', weight: 6 },
    { kw: 'smart tv', weight: 6 },
    { kw: 'led tv', weight: 5 },
    { kw: 'qled', weight: 5 },
    { kw: 'oled', weight: 5 },
    { kw: 'uhd', weight: 3 },
    { kw: 'crystal 4k', weight: 4 },
    { kw: '4k uhd', weight: 4 },
    { kw: 'tv', weight: 3 },
  ],
  [CATEGORIES.REFRIGERATOR]: [
    { kw: 'refrigerator', weight: 6 },
    { kw: 'fridge', weight: 5 },
    { kw: 'double door', weight: 3 },
    { kw: 'single door', weight: 3 },
    { kw: 'frost free', weight: 4 },
    { kw: 'side by side', weight: 3 },
  ],
  [CATEGORIES.AIR_CONDITIONER]: [
    { kw: 'air conditioner', weight: 6 },
    { kw: 'split ac', weight: 6 },
    { kw: 'window ac', weight: 6 },
    { kw: 'inverter ac', weight: 5 },
    { kw: 'ac unit', weight: 4 },
    { kw: 'ton split', weight: 3 },
  ],
  [CATEGORIES.SMARTWATCH]: [
    { kw: 'smartwatch', weight: 6 },
    { kw: 'smart watch', weight: 6 },
    { kw: 'fitness band', weight: 4 },
    { kw: 'fitness tracker', weight: 4 },
    { kw: 'apple watch', weight: 6 },
  ],
  [CATEGORIES.AUDIO_DEVICE]: [
    { kw: 'headphones', weight: 6 },
    { kw: 'headphone', weight: 6 },
    { kw: 'earbuds', weight: 6 },
    { kw: 'earphone', weight: 5 },
    { kw: 'wireless earbuds', weight: 6 },
    { kw: 'bluetooth speaker', weight: 6 },
    { kw: 'soundbar', weight: 5 },
    { kw: 'noise cancelling', weight: 4 },
    { kw: 'noise cancellation', weight: 4 },
    { kw: 'anc', weight: 2 },
    { kw: 'speaker', weight: 3 },
  ],
  [CATEGORIES.GAMING_CONSOLE]: [
    { kw: 'playstation', weight: 6 },
    { kw: 'ps5', weight: 6 },
    { kw: 'ps4', weight: 6 },
    { kw: 'xbox', weight: 6 },
    { kw: 'nintendo switch', weight: 6 },
    { kw: 'gaming console', weight: 5 },
    { kw: 'console', weight: 3 },
  ],
  [CATEGORIES.WASHING_MACHINE]: [
    { kw: 'washing machine', weight: 6 },
    { kw: 'front load', weight: 4 },
    { kw: 'top load', weight: 4 },
    { kw: 'semi automatic', weight: 3 },
    { kw: 'fully automatic', weight: 3 },
  ],
  [CATEGORIES.MICROWAVE]: [
    { kw: 'microwave', weight: 6 },
    { kw: 'convection oven', weight: 5 },
    { kw: 'otg oven', weight: 4 },
    { kw: 'grill microwave', weight: 5 },
  ],
  [CATEGORIES.TABLET]: [
    { kw: 'tablet', weight: 6 },
    { kw: 'ipad', weight: 6 },
    { kw: 'tab', weight: 2 },
  ],
  [CATEGORIES.CAMERA]: [
    { kw: 'dslr', weight: 6 },
    { kw: 'mirrorless camera', weight: 6 },
    { kw: 'camera', weight: 4 },
    { kw: 'action camera', weight: 5 },
    { kw: 'lens', weight: 1 },
  ],
  [CATEGORIES.PRINTER]: [
    { kw: 'printer', weight: 6 },
    { kw: 'inkjet', weight: 4 },
    { kw: 'laserjet', weight: 5 },
    { kw: 'all in one printer', weight: 5 },
  ],
  [CATEGORIES.MONITOR]: [
    { kw: 'monitor', weight: 5 },
    { kw: 'curved monitor', weight: 5 },
    { kw: 'gaming monitor', weight: 5 },
    { kw: 'display panel', weight: 2 },
  ],
  [CATEGORIES.KEYBOARD_MOUSE]: [
    { kw: 'keyboard', weight: 5 },
    { kw: 'mouse', weight: 5 },
    { kw: 'mechanical keyboard', weight: 6 },
    { kw: 'wireless mouse', weight: 6 },
  ],
  [CATEGORIES.POWER_BANK]: [
    { kw: 'power bank', weight: 6 },
    { kw: 'portable charger', weight: 5 },
    { kw: 'power brick', weight: 4 },
  ],
  [CATEGORIES.VACUUM_CLEANER]: [
    { kw: 'vacuum cleaner', weight: 6 },
    { kw: 'robot vacuum', weight: 6 },
    { kw: 'cordless vacuum', weight: 5 },
  ],
  [CATEGORIES.WATER_PURIFIER]: [
    { kw: 'water purifier', weight: 6 },
    { kw: 'ro purifier', weight: 6 },
    { kw: 'ro water', weight: 5 },
    { kw: 'uv purifier', weight: 5 },
  ],
});

/**
 * High-confidence model-name regex patterns. When one of these matches,
 * it strongly implies BOTH brand and category simultaneously, and is
 * weighted higher than generic keyword matches during classification.
 */
export const MODEL_PATTERNS = Object.freeze([
  { pattern: /\biphone\s*\d{1,2}\s*(pro\s*max|pro|plus|mini)?\b/i, brandKey: 'apple', category: CATEGORIES.SMARTPHONE, weight: 10 },
  { pattern: /\bmacbook\s*(air|pro)?\b/i, brandKey: 'apple', category: CATEGORIES.LAPTOP, weight: 10 },
  { pattern: /\bipad\s*(pro|air|mini)?\b/i, brandKey: 'apple', category: CATEGORIES.TABLET, weight: 10 },
  { pattern: /\bapple\s*watch\b/i, brandKey: 'apple', category: CATEGORIES.SMARTWATCH, weight: 10 },
  { pattern: /\bwh-?1000xm\d\b/i, brandKey: 'sony', category: CATEGORIES.AUDIO_DEVICE, weight: 10 },
  { pattern: /\bgalaxy\s*(s|note|z|a|m)\d{1,3}\b/i, brandKey: 'samsung', category: CATEGORIES.SMARTPHONE, weight: 10 },
  { pattern: /\bgalaxy\s*tab\b/i, brandKey: 'samsung', category: CATEGORIES.TABLET, weight: 10 },
  { pattern: /\bgalaxy\s*watch\b/i, brandKey: 'samsung', category: CATEGORIES.SMARTWATCH, weight: 10 },
  { pattern: /\binspiron\b/i, brandKey: 'dell', category: CATEGORIES.LAPTOP, weight: 10 },
  { pattern: /\bxps\s*\d{2,3}\b/i, brandKey: 'dell', category: CATEGORIES.LAPTOP, weight: 10 },
  { pattern: /\bpavilion\b/i, brandKey: 'hp', category: CATEGORIES.LAPTOP, weight: 9 },
  { pattern: /\bthinkpad\b/i, brandKey: 'lenovo', category: CATEGORIES.LAPTOP, weight: 10 },
  { pattern: /\bquietcomfort\b/i, brandKey: 'bose', category: CATEGORIES.AUDIO_DEVICE, weight: 10 },
  { pattern: /\bplaystation\s*[45]\b/i, brandKey: null, category: CATEGORIES.GAMING_CONSOLE, weight: 10 },
  { pattern: /\bxbox\s*(series\s*[xs]|one)?\b/i, brandKey: 'microsoft', category: CATEGORIES.GAMING_CONSOLE, weight: 10 },
  { pattern: /\bnintendo\s*switch\b/i, brandKey: 'nintendo', category: CATEGORIES.GAMING_CONSOLE, weight: 10 },
  { pattern: /\bcrystal\s*4k\b/i, brandKey: 'samsung', category: CATEGORIES.TELEVISION, weight: 8 },
]);

/**
 * Looks up a brand definition by normalized key OR display name,
 * tolerant of common punctuation variants (e.g. "boAt" vs "boat").
 */
export function findBrandByText(text) {
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  if (BRANDS[normalized]) return { key: normalized, ...BRANDS[normalized] };

  const directDisplay = Object.entries(BRANDS).find(
    ([, b]) => b.display.toLowerCase() === text.toLowerCase().trim()
  );
  if (directDisplay) return { key: directDisplay[0], ...directDisplay[1] };

  return null;
}

export default {
  CATEGORIES,
  EXPECTED_WARRANTY_MONTHS,
  BRANDS,
  CATEGORY_KEYWORDS,
  MODEL_PATTERNS,
  findBrandByText,
};
