/**
 * Page de DEBUG (non liée dans l'UI) : /debug/artefacts
 * Exerce le renderer de carte artefact sur les trois chemins critiques SANS
 * modèle : carte fraîche (Map remplie), carte « reload » (Map vide →
 * réhydratation Dexie), live streaming (code coloré). Un vrai PDF 3 pages est
 * généré localement via jsPDF.
 */
import { AfterViewInit, Component, ElementRef, inject, viewChild } from '@angular/core';
import type { AparteToolCallSegment } from '@aparte/core';
import { conversationAdapter } from '../../core/aparte.config';
import { artifactCardRenderer } from '../../souffleurs';
import {
  artifactsByCall,
  clearLiveArtifact,
  notifyArtifact,
  pushLiveArtifact,
  type ProducedArtifact,
} from '../../souffleurs/tools/artifact-store';

const PDF_CODE_SAMPLE = `const doc = new jsPDF();
doc.setFontSize(22);
doc.text('Facture', 105, 24, { align: 'center' });
doc.autoTable({
  head: [['Article', 'Quantité', 'Prix']],
  body: [['Conseil', '2', '400 €'], ['Support', '1', '150 €']],
  startY: 40,
});
doc.addPage();
doc.text('Conditions', 14, 20);
return doc.output('blob');`;

@Component({
  selector: 'bp-debug-artefacts',
  standalone: true,
  template: `
    <div class="wrap">
      <h2>debug artefacts</h2>
      <p>1 — carte fraîche (Map mémoire remplie)</p>
      <div #fresh data-case="fresh"></div>
      <p>2 — carte « reload » : Map vide, result absent → réhydratation Dexie</p>
      <div #reload data-case="reload"></div>
      <p>3 — live : code streamé + coloration</p>
      <div #live data-case="live"></div>
    </div>
  `,
  styles: `
    .wrap { padding: 24px; max-width: 720px; margin: 0 auto; overflow-y: auto; height: 100%; }
    p { font-family: var(--bp-mono); font-size: 12px; color: var(--aparte-text-muted); margin: 22px 0 6px; }
  `,
})
export class DebugArtefactsComponent implements AfterViewInit {
  private readonly fresh = viewChild.required<ElementRef<HTMLElement>>('fresh');
  private readonly reload = viewChild.required<ElementRef<HTMLElement>>('reload');
  private readonly live = viewChild.required<ElementRef<HTMLElement>>('live');
  private readonly host = inject(ElementRef);

  async ngAfterViewInit(): Promise<void> {
    // PAS d'injection manuelle de styles : le harnais doit passer par le même
    // chemin que l'app réelle (installToolRendererStyles dans aparte.config) —
    // c'est ce qui aurait détecté le bug « carte sans styles au reload ».
    const artifact = await makePdfArtifact();

    // ── Cas 1 : carte fraîche ──
    artifactsByCall.set('dbg-fresh', artifact);
    this.mount(this.fresh().nativeElement, {
      id: 'seg-fresh',
      type: 'tool_call',
      toolCall: { id: 'dbg-fresh', name: 'write_file', input: {} },
      status: 'resolved',
      result: JSON.stringify({ ok: true, type: 'pdf', filename: artifact.filename, size_kb: 9.3 }),
    } as AparteToolCallSegment);

    // ── Cas 2 : « reload » — rien en Map, PAS de result ; Dexie seulement ──
    await conversationAdapter.db.artifacts.put({
      id: 'dbg-file-reload',
      convId: '',
      msgId: 'dbg-reload',
      name: artifact.filename,
      mimeType: artifact.mime,
      artifactType: 'pdf',
      content: '',
      blob: artifact.blob,
      updatedAt: Date.now(),
    });
    artifactsByCall.delete('dbg-reload');
    this.mount(this.reload().nativeElement, {
      id: 'seg-reload',
      type: 'tool_call',
      toolCall: { id: 'dbg-reload', name: 'write_file', input: {} },
      status: 'resolved',
      result: undefined,
    } as unknown as AparteToolCallSegment);

    // ── Cas 3 : live streaming du code ──
    this.mount(this.live().nativeElement, {
      id: 'seg-live',
      type: 'tool_call',
      toolCall: { id: 'dbg-live', name: 'write_file', input: {} },
      status: 'pending',
    } as AparteToolCallSegment);
    let i = 0;
    const timer = setInterval(() => {
      i += 7;
      pushLiveArtifact('dbg-live', { code: PDF_CODE_SAMPLE.slice(0, i) });
      if (i >= PDF_CODE_SAMPLE.length) {
        clearInterval(timer);
        setTimeout(() => clearLiveArtifact('dbg-live'), 3000);
      }
    }, 60);
  }

  private mount(host: HTMLElement, segment: AparteToolCallSegment): void {
    // Depuis aparté 0.13 un renderer peut rendre un HTMLElement déjà monté
    // plutôt qu'une chaîne — le bras sûr, sans surface innerHTML. Le nôtre
    // rend encore une chaîne, mais le contrat porte l'union : on traite les deux.
    const rendered = artifactCardRenderer.render(segment);
    let el: HTMLElement | null;
    if (typeof rendered === 'string') {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = rendered;
      el = wrapper.firstElementChild as HTMLElement | null;
    } else {
      el = rendered;
    }
    if (!el) {
      host.textContent = '[render() → élément null]';
      return;
    }
    host.appendChild(el);
    artifactCardRenderer.setup?.(el, segment);
  }
}

async function makePdfArtifact(): Promise<ProducedArtifact> {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyPlugin(jsPDF as any);
  const doc = new jsPDF();
  doc.setFontSize(22);
  doc.text('Facture — test aparté', 105, 24, { align: 'center' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    head: [['Article', 'Quantité', 'Prix']],
    body: [
      ['Conseil', '2', '400 €'],
      ['Support', '1', '150 €'],
      ['Licence', '3', '90 €'],
    ],
    startY: 40,
  });
  doc.addPage();
  doc.text('Page 2 — conditions générales', 14, 20);
  doc.addPage();
  doc.text('Page 3 — annexes', 14, 20);
  const blob = doc.output('blob');
  const artifact: ProducedArtifact = {
    kind: 'pdf',
    filename: 'facture-test.pdf',
    mime: 'application/pdf',
    blob,
    preview: '',
  };
  notifyArtifact('dbg-fresh', artifact, 'dbg-file-fresh');
  return artifact;
}
