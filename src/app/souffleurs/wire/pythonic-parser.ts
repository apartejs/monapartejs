/**
 * Parser for the souffleur-chat caller's output — TS port of
 * toolmap_v6.py::parse_pythonic_calls (AST/literal-eval, NO regex on the
 * calls' content) hardened with lessons from the browser harness:
 *  - kwargs only: `name(key=value, ...)`, values = Python literals
 *    (strings, numbers, True/False/None — with true/false/null tolerance),
 *    nested lists and dicts;
 *  - pseudo-python `{key=value}` tolerance (hallucinated kwarg inside a dict);
 *  - unparseable block → `__unparseable__` call with the raw text, never a crash.
 */

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedOutput {
  /** Turn text, tool_call and <think> blocks removed, trimmed. */
  text: string;
  calls: ParsedToolCall[];
}

export const UNPARSEABLE = '__unparseable__';

const TOOL_CALL_RE = /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g;
const THINK_RE = /<think>[\s\S]*?<\/think>/g;

export function parsePythonicOutput(raw: string): ParsedOutput {
  const cut = raw.split('<|im_end|>')[0].replace(THINK_RE, '');

  const calls: ParsedToolCall[] = [];
  for (const m of cut.matchAll(TOOL_CALL_RE)) {
    calls.push(...parseCallList(m[1].trim()));
  }
  const text = cut.replace(TOOL_CALL_RE, '').trim();
  return { text, calls };
}

/** Parses a block's content: list of calls `[a(...), b(...)]` or bare call. */
export function parseCallList(inner: string): ParsedToolCall[] {
  if (!inner) return [];
  try {
    return new Scanner(inner).parseTopLevel();
  } catch {
    return [{ name: UNPARSEABLE, args: { raw: inner } }];
  }
}

class Scanner {
  private pos = 0;
  constructor(private readonly src: string) {}

  parseTopLevel(): ParsedToolCall[] {
    this.skipWs();
    const calls: ParsedToolCall[] = [];
    if (this.peek() === '[') {
      this.pos++;
      this.skipWs();
      while (this.peek() !== ']') {
        calls.push(this.parseCall());
        this.skipWs();
        if (this.peek() === ',') {
          this.pos++;
          this.skipWs();
        }
      }
      this.pos++;
    } else {
      calls.push(this.parseCall());
    }
    this.skipWs();
    if (this.pos < this.src.length) throw new Error('trailing content');
    return calls;
  }

  private parseCall(): ParsedToolCall {
    const name = this.parseIdent();
    this.skipWs();
    this.expect('(');
    const args: Record<string, unknown> = {};
    this.skipWs();
    while (this.peek() !== ')') {
      const key = this.parseIdent();
      this.skipWs();
      this.expect('=');
      args[key] = this.parseLiteral();
      this.skipWs();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWs();
      }
    }
    this.pos++;
    return { name, args };
  }

  private parseLiteral(): unknown {
    this.skipWs();
    const ch = this.peek();
    if (ch === '"' || ch === "'") return this.parseString();
    if (ch === '[') return this.parseArray();
    if (ch === '{') return this.parseDict();
    if (ch === '-' || ch === '+' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    const word = this.tryParseIdent();
    if (word !== null) {
      switch (word) {
        case 'True':
        case 'true':
          return true;
        case 'False':
        case 'false':
          return false;
        case 'None':
        case 'null':
          return null;
        default:
          // Equivalent of the ast.unparse fallback: raw string representation.
          return word;
      }
    }
    throw new Error(`unexpected char at ${this.pos}`);
  }

  private parseString(): string {
    const quote = this.src[this.pos++];
    let out = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos++];
      if (c === quote) return out;
      if (c === '\\') {
        const e = this.src[this.pos++];
        switch (e) {
          case 'n':
            out += '\n';
            break;
          case 't':
            out += '\t';
            break;
          case 'r':
            out += '\r';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case '0':
            out += '\0';
            break;
          case '\\':
            out += '\\';
            break;
          case "'":
            out += "'";
            break;
          case '"':
            out += '"';
            break;
          case 'x':
            out += String.fromCharCode(parseInt(this.src.slice(this.pos, this.pos + 2), 16));
            this.pos += 2;
            break;
          case 'u':
            out += String.fromCharCode(parseInt(this.src.slice(this.pos, this.pos + 4), 16));
            this.pos += 4;
            break;
          default:
            // Python keeps the backslash for an unknown escape.
            out += '\\' + e;
        }
      } else {
        out += c;
      }
    }
    throw new Error('unterminated string');
  }

  private parseNumber(): number {
    const m = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (!m) throw new Error(`invalid number at ${this.pos}`);
    this.pos += m[0].length;
    return Number(m[0]);
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const out: unknown[] = [];
    this.skipWs();
    while (this.peek() !== ']') {
      out.push(this.parseLiteral());
      this.skipWs();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWs();
      }
    }
    this.pos++;
    return out;
  }

  private parseDict(): Record<string, unknown> {
    this.expect('{');
    const out: Record<string, unknown> = {};
    this.skipWs();
    while (this.peek() !== '}') {
      let key: string;
      const ch = this.peek();
      if (ch === '"' || ch === "'") {
        key = this.parseString();
      } else {
        key = this.parseIdent();
      }
      this.skipWs();
      // ':' = valid Python dict; '=' = hallucinated pseudo-python ({key="val"}),
      // tolerated like toolmap_v6.py's regex fallback.
      const sep = this.src[this.pos];
      if (sep !== ':' && sep !== '=') throw new Error(`expected : or = at ${this.pos}`);
      this.pos++;
      out[key] = this.parseLiteral();
      this.skipWs();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWs();
      }
    }
    this.pos++;
    return out;
  }

  private parseIdent(): string {
    const ident = this.tryParseIdent();
    if (ident === null) throw new Error(`expected identifier at ${this.pos}`);
    return ident;
  }

  private tryParseIdent(): string | null {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  private expect(ch: string): void {
    if (this.src[this.pos] !== ch) throw new Error(`expected ${ch} at ${this.pos}`);
    this.pos++;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private peek(): string {
    if (this.pos >= this.src.length) throw new Error('unexpected end');
    return this.src[this.pos];
  }
}
