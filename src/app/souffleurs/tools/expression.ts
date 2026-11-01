/**
 * compute's expression language (ADR-003): what the chat writes in `compute(expression=…)`,
 * what the app evaluates. No `eval`, no code execution: a tokenizer and a recursive-descent
 * parser over a closed grammar.
 *
 * This is a line-for-line port of `aparte-repetitions/gen/validators/expression.py`. The
 * training data were checked with the Python version, so for the same input this must give the
 * SAME value or the SAME error message — `expression.spec.ts` ports its test suite one to one.
 * Change both sides together or neither.
 *
 *     program  := stmt (';' stmt)* [';']
 *     stmt     := NAME '=' expr | expr
 *     expr     := term (('+' | '-') term)*
 *     term     := unary (('*' | '/') unary)*
 *     unary    := ('+' | '-') unary | power
 *     power    := atom ['^' unary]          # right-associative, binds tighter than unary minus
 *     atom     := NUMBER | STRING | NAME | NAME '(' [expr (',' expr)*] ')' | '(' expr ')'
 *
 * Known, deliberate differences (all on inputs where Python itself crashes with a non-`ExprError`
 * exception or recurses past its limit): those cases raise an `ExprError` here instead.
 * Non-ASCII digits (`٣`) are not numbers here, while Python's `\d` / `float()` accept them.
 */

export const MAX_LEN = 2000;
export const MAX_DEPTH = 60;

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

type Value = number | string;
type Result = number | string | Record<string, number | string>;

// ---- Python-compatible rendering, for error messages that quote a value (`{x!r}`)

/** Python's `repr(str)`. */
function reprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0))
      out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (ch !== ' ' && /^[\p{Z}\p{C}]$/u.test(ch)) {
      out +=
        cp <= 0xff
          ? '\\x' + cp.toString(16).padStart(2, '0')
          : cp <= 0xffff
            ? '\\u' + cp.toString(16).padStart(4, '0')
            : '\\U' + cp.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + quote;
}

/** Python's `repr(float)`: `3.0`, `1e+16`, `1.5e-05`, `inf`. */
function reprFloat(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  if (x === 0) return sign + '0.0';
  const [mant, e] = Math.abs(x).toExponential().split('e') as [string, string];
  const digits = mant.replace('.', '');
  const exp10 = Number(e);
  if (exp10 >= -4 && exp10 < 16) {
    if (exp10 >= 0) {
      const whole = digits.padEnd(exp10 + 1, '0');
      return `${sign}${whole.slice(0, exp10 + 1)}.${whole.slice(exp10 + 1) || '0'}`;
    }
    return `${sign}0.${'0'.repeat(-exp10 - 1)}${digits}`;
  }
  const rest = digits.slice(1);
  const abs = String(Math.abs(exp10)).padStart(2, '0');
  return `${sign}${digits[0]}${rest ? '.' + rest : ''}e${exp10 < 0 ? '-' : '+'}${abs}`;
}

const repr = (v: Value): string => (typeof v === 'string' ? reprStr(v) : reprFloat(v));

// ---- exact decimal arithmetic: Python's `Decimal` and `format(.12g)` round the exact value,
// ---- which `toFixed` / `toPrecision` do not (ties, and values that are not exactly representable)

/** ±coef × 10^exp. */
interface Dec {
  neg: boolean;
  coef: bigint;
  exp: number;
}

const F64 = new DataView(new ArrayBuffer(8));

/** The exact binary value of a finite double, as a decimal. */
function exactDecimal(v: number): Dec {
  F64.setFloat64(0, Math.abs(v));
  const hi = F64.getUint32(0);
  const lo = F64.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const m = biased === 0 ? frac : frac | (1n << 52n);
  const e = (biased === 0 ? 1 : biased) - 1075;
  const neg = v < 0 || Object.is(v, -0);
  if (m === 0n) return { neg, coef: 0n, exp: 0 };
  return e >= 0
    ? { neg, coef: m << BigInt(e), exp: 0 }
    : { neg, coef: m * 5n ** BigInt(-e), exp: e };
}

