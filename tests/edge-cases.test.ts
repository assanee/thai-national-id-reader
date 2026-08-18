/**
 * เทสต์เชิงรุก — ตั้งใจหาจุดที่โค้ดพัง ไม่ใช่ยืนยันว่าทำงาน
 *
 * ทุกเคสในไฟล์นี้มาจากการไล่อ่านโค้ดแล้วถามว่า "ถ้าใส่ค่านี้เข้าไปจะเกิดอะไรขึ้น"
 */
import { describe, expect, test, vi } from 'vitest';
import { buildGetResponse, buildReadCommand, readField, splitResponse } from '../src/card/apdu.ts';
import { ApduError, CorruptCardDataError } from '../src/card/errors.ts';
import { parseAddress, parseBuddhistDate, parseName, isValidThaiCid } from '../src/card/decode.ts';
import { withRetry, withTimeout } from '../src/pcsc/async-utils.ts';
import { readThaiIdCard } from '../src/card/thai-id.ts';
import { PHOTO } from '../src/card/fields.ts';
import { createFakeCard } from './fake-card.ts';

describe('buildReadCommand — ขอบเขตของค่า', () => {
  test('ปฏิเสธ offset ที่เกิน 2 ไบต์ แทนที่จะตัดทิ้งเงียบ ๆ แล้วไปอ่านผิดตำแหน่ง', () => {
    expect(() => buildReadCommand(0x10000, 13)).toThrow(ApduError);
  });

  test('ปฏิเสธ offset ติดลบ', () => {
    expect(() => buildReadCommand(-1, 13)).toThrow(ApduError);
  });

  test('ปฏิเสธความยาวเกิน 255 เพราะ APDU ส่งได้สูงสุดเท่านั้น', () => {
    expect(() => buildReadCommand(0, 256)).toThrow(ApduError);
  });

  test('ปฏิเสธความยาวเป็นศูนย์หรือติดลบ', () => {
    expect(() => buildReadCommand(0, 0)).toThrow(ApduError);
    expect(() => buildReadCommand(0, -5)).toThrow(ApduError);
  });

  test('ยอมรับค่าที่ขอบพอดี', () => {
    expect(() => buildReadCommand(0xffff, 255)).not.toThrow();
  });

  test('ตำแหน่งรูปถ่ายบล็อกสุดท้ายยังอยู่ในขอบเขตที่ APDU รองรับ', () => {
    const lastOffset = PHOTO.offset + (PHOTO.chunkCount - 1) * PHOTO.chunkLength;
    expect(lastOffset).toBeLessThanOrEqual(0xffff);
    expect(() => buildReadCommand(lastOffset, PHOTO.chunkLength)).not.toThrow();
  });
});

describe('buildGetResponse — ขอบเขตของค่า', () => {
  test('ปฏิเสธความยาวเกิน 255', () => {
    expect(() => buildGetResponse(256)).toThrow(ApduError);
  });
});

describe('splitResponse — คำตอบผิดรูปแบบ', () => {
  test('โยน ApduError เมื่อได้ buffer ว่าง', () => {
    expect(() => splitResponse(Buffer.alloc(0))).toThrow(ApduError);
  });

  test('รับได้เมื่อมีแค่ status word ไม่มีข้อมูล', () => {
    expect(splitResponse(Buffer.from([0x90, 0x00])).data.length).toBe(0);
  });
});

describe('readField — บัตรตอบข้อมูลไม่ครบ', () => {
  test('โยน ApduError เมื่อบัตรคืนข้อมูลสั้นกว่าที่ขอ แทนที่จะคืนข้อมูลบางส่วนเงียบ ๆ', async () => {
    const transmit = vi.fn().mockResolvedValue(Buffer.from([0x41, 0x90, 0x00]));

    await expect(readField(transmit, 0x0004, 10, 'T=1')).rejects.toThrow(ApduError);
  });
});

describe('parseBuddhistDate — วันที่ที่ไม่มีอยู่จริง', () => {
  test('ปฏิเสธวันที่ 30 กุมภาพันธ์ ซึ่งไม่มีอยู่ในปฏิทิน', () => {
    expect(parseBuddhistDate('25300230')).toBeNull();
  });

  test('ปฏิเสธวันที่ 31 เมษายน ซึ่งเดือนนั้นมีแค่ 30 วัน', () => {
    expect(parseBuddhistDate('25300431')).toBeNull();
  });

  test('ยอมรับ 29 กุมภาพันธ์ ในปีอธิกสุรทิน', () => {
    // พ.ศ. 2543 = ค.ศ. 2000 ซึ่งเป็นปีอธิกสุรทิน
    expect(parseBuddhistDate('25430229')).toBe('2000-02-29');
  });

  test('ปฏิเสธ 29 กุมภาพันธ์ ในปีที่ไม่ใช่อธิกสุรทิน', () => {
    expect(parseBuddhistDate('25420229')).toBeNull();
  });

  test('ปฏิเสธปีที่แปลงแล้วติดลบหรือเป็นศูนย์', () => {
    expect(parseBuddhistDate('05000101')).toBeNull();
  });

  test('ปฏิเสธค่าที่มีอักขระอื่นปนแม้จะยาว 8 ตัว', () => {
    expect(parseBuddhistDate('2530123x')).toBeNull();
    expect(parseBuddhistDate('        ')).toBeNull();
  });
});

