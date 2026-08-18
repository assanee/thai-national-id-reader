import { describe, expect, test } from 'vitest';
import { classifyError, isRecoverable } from '../src/pcsc/reader.ts';
import { TimeoutError } from '../src/pcsc/async-utils.ts';
import { CardRemovedError, CorruptCardDataError, NotThaiIdCardError } from '../src/card/errors.ts';

describe('classifyError', () => {
  test('แยกบัตรที่ไม่ใช่บัตรประชาชนออกจากสาเหตุอื่น', () => {
    expect(classifyError(new NotThaiIdCardError())).toBe('not-thai-id');
  });

  test('แยกกรณีบัตรถูกดึงออกกลางคัน', () => {
    expect(classifyError(new CardRemovedError())).toBe('card-removed');
  });

  test('อ่านรหัส 0x80100066 ของ PC/SC ว่าเป็นบัตรไม่ตอบสนอง', () => {
    expect(classifyError(new Error('SCardConnect error: Card is unresponsive.(0x80100066)'))).toBe(
      'card-unresponsive',
    );
  });

  test('แยกกรณีหมดเวลารอออกจากบัตรไม่ตอบสนอง', () => {
    expect(classifyError(new TimeoutError('เชื่อมต่อบัตร', 5000))).toBe('timeout');
  });
});

describe('isRecoverable', () => {
  /**
   * ลองใหม่ได้เฉพาะเมื่องานก่อนหน้าจบไปแล้วจริง
   * 0x80100066 คือ error ที่บัตรตอบกลับมา แปลว่าคำสั่งเดิมจบแล้ว handle ว่างพอที่จะเริ่มใหม่ได้
   */
  test('ลองใหม่ได้เมื่อบัตรตอบกลับมาว่าไม่ตอบสนอง', () => {
    expect(isRecoverable(new Error('Card is unresponsive.(0x80100066)'))).toBe(true);
  });

  /**
   * เคสสำคัญ: หมดเวลารอไม่ได้แปลว่างานจบ SCardConnect ฝั่ง native ยังค้างและถือ handle อยู่
   * การยิง connect ตัวใหม่ซ้อนเข้าไปทำให้ slot ของ PC/SC พังทั้งตัว ต้องถอดสาย USB ถึงจะฟื้น
   */
  test('ห้ามลองใหม่เมื่อหมดเวลารอ เพราะงานเดิมยังค้างอยู่', () => {
    expect(isRecoverable(new TimeoutError('เชื่อมต่อบัตร', 5000))).toBe(false);
  });

  test('ไม่ลองใหม่เมื่อรู้แน่ว่าเป็นบัตรผิดชนิด', () => {
    expect(isRecoverable(new NotThaiIdCardError())).toBe(false);
  });

  test('ไม่ลองใหม่เมื่อผู้ใช้ดึงบัตรออกเอง', () => {
    expect(isRecoverable(new CardRemovedError())).toBe(false);
  });
});

describe('การจัดประเภทข้อมูลเพี้ยน', () => {
  test('แยกกรณีข้อมูลเพี้ยนออกเป็นสาเหตุของตัวเอง', () => {
    expect(classifyError(new CorruptCardDataError('เลขบัตรไม่ผ่านหลักตรวจสอบ'))).toBe('corrupt-data');
  });

  /**
   * ข้อมูลเพี้ยนเกิดจากคำตอบเลื่อนกัน ซึ่งการเชื่อมต่อใหม่ตั้งแต่ต้นแก้ได้
   * และปลอดภัยที่จะลองใหม่เพราะคำสั่งเดิมจบไปแล้ว ไม่มีงานค้างถือ handle อยู่
   */
  test('ลองใหม่ได้เมื่อข้อมูลเพี้ยน เพราะเชื่อมต่อใหม่แล้วมักหาย', () => {
    expect(isRecoverable(new CorruptCardDataError('เลขบัตรไม่ผ่านหลักตรวจสอบ'))).toBe(true);
  });
});
