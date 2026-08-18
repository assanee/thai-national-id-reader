/**
 * ยิงข้อมูลขยะใส่ทุกฟังก์ชันที่รับข้อมูลจากภายนอก
 *
 * ข้อมูลจากบัตรคือข้อมูลที่เราควบคุมไม่ได้ — บัตรชำรุด บัตรรุ่นแปลก หรือคำตอบที่เลื่อนกัน
 * ล้วนทำให้ได้ไบต์ที่ไม่คาดคิด ตัวถอดรหัสต้องไม่ระเบิดใส่ ไม่ว่าจะได้อะไรเข้าไป
 */
import { describe, expect, test } from 'vitest';
import {
  decodeThaiText,
  isValidThaiCid,
  parseAddress,
  parseBuddhistDate,
  parseGender,
  parseName,
} from '../src/card/decode.ts';
import { splitResponse } from '../src/card/apdu.ts';
import { ApduError } from '../src/card/errors.ts';
import { interpretStatusChange } from '../src/pcsc/card-state.ts';

/** ตัวสุ่มแบบกำหนดเมล็ดได้ เพื่อให้เทสต์ที่ล้มเหลวทำซ้ำได้เสมอ */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const ITERATIONS = 3000;

describe('ตัวถอดรหัสต้องไม่โยนข้อผิดพลาดไม่ว่าจะได้ไบต์อะไร', () => {
  test('decodeThaiText รับไบต์สุ่มได้ทุกรูปแบบ', () => {
    const random = createRandom(1);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const length = Math.floor(random() * 260);
      const bytes = Buffer.from(
        Array.from({ length }, () => Math.floor(random() * 256)),
      );
      expect(() => decodeThaiText(bytes)).not.toThrow();
      expect(typeof decodeThaiText(bytes)).toBe('string');
    }
  });

  test('ฟังก์ชันแยกข้อความรับสตริงสุ่มได้ทุกรูปแบบ', () => {
    const random = createRandom(2);
    const alphabet = [...'0123456789#นายสมชใจดี ABCabc/-.\t\n'];

    for (let i = 0; i < ITERATIONS; i += 1) {
      const length = Math.floor(random() * 120);
      const text = Array.from(
        { length },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join('');

      expect(() => parseName(text)).not.toThrow();
      expect(() => parseAddress(text)).not.toThrow();
      expect(() => parseGender(text)).not.toThrow();
      expect(() => parseBuddhistDate(text)).not.toThrow();
      expect(() => isValidThaiCid(text)).not.toThrow();
    }
  });

  test('parseBuddhistDate คืนได้แค่ null หรือวันที่รูปแบบ ISO ที่ถูกต้องเท่านั้น', () => {
    const random = createRandom(3);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const digits = Array.from({ length: 8 }, () => Math.floor(random() * 10)).join('');
      const result = parseBuddhistDate(digits);

      if (result !== null) {
        expect(result).toMatch(/^\d{1,4}-\d{2}-\d{2}$/);
        // ต้องเป็นวันที่ที่มีอยู่จริงในปฏิทิน ไม่ใช่แค่รูปแบบถูก
        const [year, month, day] = result.split('-').map(Number);
        const date = new Date(Date.UTC(2000, month! - 1, day!));
        expect(date.getUTCMonth()).toBe(month! - 1);
        expect(date.getUTCDate()).toBe(day!);
        expect(year).toBeGreaterThan(0);
      }
    }
  });

  test('isValidThaiCid ผ่านเฉพาะเลขที่คำนวณหลักตรวจสอบแล้วตรงจริง', () => {
    const random = createRandom(4);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = Array.from({ length: 12 }, () => Math.floor(random() * 10)).join('');
      let sum = 0;
      for (let index = 0; index < 12; index += 1) sum += Number(prefix[index]) * (13 - index);
      const expected = (11 - (sum % 11)) % 10;

      expect(isValidThaiCid(prefix + expected)).toBe(true);
      expect(isValidThaiCid(prefix + ((expected + 1) % 10))).toBe(false);
    }
  });
});

describe('splitResponse รับ buffer สุ่มได้โดยไม่พังแบบคาดไม่ถึง', () => {
  test('คืนผลลัพธ์หรือโยน ApduError เท่านั้น ไม่มีข้อผิดพลาดชนิดอื่น', () => {
    const random = createRandom(5);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const length = Math.floor(random() * 8);
      const bytes = Buffer.from(Array.from({ length }, () => Math.floor(random() * 256)));

      try {
        const { data, statusWord } = splitResponse(bytes);
        expect(data.length).toBe(bytes.length - 2);
        expect(statusWord).toBeGreaterThanOrEqual(0);
        expect(statusWord).toBeLessThanOrEqual(0xffff);
      } catch (error) {
        expect(error).toBeInstanceOf(ApduError);
      }
    }
  });
});

describe('interpretStatusChange รับบิตสถานะสุ่มได้ทุกค่า', () => {
  test('คืนได้แค่สามค่าที่นิยามไว้เท่านั้น', () => {
    const random = createRandom(6);
    const allowed = new Set(['inserted', 'removed', 'none']);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const previous = random() < 0.2 ? undefined : Math.floor(random() * 0x1000);
      const current = Math.floor(random() * 0x1000);

      expect(allowed.has(interpretStatusChange(previous, current))).toBe(true);
    }
  });

  test('ไม่มีทางตีความว่าเสียบและถอดพร้อมกัน', () => {
    const random = createRandom(7);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const previous = Math.floor(random() * 0x1000);
      const current = Math.floor(random() * 0x1000);
      const forward = interpretStatusChange(previous, current);
      const backward = interpretStatusChange(current, previous);

      // ถ้าไปข้างหน้าคือเสียบ ย้อนกลับต้องเป็นถอดเสมอ
      if (forward === 'inserted') expect(backward).toBe('removed');
      if (forward === 'removed') expect(backward).toBe('inserted');
      if (forward === 'none') expect(backward).toBe('none');
    }
  });
});
