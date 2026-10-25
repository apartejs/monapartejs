import { describe, expect, it, vi } from 'vitest';
import type { SouffleurStatusState } from '../souffleurs';

let emit: (s: SouffleurStatusState) => void = () => undefined;

vi.mock('../souffleurs', () => ({
  CALLER_MODEL_ID: 'souffleur-chat',
  SouffleursProvider: { getModelStatus: async () => 'cached' },
  subscribeSouffleurStatus: (listener: (s: SouffleurStatusState) => void) => {
    emit = listener;
    return () => undefined;
  },
}));

const { ModelStatusService } = await import('./model-status.service');

describe('ModelStatusService.slowDeviceHint', () => {
  it('on a CPU-only device, shows until the first answer is written', () => {
    const service = new ModelStatusService();
    emit({ status: 'loading', device: 'wasm' });
    expect(service.slowDeviceHint()).toBe(true);
    emit({ status: 'generating', device: 'wasm' });
    expect(service.slowDeviceHint()).toBe(true);
    emit({ status: 'ready', device: 'wasm' });
    expect(service.slowDeviceHint()).toBe(false);
    emit({ status: 'generating', device: 'wasm' });
    expect(service.slowDeviceHint()).toBe(false);
  });

  it('shows while the boot warm-up prefills the prompt, and ends with it (loading → ready)', () => {
    const service = new ModelStatusService();
    emit({ status: 'loading', device: 'wasm' });
    expect(service.slowDeviceHint()).toBe(true);
    emit({ status: 'ready', device: 'wasm' });
    expect(service.slowDeviceHint()).toBe(false);
  });

  it('never on WebGPU', () => {
    const service = new ModelStatusService();
    emit({ status: 'loading', device: 'webgpu' });
    expect(service.slowDeviceHint()).toBe(false);
  });
});
