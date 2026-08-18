import { describe, expect, test, vi } from 'vitest';
import { TimeoutError, withRetry, withTimeout } from '../src/pcsc/async-utils.ts';

describe('withTimeout', () => {
  test('คืนค่าปกติเมื่องานเสร็จทันเวลา', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'งาน')).resolves.toBe('ok');
  });

  /**
   * จำเป็นเพราะ SCardConnect ค้างได้แบบไม่มี callback กลับมาเลย
   * ถ้าไม่มี timeout ตัวเฝ้ารอจะแข็งค้างถาวรและไม่มีทางฟื้น
   */
  test('โยน TimeoutError เมื่องานไม่ตอบกลับภายในเวลาที่กำหนด', async () => {
    const stuck = new Promise(() => {});
    await expect(withTimeout(stuck, 20, 'เชื่อมต่อบัตร')).rejects.toThrow(TimeoutError);
  });

  test('ข้อความบอกได้ว่างานไหนที่ค้าง', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'เชื่อมต่อบัตร')).rejects.toThrow(
      /เชื่อมต่อบัตร/,
    );
  });

  test('ส่งต่อข้อผิดพลาดเดิมโดยไม่แปลงเป็น timeout', async () => {
    const failing = Promise.reject(new Error('พังจริง'));
    await expect(withTimeout(failing, 1000, 'งาน')).rejects.toThrow('พังจริง');
  });
});

describe('withRetry', () => {
  test('คืนค่าทันทีเมื่อสำเร็จตั้งแต่ครั้งแรก', async () => {
    const task = vi.fn().mockResolvedValue('ok');

    await expect(withRetry(task, { attempts: 3 })).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  test('ลองใหม่จนสำเร็จ', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('บัตรไม่ตอบสนอง'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(task, { attempts: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });

  test('โยนข้อผิดพลาดครั้งสุดท้ายเมื่อลองครบจำนวนแล้วยังไม่สำเร็จ', async () => {
    const task = vi.fn().mockRejectedValue(new Error('บัตรไม่ตอบสนอง'));

    await expect(withRetry(task, { attempts: 3, delayMs: 0 })).rejects.toThrow('บัตรไม่ตอบสนอง');
    expect(task).toHaveBeenCalledTimes(3);
  });

  test('หยุดทันทีโดยไม่ลองใหม่เมื่อ shouldRetry บอกว่าไม่ควรลอง', async () => {
    const task = vi.fn().mockRejectedValue(new Error('ไม่ใช่บัตรประชาชน'));

    await expect(
      withRetry(task, { attempts: 3, delayMs: 0, shouldRetry: () => false }),
    ).rejects.toThrow('ไม่ใช่บัตรประชาชน');
    expect(task).toHaveBeenCalledTimes(1);
  });

  test('แจ้งผู้เรียกทุกครั้งที่กำลังจะลองใหม่ เพื่อให้เคลียร์สถานะก่อน', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const task = vi.fn().mockRejectedValueOnce(new Error('ค้าง')).mockResolvedValueOnce('ok');

    await withRetry(task, { attempts: 3, delayMs: 0, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});