/** The shortest decimal that round-trips: the digits of Python's `repr(x)`. */
function shortestDecimal(v: number): Dec {
  const neg = v < 0 || Object.is(v, -0);
  const [mant, e] = Math.abs(v).toExponential().split('e') as [string, string];
  const digits = mant.replace('.', '');
  return { neg, coef: BigInt(digits), exp: Number(e) - (digits.length - 1) };
}

/** Rescale to `exp`, rounding the dropped digits (`half-up` = away from zero on ties). */
function quantize(d: Dec, exp: number, mode: 'half-up' | 'half-even'): Dec {
  if (d.exp >= exp) return { neg: d.neg, coef: d.coef * 10n ** BigInt(d.exp - exp), exp };
  const unit = 10n ** BigInt(exp - d.exp);
  let q = d.coef / unit;
  const r = d.coef % unit;
  const twice = r * 2n;
  if (twice > unit || (twice === unit && (mode === 'half-up' || q % 2n === 1n))) q += 1n;
  return { neg: d.neg, coef: q, exp };
}

const toNumber = (d: Dec): number => Number(`${d.neg ? '-' : ''}${d.coef}e${d.exp}`);

/** Compensated sum, exactly rounded: Python's `math.fsum` (Shewchuk's partials). */
function fsum(xs: number[]): number {
  if (xs.some((x) => !Number.isFinite(x))) return xs.reduce((a, b) => a + b, 0);
  const p: number[] = [];
  for (let x of xs) {
    let i = 0;
    const n = p.length;
    for (let j = 0; j < n; j++) {
      let y = p[j] as number;
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) p[i++] = lo;
      x = hi;
    }
    if (!Number.isFinite(x)) throw new ExprError('result out of range');
    p.length = i;
    p.push(x);
  }
  let n = p.length;
  let hi = 0;
  if (n > 0) {
    hi = p[--n] as number;
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = p[--n] as number;
      hi = x + y;
      lo = y - (hi - x);
      if (lo !== 0) break;
    }
    // Round-half-even correction when the discarded partials sit exactly on a tie.
    if (n > 0 && ((lo < 0 && (p[n - 1] as number) < 0) || (lo > 0 && (p[n - 1] as number) > 0))) {
      const y = lo * 2;
      const x = hi + y;
      if (y === x - hi) hi = x;
    }
  }
  return hi;
}

// ---- tokenizer

// Python's `\s`, spelled out (JS's differs: it has U+FEFF, lacks U+001C–001F and U+0085).
const WS =
  '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
// Python's `[^\W\d]\w*`: letters, `_` and non-decimal numerics to start, plus decimal digits after.
const NAME = '[\\p{L}\\p{Nl}\\p{No}_][\\p{L}\\p{N}_]*';
const TOKEN = new RegExp(
  `(?<ws>${WS}+)` +
    `|(?<num>[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|\\.[0-9]+)` +
    `|(?<str>"[^"\\n]*"|'[^'\\n]*')` +
    `|(?<name>${NAME})` +
    `|(?<op>[-+*/^(),;=])`,
  'uy',
);

type Kind = 'num' | 'str' | 'name' | 'op' | 'end';
interface Token {
  kind: Kind;
  text: string;
}

function tokens(raw: string): Token[] {
  const src = raw.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-');
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m || !m.groups) {
      // Python reports the position in code points, not UTF-16 units.
      const at = Array.from(src.slice(0, i)).length;
      throw new ExprError(
        `unexpected character ${reprStr(String.fromCodePoint(src.codePointAt(i) as number))} at ${at}`,
      );
    }
    i = TOKEN.lastIndex;
    for (const kind of ['num', 'str', 'name', 'op'] as const) {
      if (m.groups[kind] !== undefined) {
        out.push({ kind, text: m[0] });
        break;
      }
    }
  }
  out.push({ kind: 'end', text: '' });
  return out;
}

// ---- units: factor to the dimension's base unit (temperature is affine, handled apart)