describe('isValidThaiCid — ตรวจเลขบัตรด้วยหลักตรวจสอบ', () => {
  test('ยอมรับเลขบัตรที่หลักตรวจสอบถูกต้อง', () => {
    expect(isValidThaiCid('1111111111119')).toBe(true);
  });

  test('ปฏิเสธเมื่อหลักสุดท้ายผิด', () => {
    expect(isValidThaiCid('1111111111118')).toBe(false);
  });

  test('ปฏิเสธความยาวที่ไม่ใช่ 13 หลัก', () => {
    expect(isValidThaiCid('')).toBe(false);
    expect(isValidThaiCid('123')).toBe(false);
    expect(isValidThaiCid('11111111111190')).toBe(false);
  });

  test('ปฏิเสธเมื่อมีอักขระที่ไม่ใช่ตัวเลข', () => {
    expect(isValidThaiCid('111111111111x')).toBe(false);
  });
});

describe('parseName — รูปแบบแปลก ๆ', () => {
  test('ไม่พังเมื่อมีเครื่องหมาย # เกินจำนวนช่องปกติ', () => {
    expect(parseName('นาย#ก#ข#ค#ง#จ')).toMatchObject({ title: 'นาย', firstName: 'ก', lastName: 'จ' });
  });

  test('ไม่พังเมื่อมีแต่เครื่องหมาย # ล้วน', () => {
    expect(parseName('#####')).toEqual({
      title: '',
      firstName: '',
      middleName: '',
      lastName: '',
    });
  });

  test('ไม่พังเมื่อไม่มีเครื่องหมาย # เลย', () => {
    expect(parseName('สมชาย')).toMatchObject({ title: 'สมชาย', firstName: '', lastName: '' });
  });
});

describe('parseAddress — รูปแบบแปลก ๆ', () => {
  test('คงช่องว่างภายในข้อความไว้ ไม่ยุบรวม', () => {
    expect(parseAddress('99/1#ซอย ทอง 5')).toBe('99/1 ซอย ทอง 5');
  });

  test('ไม่พังเมื่อสตริงว่าง', () => {
    expect(parseAddress('')).toBe('');
  });
});

describe('withRetry — พารามิเตอร์ผิดปกติ', () => {
  test('โยนข้อผิดพลาดที่อธิบายได้เมื่อสั่งให้ลอง 0 ครั้ง แทนที่จะโยน undefined', async () => {
    await expect(withRetry(async () => 'ok', { attempts: 0 })).rejects.toThrow(Error);
  });

  test('ไม่กลืนข้อผิดพลาดที่เกิดใน onRetry', async () => {
    const task = vi.fn().mockRejectedValue(new Error('พัง'));

    await expect(
      withRetry(task, {
        attempts: 2,
        delayMs: 0,
        onRetry: () => {
          throw new Error('onRetry พังเอง');
        },
      }),
    ).rejects.toThrow();
  });
});

describe('withTimeout — พารามิเตอร์ผิดปกติ', () => {
  test('งานที่เสร็จก่อนไม่ทำให้ timer ค้างจนโปรเซสไม่ยอมจบ', async () => {
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    await withTimeout(Promise.resolve(1), 60_000, 'งาน');
    const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe('readThaiIdCard — บัตรมีปัญหากลางคัน', () => {
  test('ไม่คืนรูปถ่ายที่ไม่ครบ เพราะไฟล์ JPEG ที่ขาดกลางคันเปิดไม่ได้', async () => {
    const failingChunk = PHOTO.offset + 5 * PHOTO.chunkLength;
    const { transmit } = createFakeCard({ protocol: 'T=1', failOffsets: [failingChunk] });

    const card = await readThaiIdCard(transmit, 'T=1', { includePhoto: true });

    expect(card.photo).toBeNull();
  });

  test('ยังคืนข้อมูลข้อความครบถ้วนแม้อ่านรูปไม่สำเร็จ', async () => {
    const { transmit } = createFakeCard({
      protocol: 'T=1',
      failOffsets: [PHOTO.offset + 5 * PHOTO.chunkLength],
    });

    const card = await readThaiIdCard(transmit, 'T=1', { includePhoto: true });

    expect(card.cid).toBe('1234567890121');
    expect(card.firstNameTH).toBe('สมชาย');
  });

  test('รายงานความคืบหน้าไม่เกิน 100 เปอร์เซ็นต์', async () => {
    const { transmit } = createFakeCard({ protocol: 'T=0' });
    const percents: number[] = [];

    await readThaiIdCard(transmit, 'T=0', {
      includePhoto: true,
      onProgress: ({ percent }) => percents.push(percent),
    });

    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    expect(Math.min(...percents)).toBeGreaterThan(0);
  });
});

describe('readThaiIdCard — จับข้อมูลที่เพี้ยนจากการอ่าน', () => {
  /**
   * ป้องกันบั๊กประเภทเดียวกับที่เจอกับบัตรจริง: ข้อมูลค้างจากคำสั่งก่อนหน้า
   * ทำให้ทุกฟิลด์เลื่อนกันทั้งชุด โดยที่ทุกฟิลด์ยังดูมีรูปแบบถูกต้อง
   * หลักตรวจสอบของเลขบัตรเป็นสัญญาณเดียวที่จับความเพี้ยนแบบนี้ได้
   */
  test('โยนข้อผิดพลาดเมื่อเลขบัตรไม่ผ่านหลักตรวจสอบ แทนที่จะคืนข้อมูลเพี้ยนออกไป', async () => {
    const { transmit } = createFakeCard({ protocol: 'T=1', cid: '1234567890123' });

    await expect(readThaiIdCard(transmit, 'T=1')).rejects.toThrow(CorruptCardDataError);
  });

  test('ผ่านตามปกติเมื่อเลขบัตรถูกต้อง', async () => {
    const { transmit } = createFakeCard({ protocol: 'T=1' });

    await expect(readThaiIdCard(transmit, 'T=1')).resolves.toMatchObject({
      cid: '1234567890121',
    });
  });
});
