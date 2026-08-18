/**
 * วงจรชีวิตของตัวเฝ้ารอ
 *
 * สำคัญเป็นพิเศษเพราะโปรแกรมนี้ออกแบบให้เปิดค้างเป็นเดือน
 * การรั่วของ handle หรือ thread แม้ครั้งละนิดจะสะสมจนล่มในที่สุด
 */
import { afterEach, describe, expect, test } from 'vitest';
import { ThaiIdCardWatcher } from '../src/pcsc/reader.ts';
import { delay } from '../src/pcsc/async-utils.ts';

const created: ThaiIdCardWatcher[] = [];

function makeWatcher(): ThaiIdCardWatcher {
  const watcher = new ThaiIdCardWatcher();
  created.push(watcher);
  return watcher;
}

afterEach(() => {
  for (const watcher of created.splice(0)) watcher.close();
});

describe('การเริ่มและหยุด', () => {
  test('เริ่มทำงานเองหลังสร้าง โดยไม่ต้องเรียก start', async () => {
    const watcher = makeWatcher();

    await delay(30);

    expect(watcher.running).toBe(true);
  });

  test('ผู้เรียกทันผูก listener ก่อน event started จะยิง', async () => {
    const watcher = makeWatcher();
    let startedSeen = false;
    watcher.on('started', () => {
      startedSeen = true;
    });

    await delay(30);

    expect(startedSeen).toBe(true);
  });

  /**
   * ถ้าปิดทันทีหลังสร้าง การเริ่มอัตโนมัติที่ถูกตั้งเวลาไว้ต้องไม่ปลุกมันขึ้นมาอีก
   * ไม่งั้นจะเหลือ pcsclite ที่ไม่มีใครถืออ้างอิงและไม่มีใครปิด
   */
  test('ปิดทันทีหลังสร้างแล้วต้องไม่ถูกปลุกขึ้นมาทำงานเองภายหลัง', async () => {
    const watcher = new ThaiIdCardWatcher();
    watcher.close();

    await delay(50);

    expect(watcher.running).toBe(false);
  });

  test('เรียก start ซ้ำไม่ทำให้เกิดตัวเชื่อมต่อซ้อน', async () => {
    const watcher = makeWatcher();
    await delay(30);
    let startedCount = 0;
    watcher.on('started', () => {
      startedCount += 1;
    });

    watcher.start();
    watcher.start();

    expect(startedCount).toBe(0);
    expect(watcher.running).toBe(true);
  });

  test('เรียก stop ซ้ำไม่ยิง event stopped ซ้ำ', async () => {
    const watcher = makeWatcher();
    await delay(30);
    let stoppedCount = 0;
    watcher.on('stopped', () => {
      stoppedCount += 1;
    });

    watcher.stop();
    watcher.stop();
    watcher.stop();

    expect(stoppedCount).toBe(1);
  });

  test('เรียก close ซ้ำไม่พัง', async () => {
    const watcher = makeWatcher();
    await delay(30);

    expect(() => {
      watcher.close();
      watcher.close();
    }).not.toThrow();
  });

  test('หยุดแล้วเริ่มใหม่ได้ สำหรับกรณีที่ต้องรีเซ็ตการเชื่อมต่อ', async () => {
    const watcher = makeWatcher();
    await delay(30);

    watcher.stop();
    expect(watcher.running).toBe(false);

    watcher.start();
    expect(watcher.running).toBe(true);
  });

  test('สร้างและปิดซ้ำ ๆ หลายรอบโดยไม่สะสมทรัพยากรค้าง', { timeout: 20_000 }, async () => {
    const before = process.getActiveResourcesInfo().length;

    for (let i = 0; i < 3; i += 1) {
      const watcher = new ThaiIdCardWatcher();
      await delay(50);
      watcher.close();
    }
    await delay(100);

    const after = process.getActiveResourcesInfo().length;
    expect(after).toBeLessThanOrEqual(before);
  });

  /**
   * บันทึกไว้เป็นเทสต์เพราะเป็นข้อจำกัดที่มีผลต่อการออกแบบระบบที่เอาไปใช้ต่อ
   *
   * pcsclite ต้องรอ thread เฝ้าดูสถานะจบก่อน จึงบล็อก event loop ราวหนึ่งวินาที
   * ระบบที่ต้องอ่านบัตรบ่อยจึงควรใช้ watcher ตัวเดียวยาว ๆ แทนการสร้างใหม่ทุกครั้ง
   */
  test('การปิดใช้เวลาราวหนึ่งวินาทีและบล็อก event loop', { timeout: 20_000 }, async () => {
    const watcher = new ThaiIdCardWatcher();
    await delay(50);

    const start = performance.now();
    watcher.close();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(5_000);
  });
});
