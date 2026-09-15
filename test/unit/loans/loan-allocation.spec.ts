import { allocatePayment, type AllocatableInstallment } from '../../../src/modules/loans/domain/loan-allocation.js';

function installment(overrides: Partial<AllocatableInstallment> & { id: string }): AllocatableInstallment {
  return {
    installmentNumber: 1,
    dueDate: '2026-01-15',
    principalDueCents: 0,
    interestDueCents: 0,
    lateFeeDueCents: 0,
    ...overrides,
  };
}

describe('allocatePayment', () => {
  it('cubre mora, luego interés y luego capital dentro de la cuota', () => {
    const result = allocatePayment(10_000, [
      installment({ id: '1', lateFeeDueCents: 1_000, interestDueCents: 2_000, principalDueCents: 20_000 }),
    ]);
    expect(result.allocations).toEqual([{ installmentId: '1', principalCents: 7_000, interestCents: 2_000, lateFeeCents: 1_000 }]);
    expect(result.unappliedCents).toBe(0);
  });

  it('salda la cuota más antigua antes de tocar la siguiente', () => {
    const result = allocatePayment(5_000, [
      installment({ id: 'nueva', installmentNumber: 2, dueDate: '2026-02-15', principalDueCents: 10_000 }),
      installment({ id: 'vieja', installmentNumber: 1, dueDate: '2026-01-15', principalDueCents: 3_000 }),
    ]);
    expect(result.allocations.map((entry) => entry.installmentId)).toEqual(['vieja', 'nueva']);
    expect(result.allocations[0].principalCents).toBe(3_000);
    expect(result.allocations[1].principalCents).toBe(2_000);
  });

  it('no aplica a capital dejando intereses vencidos vivos', () => {
    // El caso que mantiene moroso a quien pagó: si el capital se cobrara primero, la cuota
    // seguiría abierta por el interés y los días de atraso no pararían.
    const result = allocatePayment(2_000, [installment({ id: '1', interestDueCents: 2_000, principalDueCents: 8_000 })]);
    expect(result.allocations[0]).toEqual({
      installmentId: '1',
      principalCents: 0,
      interestCents: 2_000,
      lateFeeCents: 0,
    });
  });

  it('devuelve el excedente en vez de adelantar cuotas por su cuenta', () => {
    const result = allocatePayment(10_000, [installment({ id: '1', principalDueCents: 4_000 })]);
    expect(result.unappliedCents).toBe(6_000);
    expect(result.allocations).toHaveLength(1);
  });

  it('omite las cuotas que no reciben nada', () => {
    const result = allocatePayment(1_000, [
      installment({ id: '1', dueDate: '2026-01-15', principalDueCents: 1_000 }),
      installment({ id: '2', dueDate: '2026-02-15', principalDueCents: 5_000 }),
    ]);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].installmentId).toBe('1');
  });

  it('ignora saldos negativos en lugar de convertirlos en un cobro al revés', () => {
    const result = allocatePayment(1_000, [installment({ id: '1', principalDueCents: 500, interestDueCents: -300 })]);
    expect(result.allocations[0]).toEqual({
      installmentId: '1',
      principalCents: 500,
      interestCents: 0,
      lateFeeCents: 0,
    });
    expect(result.unappliedCents).toBe(500);
  });

  it('rechaza un cobro no positivo', () => {
    expect(() => allocatePayment(0, [])).toThrow();
    expect(() => allocatePayment(-100, [])).toThrow();
  });

  it('nunca reparte más de lo cobrado', () => {
    const result = allocatePayment(7_531, [
      installment({ id: '1', dueDate: '2026-01-15', principalDueCents: 3_000, interestDueCents: 500, lateFeeDueCents: 120 }),
      installment({ id: '2', dueDate: '2026-02-15', principalDueCents: 3_000, interestDueCents: 400 }),
      installment({ id: '3', dueDate: '2026-03-15', principalDueCents: 3_000, interestDueCents: 300 }),
    ]);
    const applied = result.allocations.reduce((total, entry) => total + entry.principalCents + entry.interestCents + entry.lateFeeCents, 0);
    expect(applied + result.unappliedCents).toBe(7_531);
  });
});
