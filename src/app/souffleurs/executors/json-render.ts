/**
 * The json-render expert's output (ADR-003) → a spec. The expert writes a ```yaml-spec fence; it is compiled by
 * @json-render/yaml's stream compiler, the path the lab's checks use (aparte-json-render-exporters
 * tools/check-specs.mjs), so a spec the lab counted as compiled compiles here too.
 */
import { createYamlStreamCompiler } from '@json-render/yaml';

export interface JsonRenderSpec {
  root: string;
  elements: Record<string, { type: string; props?: Record<string, unknown>; children?: string[] }>;
}

const FENCE = /```yaml-spec[^\n]*\n([\s\S]*?)(?:```|$)/;

/** The YAML of the first yaml-spec fence; bare YAML starting with `root:`; or null. */
export function extractYaml(text: string): string | null {
  const m = FENCE.exec(text);
  if (m) return m[1];
  const t = text.trim();
  return /^root\s*:/.test(t) ? t : null;
}

/** The spec the expert wrote, or null when it is not one (no fence, YAML that does not compile, no root). */
export function compileSpec(text: string): JsonRenderSpec | null {
  const yaml = extractYaml(text);
  if (yaml === null) return null;
  try {
    const compiler = createYamlStreamCompiler();
    compiler.push(yaml.endsWith('\n') ? yaml : yaml + '\n');
    const { result } = compiler.flush() as { result?: Partial<JsonRenderSpec> | null };
    return result && typeof result.root === 'string' && result.elements
      ? (result as JsonRenderSpec)
      : null;
  } catch {
    return null;
  }
}

/** The props of the spec's first Chart, in reading order from the root; null when it has none. */
export function findChart(spec: JsonRenderSpec): Record<string, unknown> | null {
  const seen = new Set<string>();
  const walk = (key: string): Record<string, unknown> | null => {
    if (seen.has(key)) return null;
    seen.add(key);
    const el = spec.elements[key];
    if (!el) return null;
    if (el.type === 'Chart') return el.props ?? {};
    for (const child of el.children ?? []) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(spec.root);
}
