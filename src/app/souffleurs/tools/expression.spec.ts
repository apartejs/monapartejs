/**
 * compute's expression language. A one-to-one port of `test_expression.py` in
 * aparte-repetitions (the training data were checked with the Python evaluator, so the app must
 * give the same value or the same error), plus the cases where a naive JS port would drift.
 * Expected values in the "JS pitfalls" block were taken from the Python evaluator itself.
 */
import { describe, expect, it } from 'vitest';
import { ExprError, asToolResult, evaluate } from './expression';

function raises(src: string, part: string): void {
  try {
    evaluate(src);
  } catch (e) {
    expect(e).toBeInstanceOf(ExprError);
    expect((e as Error).message, src).toContain(part);
    return;
  }
  throw new Error(`${JSON.stringify(src)} should fail with ${JSON.stringify(part)}`);
}

describe('expression — port of test_expression.py', () => {
  it('arithmetic and precedence', () => {
    expect(evaluate('847 * 293')).toBe(248171);
    expect(evaluate('8450 * 12 / 100')).toBe(1014);
    expect(evaluate('2340 × 17 ÷ 100')).toBe(397.8);
    expect(evaluate('(12*5 + 14*6 + 8*3 + 16*2) / (5+6+3+2)')).toBe(12.5);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('0.1 + 0.2')).toBe(0.3);
  });

  it('named results', () => {
    expect(evaluate('ht = 3*80; tva = ht*0.2; ttc = ht + tva')).toEqual({
      ht: 240,
      tva: 48,
      ttc: 288,
    });
    expect(evaluate('a = 10; a * 3;')).toEqual({ a: 10, result: 30 });
    expect(asToolResult('1245 + 320 + 890')).toEqual({ result: 2455 });
  });

  it('functions', () => {
    expect(evaluate('round(2.5)')).toBe(3); // half away from zero
    expect(evaluate('round(2.675, 2)')).toBe(2.68);
    expect(evaluate('round(-2.5)')).toBe(-3);
    expect(evaluate('mean(14, 12, 16, 13, 15)')).toBe(14);
    expect(evaluate('sum(1200, 450, 300)')).toBe(1950);
    expect(evaluate('max(3, 9, 4) - min(3, 9, 4)')).toBe(6);
    expect(evaluate('sqrt(16) + abs(-2)')).toBe(6);
  });

  it('dates', () => {
    expect(evaluate('days_between("2026-03-15", "2026-08-28")')).toBe(166);
    expect(evaluate('add_days("2026-01-30", 30)')).toBe('2026-03-01');
    raises('days_between("15/03/2026", "2026-08-28")', 'not a date');
  });

  it('units', () => {
    expect(evaluate('convert(3.5, "mi", "km")')).toBe(5.632704);
    expect(evaluate('round(convert(31, "kg", "lb"), 2)')).toBe(68.34);
    expect(evaluate('round(convert(176, "m", "ft"), 2)')).toBe(577.43);
    expect(evaluate('convert(100, "C", "F")')).toBe(212);
    expect(evaluate('round(convert(90, "km/h", "mph"), 1)')).toBe(55.9);
    raises('convert(3, "kg", "km")', 'cannot convert');
    raises('convert(3, "furlong", "km")', 'unknown unit');
  });

  it('refuses what is not the grammar', () => {
    raises("__import__('os')", 'unknown function');
    raises('a.b', 'unexpected character');
    raises("open('x')", 'unknown function');
    raises('x + 1', 'unknown name');
    raises('1 / 0', 'division by zero');
    raises('2 ^ 5000', 'exponent too large');
    raises('('.repeat(100) + '1' + ')'.repeat(100), 'nested too deeply');
    raises('1 +', 'unexpected');
    raises('', 'empty');
    raises('round = 2', 'function name');
    expect(asToolResult('1/0')).toEqual({ error: 'division by zero' });
  });
});

describe('expression — JS pitfalls (values checked against the Python evaluator)', () => {
  it('rounds the shortest decimal, half away from zero, not the binary value', () => {
    expect(evaluate('round(1.005, 2)')).toBe(1.01); // (1.005).toFixed(2) is "1.00"
    expect(evaluate('round(2.675, 2)')).toBe(2.68);
    expect(evaluate('round(-1.005, 2)')).toBe(-1.01);
    expect(evaluate('round(0.5)')).toBe(1); // Math.round-style ties-to-even would not matter here, -0.5 would
    expect(evaluate('round(-0.5)')).toBe(-1); // Math.round(-0.5) is -0
    raises('round(2.5, 1.5)', 'whole number from 0 to 12');
    raises('round(2.5, 13)', 'whole number from 0 to 12');
  });

  it('cleans to 12 significant digits and keeps big numbers as floats', () => {
    expect(evaluate('0.1 + 0.2')).toBe(0.3);
    expect(evaluate('123456789 * 987654321')).toBe(1.21932631113e17);
    expect(evaluate('2^0.5')).toBe(1.41421356237);
    expect(evaluate('1234567890.125 * 1')).toBe(1234567890.12); // exact tie: half-even, not toPrecision's "up"
    expect(evaluate('sqrt(16) - 4')).toBe(0);
    expect(Object.is(evaluate('-0'), 0)).toBe(true);
  });

  it('sums exactly like math.fsum', () => {
    expect(evaluate('sum(1e100, 1, -1e100)')).toBe(1); // a naive running sum gives 0
    expect(evaluate('sum(0.1, 0.2, 0.3)')).toBe(0.6);
    expect(evaluate('mean(0.1, 0.2)')).toBe(0.15);
  });

  it('keeps Python errors where JS would return a value', () => {
    raises('(-8)^(1/3)', 'power of a negative number to a fraction'); // JS: NaN
    raises('0^-1', 'power out of range'); // JS: Infinity
    raises('10^400', 'power out of range');
    raises('2^1000 * 2^1000', 'result out of range');
    raises('"a" + 1', "expected a number, got 'a'");
    raises('round(1, 2, 3)', 'wrong number of arguments for round');
    raises('constructor(1)', 'unknown function'); // not an Object.prototype lookup
    raises('toString', 'unknown name');
  });

  it('shapes the named result like Python', () => {
    expect(evaluate('a = 1; a = 2; b = 3; result = 7')).toEqual({ a: 2, b: 3, result: 7 });
    expect(Object.keys(evaluate('__proto__ = 1; x = 2') as object)).toEqual(['__proto__', 'x']);
  });

  it('reads dates in UTC, including the forms Python accepts', () => {
    expect(evaluate('add_days("2026-W11-3", 1)')).toBe('2026-03-12');
    expect(evaluate('days_between("20260315", "2026-W11")')).toBe(-6);
    expect(evaluate('add_days("2024-02-28", 2)')).toBe('2024-03-01');
    expect(evaluate('add_days("0001-01-02", -1)')).toBe('0001-01-01');
    raises('days_between("2026-02-30", "2026-03-01")', 'not a date');
    raises('add_days("2026-03-15", 1e9)', 'date out of range');
  });

  it('quotes values like repr() in messages', () => {
    expect(asToolResult('unknown(1)')).toEqual({ error: "unknown function 'unknown'" });
    expect(asToolResult('add_days(3, 1)')).toEqual({
      error: 'expected a date "YYYY-MM-DD", got 3.0',
    });
    expect(asToolResult('1 $')).toEqual({ error: "unexpected character '$' at 2" });
  });
});
