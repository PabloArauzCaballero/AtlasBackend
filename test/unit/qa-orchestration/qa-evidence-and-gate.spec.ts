import { AdmissionGate } from '../../../src/modules/qa-orchestration/infrastructure/admission-gate';
import { summarize } from '../../../src/modules/qa-orchestration/application/step-runner';

describe('evidencia QA: la URL firmada de subida no se guarda', () => {
  it('uploadUrl y cualquier valor con firma se redactan en el resumen de la respuesta', () => {
    const resumen = summarize({
      data: { uploadUrl: 'https://s3.local/bucket/x?X-Amz-Signature=abc', path: 'a/b', otra: 'https://s3.local/x?token=zzz', ok: 'https://qa.local/ok' },
    });
    expect(resumen).toEqual({ data: { uploadUrl: '[REDACTED]', path: 'a/b', otra: '[REDACTED]', ok: 'https://qa.local/ok' } });
  });
});

describe('AdmissionGate', () => {
  it('al vencer la espera quita su oyente de la señal compartida: no se acumulan por vuelta', async () => {
    const controller = new AbortController();
    const quitar = jest.spyOn(controller.signal, 'removeEventListener');
    const gate = new AdmissionGate(1, 60);

    await gate.admit(controller.signal);
    const segunda = await gate.admit(controller.signal);

    expect(segunda.admissionLagMs).toBeGreaterThan(0);
    expect(quitar).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('abortar la señal despierta a quien espera', async () => {
    const controller = new AbortController();
    const gate = new AdmissionGate(1, 60_000);
    await gate.admit(controller.signal);
    const esperando = gate.admit(controller.signal);
    controller.abort();
    await expect(esperando).resolves.toMatchObject({ queuedAhead: 0 });
  });
});
