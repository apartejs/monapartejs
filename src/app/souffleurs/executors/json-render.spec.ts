import { describe, expect, it } from 'vitest';
import { compileSpec, extractYaml, findChart } from './json-render';

const CHART_SPEC = [
  '```yaml-spec',
  'root: doc',
  'elements:',
  '  doc:',
  '    type: Document',
  '    props:',
  '      title: "Ventes 2026"',
  '      lang: "fr"',
  '    children:',
  '      - c1',
  '  c1:',
  '    type: Chart',
  '    props:',
  '      type: "bar"',
  '      labels:',
  '        - "Janvier"',
  '        - "Février"',
  '      series:',
  '        - name: "Ventes"',
  '          values:',
  '            - 120',
  '            - 90',
  '```',
].join('\n');

describe('extractYaml', () => {
  it('takes the first yaml-spec fence', () => {
    expect(extractYaml('Voici :\n```yaml-spec\nroot: doc\n```\nfin')).toBe('root: doc\n');
  });

  it('takes bare YAML that starts with root, and nothing else', () => {
    expect(extractYaml('root: doc\nelements: {}')).toBe('root: doc\nelements: {}');
    expect(extractYaml('Je ne peux pas.')).toBeNull();
  });
});

describe('compileSpec', () => {
  it('compiles the expert output into a spec', () => {
    const spec = compileSpec(CHART_SPEC);
    expect(spec?.root).toBe('doc');
    expect(spec?.elements['c1']?.type).toBe('Chart');
  });

  it('is null for an answer with no spec', () => {
    expect(compileSpec('Bonjour')).toBeNull();
  });
});

describe('findChart', () => {
  it('finds the Chart below the root', () => {
    expect(findChart(compileSpec(CHART_SPEC)!)).toMatchObject({
      type: 'bar',
      labels: ['Janvier', 'Février'],
      series: [{ name: 'Ventes', values: [120, 90] }],
    });
  });

  it('is null for a document without a chart', () => {
    const spec = compileSpec('root: doc\nelements:\n  doc:\n    type: Document\n    props: {}\n');
    expect(findChart(spec!)).toBeNull();
  });
});
