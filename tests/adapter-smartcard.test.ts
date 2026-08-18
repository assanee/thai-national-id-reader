/**
 * พิสูจน์ว่าตรรกะการอ่านบัตรเสียบเข้ากับชั้นฮาร์ดแวร์ของไลบรารีอื่นได้จริง
 *
 * โปรเจกต์ที่ใช้ `smartcard` อยู่แล้ว (เช่น Electron app ที่ native module ถูก
 * rebuild ไว้เรียบร้อย) ไม่จำเป็นต้องเปลี่ยน native layer เพียงเขียน adapter
 * แปลง API ของมันให้เป็นฟังก์ชัน transmit ที่ readThaiIdCard ต้องการ
 */
import { describe, expect, test, vi } from 'vitest';
import { readThaiIdCard, type Transmit } from '../src/card/index.ts';
import { createFakeCard } from './fake-card.ts';

/**
 * จำลอง API ของ smartcard: card.issueCommand(new CommandApdu({ bytes }))
 * ซึ่งรับ array ของไบต์ และคืน array ของไบต์กลับมา (ไม่ใช่ Buffer)
 */
function createSmartcardLikeCard(protocol: 'T=0' | 'T=1') {
  const fake = createFakeCard({ protocol });
  return {
    issueCommand: vi.fn(async (command: { bytes: number[] }) => {
      const response = await fake.transmit(Buffer.from(command.bytes), 0);
      return [...response];
    }),
  };
}

/** adapter ที่ผู้ใช้ต้องเขียนเอง — สั้นแค่นี้จริง ๆ */
function createTransmit(card: { issueCommand: (c: { bytes: number[] }) => Promise<number[]> }): Transmit {
  return async (command) => Buffer.from(await card.issueCommand({ bytes: [...command] }));
}

describe('เสียบตรรกะการอ่านบัตรเข้ากับชั้นฮาร์ดแวร์ของไลบรารีอื่น', () => {
  test('อ่านบัตร T=0 ผ่าน adapter ได้ผลเหมือนใช้ชั้นฮาร์ดแวร์ของเราเอง', async () => {
    const card = createSmartcardLikeCard('T=0');

    const result = await readThaiIdCard(createTransmit(card), 'T=0');

    expect(result).toMatchObject({
      cid: '1234567890121',
      titleTH: 'นาย',
      firstNameTH: 'สมชาย',
      lastNameTH: 'ใจดี',
      birthDate: '1987-12-31',
      gender: 'male',
      issueDate: '2017-01-15',
      expireDate: '2027-01-14',
    });
  });

  test('อ่านรูปถ่ายผ่าน adapter ได้ครบและเป็น JPEG ที่ถูกต้อง', async () => {
    const card = createSmartcardLikeCard('T=0');

    const result = await readThaiIdCard(createTransmit(card), 'T=0', { includePhoto: true });

    expect(result.photo).not.toBeNull();
    expect(result.photo?.length).toBe(20 * 255);
    expect(result.photo?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  test('adapter ไม่ต้องรู้เรื่องโปรโตคอล — ตรรกะเดิมจัดการ GET RESPONSE ให้เอง', async () => {
    const card = createSmartcardLikeCard('T=0');

    await readThaiIdCard(createTransmit(card), 'T=0');

    const sent = card.issueCommand.mock.calls.map((c) => c[0].bytes);
    const getResponses = sent.filter((b) => b[0] === 0x00 && b[1] === 0xc0);
    expect(getResponses.length).toBeGreaterThan(0);
  });
});
