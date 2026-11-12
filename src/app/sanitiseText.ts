// Cleans user-typed text before it gets persisted or shared. There is no SQL
// db here (storage is localStorage + Cloudflare KV as raw json), so the real
// risks are emoji, zero-width / bidi control chars, and other non-printables
// sneaking into player names, notes, captions etc. Strip them at commit time.

export interface SanitiseOpts {
  /** Hard character cap applied after cleaning. */
  maxLen?: number;
  /** Keep line breaks (notes, text boxes). Default false (single-line fields). */
  allowNewlines?: boolean;
  /** Trim + collapse runs of whitespace. Default true. Notes / text boxes and
   *  the deserialize path turn this off so existing prose is not reflowed. */
  collapseWhitespace?: boolean;
}

// emoji + pictographs, flag halves, skin-tone modifiers, variation selectors,
// and the keycap combiner
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u{FE00}-\u{FE0F}\u{20E3}]/gu;
// zero-width space / non-joiner / joiner + byte order mark
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;
// bidi overrides + isolates - these can spoof text direction
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
// control chars, but keep tab (09) and newline (0A) which we tidy below
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function sanitiseText(raw: string, opts: SanitiseOpts = {}): string {
  if (typeof raw !== 'string') return '';
  const { maxLen, allowNewlines = false, collapseWhitespace = true } = opts;
  let s = raw.normalize('NFC');
  s = s.replace(EMOJI, '');
  s = s.replace(ZERO_WIDTH, '');
  s = s.replace(BIDI, '');
  s = s.replace(CONTROL, '');
  if (allowNewlines) {
    s = s.replace(/\r\n?/g, '\n');
  } else {
    s = s.replace(/[\r\n]+/g, ' ');
  }
  if (collapseWhitespace) {
    if (allowNewlines) {
      s = s.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n');
    } else {
      s = s.replace(/\s+/g, ' ');
    }
    s = s.trim();
  }
  if (maxLen != null && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

const MAX_TAGS = 12;
const MAX_TAG_LEN = 24;

/** Split a comma string into clean tags: sanitised, de-duped case-insensitively
 *  (first spelling wins), capped in length and count. */
export function sanitiseTags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const t = sanitiseText(part, { maxLen: MAX_TAG_LEN });
    if (t === '') continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
