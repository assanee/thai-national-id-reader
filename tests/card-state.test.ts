import { describe, expect, test } from 'vitest';
import { interpretStatusChange, STATE } from '../src/pcsc/card-state.ts';

describe('interpretStatusChange', () => {
  test('บัตรถูกเสียบเข้ามาเมื่อสถานะเปลี่ยนจากว่างเป็นมีบัตร', () => {
    expect(interpretStatusChange(STATE.EMPTY, STATE.PRESENT)).toBe('inserted');
  });

  test('บัตรถูกถอดออกเมื่อสถานะเปลี่ยนจากมีบัตรเป็นว่าง', () => {
    expect(interpretStatusChange(STATE.PRESENT, STATE.EMPTY)).toBe('removed');
  });

  /**
   * เคสนี้สำคัญที่สุด: pcsclite ตั้งค่า reader.state หลังยิง event
   * ดังนั้น event แรกสุดจะได้ previous เป็น undefined เสมอ
   * ถ้าไม่รองรับ บัตรที่เสียบค้างอยู่ก่อนโปรแกรมเริ่มจะไม่ถูกตรวจเจอเลย
   */
  test('ถือว่าเสียบบัตรเมื่อเห็นบัตรครั้งแรกทั้งที่ยังไม่เคยรู้สถานะเดิม', () => {
    expect(interpretStatusChange(undefined, STATE.PRESENT)).toBe('inserted');
  });

  test('ไม่ถือว่ามีอะไรเกิดขึ้นเมื่อเห็นช่องว่างครั้งแรก', () => {
    expect(interpretStatusChange(undefined, STATE.EMPTY)).toBe('none');
  });

  test('ไม่ยิงซ้ำเมื่อสถานะบัตรไม่เปลี่ยน แม้บิตอื่นจะเปลี่ยน', () => {
    expect(interpretStatusChange(STATE.PRESENT, STATE.PRESENT | STATE.INUSE)).toBe('none');
  });

  test('ไม่ยิงซ้ำเมื่อสถานะเหมือนเดิมทุกประการ', () => {
    expect(interpretStatusChange(STATE.PRESENT, STATE.PRESENT)).toBe('none');
  });

  test('บิต CHANGED ที่ระบบใส่มาด้วยไม่ทำให้ตีความผิด', () => {
    expect(interpretStatusChange(undefined, STATE.PRESENT | STATE.CHANGED)).toBe('inserted');
    expect(interpretStatusChange(STATE.PRESENT, STATE.EMPTY | STATE.CHANGED)).toBe('removed');
  });
});