const UNITS = new Map<string, readonly [string, number]>();

function dim(dimension: string, table: Record<string, number>): void {
  for (const [names, factor] of Object.entries(table)) {
    for (const n of names.split('|')) UNITS.set(n, [dimension, factor]);
  }
}

dim('length', {
  'mm|millimetre|millimètre|millimeter': 0.001,
  'cm|centimetre|centimètre|centimeter': 0.01,
  'm|metre|mètre|meter': 1.0,
  'km|kilometre|kilomètre|kilometer': 1000.0,
  'in|inch|pouce|pouces': 0.0254,
  'ft|foot|feet|pied|pieds': 0.3048,
  'yd|yard|yards': 0.9144,
  'mi|mile|miles': 1609.344,
  'nmi|mille marin|nautical mile': 1852.0,
});
dim('mass', {
  mg: 1e-6,
  'g|gramme|grammes|gram': 0.001,
  'kg|kilo|kilos|kilogramme': 1.0,
  't|tonne|tonnes': 1000.0,
  'oz|once|onces|ounce': 0.028349523125,
  'lb|lbs|livre|livres|pound|pounds': 0.45359237,
  'st|stone': 6.35029318,
});
dim('volume', {
  ml: 0.001,
  cl: 0.01,
  dl: 0.1,
  'l|litre|litres|liter': 1.0,
  m3: 1000.0,
  'gal|gallon|gallons': 3.785411784,
  'qt|quart': 0.946352946,
  'pt|pint|pinte': 0.473176473,
  'floz|fl oz': 0.0295735295625,
  'cup|tasse': 0.2365882365,
});
dim('area', {
  mm2: 1e-6,
  cm2: 1e-4,
  m2: 1.0,
  km2: 1e6,
  'ha|hectare|hectares': 1e4,
  'a|are': 100.0,
  in2: 0.00064516,
  ft2: 0.09290304,
  yd2: 0.83612736,
  'acre|acres': 4046.8564224,
  mi2: 2589988.110336,
});
dim('time', {
  ms: 0.001,
  's|sec|seconde|secondes|second|seconds': 1.0,
  'min|minute|minutes': 60.0,
  'h|heure|heures|hour|hours': 3600.0,
  'd|j|jour|jours|day|days': 86400.0,
  'week|weeks|semaine|semaines': 604800.0,
});
dim('speed', {
  'm/s': 1.0,
  'km/h|kmh': 1 / 3.6,
  mph: 0.44704,
  'kn|noeud|nœud|knot|knots': 1852 / 3600,
});

const TEMPS = new Map<string, 'C' | 'F' | 'K'>([
  ['c', 'C'],
  ['°c', 'C'],
  ['celsius', 'C'],
  ['f', 'F'],
  ['°f', 'F'],
  ['fahrenheit', 'F'],
  ['k', 'K'],
  ['kelvin', 'K'],
]);

const TO_KELVIN = {
  C: (v: number) => v + 273.15,
  F: (v: number) => ((v - 32) * 5) / 9 + 273.15,
  K: (v: number) => v,
};
const FROM_KELVIN = {
  C: (k: number) => k - 273.15,
  F: (k: number) => ((k - 273.15) * 9) / 5 + 32,
  K: (k: number) => k,
};

// Python's `str.strip()` / `isspace()` set, not JS's `trim()`.
const PY_SPACE = new RegExp(`^${WS}+|${WS}+$`, 'gu');

function convert(x: number, src: string, dst: string): number {
  const a = src.replace(PY_SPACE, '').toLowerCase();
  const b = dst.replace(PY_SPACE, '').toLowerCase();
  const ta = TEMPS.get(a);
  const tb = TEMPS.get(b);
  if (ta && tb) return FROM_KELVIN[tb](TO_KELVIN[ta](x));
  const ua = UNITS.get(a);
  if (!ua) throw new ExprError(`unknown unit ${reprStr(src)}`);
  const ub = UNITS.get(b);
  if (!ub) throw new ExprError(`unknown unit ${reprStr(dst)}`);
  if (ua[0] !== ub[0]) {
    throw new ExprError(`cannot convert ${ua[0]} (${src}) to ${ub[0]} (${dst})`);
  }
  return (x * ua[1]) / ub[1];
}

