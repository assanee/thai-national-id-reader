import { describe, expect, test } from 'vitest';
import { readThaiIdCard } from '../src/card/thai-id.ts';
import { NotThaiIdCardError } from '../src/card/errors.ts';
import { FIELDS } from '../src/card/fields.ts';
import { createFakeCard } from './fake-card.ts';

describe('readThaiIdCard', () => {
  test('อ่านข้อมูลครบทุกฟิลด์จากบัตร T=0', async () => {
    const { transmit } = createFakeCard({ protocol: 'T=0' });

    const card = await readThaiIdCard(transmit, 'T=0');

    expect(card).toMatchObject({
      cid: '1234567890121',
      titleTH: 'นาย',
      firstNameTH: 'สมชาย',
      lastNameTH: 'ใจดี',
      titleEN: 'Mr.',
      firstNameEN: 'Somchai',
      lastNameEN: 'Jaidee',
      birthDate: '1987-12-31',
      gender: 'male',
      issuer: 'สำนักงานเขตคลองเตย',
      issueDate: '2017-01-15',
      expireDate: '2027-01-14',
      address: '99/1 ซอยสุขุมวิท 5 ถนนสุขุมวิท ตำบลคลองเตย อำเภอคลองเตย จังหวัดกรุงเทพมหานคร',
    });
  });

  test('บัตร T=1 ให้ผลลัพธ์เหมือนบัตร T=0 ทุกประการ', async () => {
    const t0 = await readThaiIdCard(createFakeCard({ protocol: 'T=0' }).transmit, 'T=0');
    const t1 = await readThaiIdCard(createFakeCard({ protocol: 'T=1' }).transmit, 'T=1');

    expect(t1).toEqual(t0);
  });

  test('โยน NotThaiIdCardError เมื่อเลือก applet ไม่สำเร็จ', async () => {
    const { transmit } = createFakeCard({ protocol: 'T=0', selectFails: true });

    await expect(readThaiIdCard(transmit, 'T=0')).rejects.toThrow(NotThaiIdCardError);
  });

  test('ไม่ยิงคำสั่งอ่านรูปเลยเมื่อไม่ได้ขอรูป', async () => {
    const { transmit, commands } = createFakeCard({ protocol: 'T=1' });

    const card = await readThaiIdCard(transmit, 'T=1');

    expect(card.photo).toBeNull();
    const photoReads = commands.filter((c) => c[0] === 0x80 && c.readUInt16BE(2) === 0x017b);
    expect(photoReads).toHaveLength(0);
  });

  test('ประกอบรูปถ่าย JPEG จากหลายบล็อกเมื่อขอรูป', async () => {
    const { transmit, photo } = createFakeCard({ protocol: 'T=1' });

    const card = await readThaiIdCard(transmit, 'T=1', { includePhoto: true });

    expect(card.photo).toEqual(photo);
    expect(card.photo?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  test('ฟิลด์ที่อ่านไม่ได้กลายเป็น null โดยฟิลด์อื่นยังอ่านได้ตามปกติ', async () => {
    const { transmit } = createFakeCard({
      protocol: 'T=1',
      failOffsets: [FIELDS.address.offset],
    });

    const card = await readThaiIdCard(transmit, 'T=1');

    expect(card.address).toBeNull();
    expect(card.cid).toBe('1234567890121');
    expect(card.firstNameTH).toBe('สมชาย');
  });

  /**
   * ISO 7816-4 กำหนดว่าเมื่อบัตรตอบ 61xx ต้องสั่ง GET RESPONSE เคลียร์ข้อมูลค้างก่อนส่งคำสั่งถัดไป
   * ไม่งั้นข้อมูลที่ค้างจะไปโผล่ในคำตอบของคำสั่งถัดไป ทำให้ทุกฟิลด์เลื่อนกันทั้งชุด
   * อาการที่เจอกับบัตรจริง: เลขบัตรว่าง ชื่อว่าง และวันออกบัตรเท่ากับวันหมดอายุ
   */
  test('เคลียร์ข้อมูลค้างด้วย GET RESPONSE ทันทีหลัง SELECT ที่ตอบ 61xx', async () => {
    const { transmit, commands } = createFakeCard({ protocol: 'T=0' });

    await readThaiIdCard(transmit, 'T=0');

    const selectIndex = commands.findIndex((c) => c[0] === 0x00 && c[1] === 0xa4);
    const next = commands[selectIndex + 1];

    expect(next?.[0]).toBe(0x00);
    expect(next?.[1]).toBe(0xc0);
    expect(next?.[4]).toBe(0x0a);
  });

  test('ไม่สั่ง GET RESPONSE เกินจำเป็นเมื่อบัตร T=1 ตอบ SELECT สำเร็จทันที', async () => {
    const { transmit, commands } = createFakeCard({ protocol: 'T=1' });

    await readThaiIdCard(transmit, 'T=1');

    const selectIndex = commands.findIndex((c) => c[0] === 0x00 && c[1] === 0xa4);
    expect(commands[selectIndex + 1]?.[1]).not.toBe(0xc0);
  });

  test('อ่านชื่อทั้งไทยและอังกฤษด้วยคำสั่งเดียว แทนที่จะยิงทีละฟิลด์', async () => {
    const { transmit, commands } = createFakeCard({ protocol: 'T=1' });

    await readThaiIdCard(transmit, 'T=1');

    const personReads = commands.filter((c) => c[0] === 0x80 && c.readUInt16BE(2) === FIELDS.person.offset);
    expect(personReads).toHaveLength(1);
  });
});
