import { describe, expect, test, vi } from 'vitest';
import {
  SELECT_THAI_ID_APPLET,
  buildGetResponse,
  buildReadCommand,
  readField,
  splitResponse,
} from '../src/card/apdu.ts';
import { ApduError } from '../src/card/errors.ts';

const hex = (buffer: Buffer) => buffer.toString('hex').toUpperCase();

describe('buildReadCommand', () => {
  test('ประกอบคำสั่งอ่านจาก offset และความยาวที่ระบุ', () => {
    expect(hex(buildReadCommand(0x0004, 0x0d))).toBe('80B0000402000D');
  });

  test('แยก offset สองไบต์ได้ถูกต้องเมื่อค่าเกินหนึ่งไบต์', () => {
    expect(hex(buildReadCommand(0x1579, 0x64))).toBe('80B01579020064');
  });
});

describe('buildGetResponse', () => {
  test('ประกอบคำสั่ง GET RESPONSE ตามความยาวที่ต้องการ', () => {
    expect(hex(buildGetResponse(0x0d))).toBe('00C000000D');
  });
});

describe('SELECT_THAI_ID_APPLET', () => {
  test('ใช้ AID ของบัตรประชาชนไทย', () => {
    expect(hex(SELECT_THAI_ID_APPLET)).toBe('00A4040008A000000054480001');
  });
});

describe('splitResponse', () => {
  test('แยกข้อมูลออกจาก status word สองไบต์ท้าย', () => {
    const { data, statusWord } = splitResponse(Buffer.from([0x31, 0x32, 0x90, 0x00]));
    expect(hex(data)).toBe('3132');
    expect(statusWord).toBe(0x9000);
  });

  test('อ่าน status word แบบ 61xx ที่บอกว่ามีข้อมูลรออยู่', () => {
    expect(splitResponse(Buffer.from([0x61, 0x0d])).statusWord).toBe(0x610d);
  });

  test('โยน ApduError เมื่อคำตอบสั้นกว่า status word', () => {
    expect(() => splitResponse(Buffer.from([0x90]))).toThrow(ApduError);
  });
});

describe('readField', () => {
  test('บัตร T=0 ต้องส่ง GET RESPONSE ตามหลังเพื่อดึงข้อมูลจริง', async () => {
    const transmit = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from([0x61, 0x02]))
      .mockResolvedValueOnce(Buffer.from([0x41, 0x42, 0x90, 0x00]));

    const data = await readField(transmit, 0x0004, 2, 'T=0');

    expect(hex(data)).toBe('4142');
    expect(transmit).toHaveBeenCalledTimes(2);
    expect(hex(transmit.mock.calls[0]![0])).toBe('80B00004020002');
    expect(hex(transmit.mock.calls[1]![0])).toBe('00C0000002');
  });

  test('บัตร T=1 ได้ข้อมูลกลับมาในครั้งเดียว ไม่ต้อง GET RESPONSE', async () => {
    const transmit = vi.fn().mockResolvedValueOnce(Buffer.from([0x41, 0x42, 0x90, 0x00]));

    const data = await readField(transmit, 0x0004, 2, 'T=1');

    expect(hex(data)).toBe('4142');
    expect(transmit).toHaveBeenCalledTimes(1);
  });

  test('โยน ApduError เมื่อบัตรตอบ status word ที่ไม่สำเร็จ', async () => {
    const transmit = vi.fn().mockResolvedValue(Buffer.from([0x6a, 0x82]));

    await expect(readField(transmit, 0x0004, 2, 'T=1')).rejects.toThrow(ApduError);
  });
});