// ---- dates: UTC day numbers, so no time zone or DST can shift a day

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a proleptic Gregorian date, or null if it does not exist. */
function ymdToDays(y: number, m: number, d: number): number | null {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.getTime() / DAY_MS;
}

/** Number of ISO weeks in `y` (52 or 53). */
function isoWeeks(y: number): number {
  const p = (n: number) => (n + Math.floor(n / 4) - Math.floor(n / 100) + Math.floor(n / 400)) % 7;
  return 52 + (p(y) === 4 || p(y - 1) === 3 ? 1 : 0);
}

function isoWeekToDays(y: number, w: number, d: number): number | null {
  if (y < 1 || y > 9999 || w < 1 || w > isoWeeks(y) || d < 1 || d > 7) return null;
  const jan4 = ymdToDays(y, 1, 4) as number;
  const weekday = (((jan4 + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday: Monday = 0
  const days = jan4 - weekday + (w - 1) * 7 + (d - 1);
  const year = new Date(days * DAY_MS).getUTCFullYear();
  return year < 1 || year > 9999 ? null : days;
}

/**
 * Python's `date.fromisoformat` (3.11+): `YYYY-MM-DD`, `YYYYMMDD`, and the ISO week forms
 * `YYYY-Www[-D]` / `YYYYWww[D]`. ASCII digits only.
 */
function parseIsoDate(s: string): number | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return ymdToDays(+(m[1] as string), +(m[2] as string), +(m[3] as string));
  m = /^(\d{4})-W(\d{2})(?:-(\d))?$/.exec(s) ?? /^(\d{4})W(\d{2})(\d)?$/.exec(s);
  if (m) return isoWeekToDays(+(m[1] as string), +(m[2] as string), m[3] === undefined ? 1 : +m[3]);
  return null;
}

function toDate(v: Value): number {
  if (typeof v !== 'string') throw new ExprError(`expected a date "YYYY-MM-DD", got ${repr(v)}`);
  const days = parseIsoDate(v);
  if (days === null) throw new ExprError(`not a date "YYYY-MM-DD": ${reprStr(v)}`);
  return days;
}

function isoDate(days: number): string {
  const t = new Date(days * DAY_MS);
  const y = t.getUTCFullYear();
  if (Number.isNaN(y) || y < 1 || y > 9999) throw new ExprError('date out of range');
  const p = (n: number, len: number) => String(n).padStart(len, '0');
  return `${p(y, 4)}-${p(t.getUTCMonth() + 1, 2)}-${p(t.getUTCDate(), 2)}`;
}

// ---- functions

function num(v: Value): number {
  if (typeof v !== 'number') throw new ExprError(`expected a number, got ${repr(v)}`);
  return v;
}

/** `round(x, n)`: half away from zero on the decimal digits the model wrote, like a till. */
function round(x: Value, n: Value = 0): number {
  const xs = num(x);
  const digits = num(n);
  if (!Number.isInteger(digits) || digits < 0 || digits > 12) {
    throw new ExprError("round's digits must be a whole number from 0 to 12");
  }
  if (!Number.isFinite(xs)) throw new ExprError('result out of range');
  // Python rounds `Decimal(repr(x))`, i.e. the shortest decimal (2.675 stays 2.675, not 2.67499…).
  const q = quantize(shortestDecimal(xs), -digits, 'half-up');
  // Python's Decimal context holds 28 digits and raises beyond (an uncaught exception there).
  if (q.coef.toString().length > 28) throw new ExprError('result out of range');
  return toNumber(q);
}

function many(name: string, fn: (xs: number[]) => number): (...xs: Value[]) => Value {
  return (...xs) => {
    if (xs.length === 0) throw new ExprError(`${name} needs at least one number`);
    return fn(xs.map(num));
  };
}

interface Func {
  min: number;
  max: number;
  call: (...args: Value[]) => Value;
}

const FUNCS = new Map<string, Func>([
  ['round', { min: 1, max: 2, call: (x, n) => round(x as Value, n) }],
  ['min', { min: 0, max: Infinity, call: many('min', (xs) => Math.min(...xs)) }],
  ['max', { min: 0, max: Infinity, call: many('max', (xs) => Math.max(...xs)) }],
  ['sum', { min: 0, max: Infinity, call: many('sum', fsum) }],
  ['mean', { min: 0, max: Infinity, call: many('mean', (xs) => fsum(xs) / xs.length) }],
  [
    'sqrt',
    {
      min: 1,
      max: 1,
      call: (x) => {
        const v = num(x as Value);
        if (v < 0) throw new ExprError('sqrt of a negative number');
        return Math.sqrt(v);
      },
    },
  ],
  ['abs', { min: 1, max: 1, call: (x) => Math.abs(num(x as Value)) }],
  [
    'days_between',
    {
      min: 2,
      max: 2,
      // Python evaluates `_date(b) - _date(a)`: the second date is checked first.
      call: (a, b) => {
        const db = toDate(b as Value);
        return db - toDate(a as Value);
      },
    },
  ],
  [
    'add_days',
    {
      min: 2,
      max: 2,
      call: (d, n) => {
        const days = toDate(d as Value);
        const k = Math.trunc(num(n as Value));
        if (!Number.isFinite(k)) throw new ExprError('date out of range');
        return isoDate(days + k);
      },
    },
  ],
  [
    'convert',
    {
      min: 3,
      max: 3,
      call: (x, a, b) =>
        convert(num(x as Value), typeof a === 'string' ? a : '', typeof b === 'string' ? b : ''),
    },
  ],
]);

// ---- parser

class Parser {
  private readonly t: Token[];
  private i = 0;
  private depth = 0;
  private readonly env = new Map<string, Value>();

  constructor(src: string) {
    this.t = tokens(src);
  }

  private cur(): Token {
    return this.t[this.i] as Token;
  }

  private peek(...ops: string[]): string | null {
    const { kind, text } = this.cur();
    return kind === 'op' && ops.includes(text) ? text : null;
  }

  private take(op: string): void {
    if (!this.peek(op))
      throw new ExprError(`expected ${reprStr(op)}, got ${reprStr(this.cur().text || 'end')}`);
    this.i++;
  }

  program(): Result {
    const named = new Map<string, Value>();
    let last: Value | null = null;
    for (;;) {
      const { kind, text } = this.cur();
      const next = this.t[this.i + 1];
      if (kind === 'name' && next?.kind === 'op' && next.text === '=') {
        this.i += 2;
        if (FUNCS.has(text)) throw new ExprError(`${reprStr(text)} is a function name`);
        const v = this.expr();
        named.set(text, v);
        this.env.set(text, v);
        last = null;
      } else {
        last = this.expr();
      }
      if (this.peek(';')) {
        this.i++;
        if (this.cur().kind === 'end') break;
        continue;
      }
      if (this.cur().kind !== 'end') throw new ExprError(`unexpected ${reprStr(this.cur().text)}`);
      break;
    }
    if (named.size === 0) {
      if (last === null) throw new ExprError('empty expression');
      return clean(last);
    }
    // Own data properties only: a variable may be called `__proto__`.
    const out = new Map([...named].map(([k, v]) => [k, clean(v)] as const));
    if (last !== null) out.set('result', clean(last));
    return Object.fromEntries(out);
  }

  private expr(): Value {
    if (++this.depth > MAX_DEPTH) throw new ExprError('expression nested too deeply');
    let v = this.term();
    for (let op = this.peek('+', '-'); op; op = this.peek('+', '-')) {
      this.i++;
      v = arith(op, v, this.term());
    }
    this.depth--;
    return v;
  }

  private term(): Value {
    let v = this.unary();
    for (let op = this.peek('*', '/'); op; op = this.peek('*', '/')) {
      this.i++;
      v = arith(op, v, this.unary());
    }
    return v;
  }

  private unary(): Value {
    const op = this.peek('+', '-');
    if (op) {
      this.i++;
      const v = num(this.unary());
      return op === '-' ? -v : v;
    }
    return this.power();
  }

  private power(): Value {
    const base = this.atom();
    if (this.peek('^')) {
      this.i++;
      return arith('^', base, this.unary());
    }
    return base;
  }

  private atom(): Value {
    const { kind, text } = this.cur();
    if (kind === 'num') {
      this.i++;
      return Number(text);
    }
    if (kind === 'str') {
      this.i++;
      return text.slice(1, -1);
    }
    if (kind === 'name') {
      this.i++;
      if (this.peek('(')) {
        const fn = FUNCS.get(text);
        if (!fn) throw new ExprError(`unknown function ${reprStr(text)}`);
        this.i++;
        const args: Value[] = [];
        if (!this.peek(')')) {
          args.push(this.expr());
          while (this.peek(',')) {
            this.i++;
            args.push(this.expr());
          }
        }
        this.take(')');
        if (args.length < fn.min || args.length > fn.max) {
          throw new ExprError(`wrong number of arguments for ${text}`);
        }
        return fn.call(...args);
      }
      const v = this.env.get(text);
      if (v === undefined) throw new ExprError(`unknown name ${reprStr(text)}`);
      return v;
    }
    if (this.peek('(')) {
      this.i++;
      const v = this.expr();
      this.take(')');
      return v;
    }
    throw new ExprError(`unexpected ${reprStr(text || 'end')}`);
  }
}

function arith(op: string, x: Value, y: Value): number {
  const a = num(x);
  const b = num(y);
  let r: number;
  if (op === '+') r = a + b;
  else if (op === '-') r = a - b;
  else if (op === '*') r = a * b;
  else if (op === '/') {
    if (b === 0) throw new ExprError('division by zero');
    r = a / b;
  } else {
    if (Math.abs(b) > 1000) throw new ExprError('exponent too large');
    // Python: 0 ** negative raises, a negative base to a fraction goes complex.
    if (a === 0 && b < 0) throw new ExprError('power out of range');
    if (a < 0 && !Number.isInteger(b))
      throw new ExprError('power of a negative number to a fraction');
    r = a ** b;
    // Python's float pow raises on overflow; only an infinite operand passes through to the check below.
    if (!Number.isFinite(r) && Number.isFinite(a) && Number.isFinite(b)) {
      throw new ExprError('power out of range');
    }
  }
  if (!Number.isFinite(r)) throw new ExprError('result out of range');
  return r;
}

/** Floats as a person reads them: 0.30000000000000004 → 0.3, 240.0 → 240. */
function clean(v: Value): Value {
  if (typeof v === 'string' || !Number.isFinite(v)) return v;
  // 12 significant digits, rounded half-even on the exact binary value (Python's `:.12g`).
  const d = exactDecimal(v);
  const digits = d.coef.toString().length;
  const c = digits > 12 ? toNumber(quantize(d, d.exp + digits - 12, 'half-even')) : v;
  return Number.isInteger(c) && Math.abs(c) < 1e15 ? c + 0 : c;
}

export function evaluate(src: string): Result {
  if (typeof src !== 'string' || src.replace(PY_SPACE, '') === '') {
    throw new ExprError('empty expression');
  }
  if (Array.from(src).length > MAX_LEN) {
    throw new ExprError(`expression longer than ${MAX_LEN} characters`);
  }
  return new Parser(src).program();
}

/** What the app sends back to the model: `{result: v}`, the named values, or `{error: …}`. */
export function asToolResult(src: string): Record<string, unknown> {
  try {
    const v = evaluate(src);
    return typeof v === 'object' ? v : { result: v };
  } catch (e) {
    if (e instanceof ExprError) return { error: e.message };
    throw e;
  }
}
