/**
 * ชั้นล่างสุดที่คุยกับบัตรด้วยคำสั่ง APDU
 *
 * ไฟล์นี้ไม่รู้จัก PC/SC เลย — รับฟังก์ชัน transmit เข้ามาเป็นพารามิเตอร์
 * จึงสลับไปใช้ของจำลองในเทสต์ได้โดยไม่ต้องมีเครื่องอ่านบัตร
 */

import { ApduError } from './errors.ts';

/** สถานะ "สำเร็จ" ตามมาตรฐาน ISO 7816 */
export const SW_SUCCESS = 0x9000;

/** สถานะ 0x61xx แปลว่า "ยังมีข้อมูลรออยู่ ให้สั่ง GET RESPONSE มารับ" */
const SW_MORE_DATA_PREFIX = 0x61;

/**
 * บัตรถือว่าตอบสำเร็จเมื่อได้ 0x9000 หรือ 0x61xx
 *
 * บัตร T=0 ตอบ 0x61xx เป็นเรื่องปกติ ไม่ใช่ข้อผิดพลาด — ยืนยันจากบัตรจริงที่ตอบ
 * SELECT ด้วย 0x610A ตรรกะนี้ต้องอยู่ที่เดียวเท่านั้น ไม่งั้นผู้เรียกแต่ละที่จะตัดสินไม่ตรงกัน
 */
export function isSuccessStatus(statusWord: number): boolean {
  return statusWord === SW_SUCCESS || statusWord >> 8 === SW_MORE_DATA_PREFIX;
}

/**
 * จำนวนไบต์ที่บัตรค้างไว้รอให้ไปรับ อ่านจากไบต์ท้ายของ 0x61xx
 * คืน 0 เมื่อไม่มีข้อมูลค้าง
 */
export function pendingResponseLength(statusWord: number): number {
  return statusWord >> 8 === SW_MORE_DATA_PREFIX ? statusWord & 0xff : 0;
}

export type CardProtocol = 'T=0' | 'T=1';

/** ส่ง APDU ไปยังบัตรแล้วคืนคำตอบดิบ (ข้อมูล + status word สองไบต์ท้าย) */
export type Transmit = (command: Buffer, expectedLength: number) => Promise<Buffer>;

/** เลือก applet ของบัตรประชาชนไทย ต้องสั่งก่อนอ่านฟิลด์ใด ๆ เสมอ */
export const SELECT_THAI_ID_APPLET = Buffer.from([
  0x00, 0xa4, 0x04, 0x00, 0x08, 0xa0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01,
]);

/**
 * offset ใน APDU มีแค่ 2 ไบต์ และความยาวมีแค่ 1 ไบต์
 *
 * ถ้าไม่ตรวจ ค่าที่เกินจะถูก & 0xff ตัดทิ้งเงียบ ๆ แล้วไปอ่านผิดตำแหน่ง
 * ซึ่งอันตรายกว่าการพังทันที เพราะได้ข้อมูลผิดกลับมาโดยไม่มีสัญญาณเตือน
 */
function assertOffset(offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff) {
    throw new ApduError(`offset ${offset} อยู่นอกช่วงที่ APDU รองรับ (0 ถึง 65535)`);
  }
}

function assertLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > 0xff) {
    throw new ApduError(`ความยาว ${length} อยู่นอกช่วงที่ APDU รองรับ (1 ถึง 255)`);
  }
}

export function buildReadCommand(offset: number, length: number): Buffer {
  assertOffset(offset);
  assertLength(length);
  return Buffer.from([0x80, 0xb0, (offset >> 8) & 0xff, offset & 0xff, 0x02, 0x00, length]);
}

export function buildGetResponse(length: number): Buffer {
  assertLength(length);
  return Buffer.from([0x00, 0xc0, 0x00, 0x00, length]);
}

export function splitResponse(response: Buffer): { data: Buffer; statusWord: number } {
  if (response.length < 2) {
    throw new ApduError(`คำตอบจากบัตรสั้นเกินไป (${response.length} ไบต์)`);
  }
  return {
    data: response.subarray(0, response.length - 2),
    statusWord: response.readUInt16BE(response.length - 2),
  };
}

/**
 * อ่านหนึ่งฟิลด์จากบัตร โดยจัดการความต่างของโปรโตคอลให้เรียบร้อย
 *
 * T=0 บัตรจะตอบ 0x61xx ก่อน แล้วต้องสั่ง GET RESPONSE อีกครั้งจึงได้ข้อมูล
 * T=1 บัตรส่งข้อมูลกลับมาพร้อมกันในครั้งเดียว
 */
export async function readField(
  transmit: Transmit,
  offset: number,
  length: number,
  protocol: CardProtocol,
): Promise<Buffer> {
  const command = buildReadCommand(offset, length);

  if (protocol === 'T=1') {
    const { data, statusWord } = splitResponse(await transmit(command, length + 2));
    assertSuccess(statusWord, offset);
    return assertComplete(data, length, offset);
  }

  const first = splitResponse(await transmit(command, length + 2));
  if (!isSuccessStatus(first.statusWord)) {
    throw new ApduError(`อ่านข้อมูลที่ offset 0x${offset.toString(16)} ไม่สำเร็จ`, first.statusWord);
  }

  const { data, statusWord } = splitResponse(await transmit(buildGetResponse(length), length + 2));
  assertSuccess(statusWord, offset);
  return assertComplete(data, length, offset);
}

/**
 * บัตรต้องคืนข้อมูลครบตามจำนวนที่ขอ
 *
 * ถ้าได้ไม่ครบแปลว่าคำตอบเพี้ยน เช่นข้อมูลค้างจากคำสั่งก่อนหน้าหรือบัตรหลุดกลางคัน
 * การยอมรับข้อมูลบางส่วนจะทำให้ฟิลด์ถัดไปเลื่อนตามกันทั้งชุดโดยไม่มีใครรู้
 */
function assertComplete(data: Buffer, expected: number, offset: number): Buffer {
  if (data.length !== expected) {
    throw new ApduError(
      `บัตรคืนข้อมูลที่ offset 0x${offset.toString(16)} มา ${data.length} ไบต์ แต่ขอไป ${expected} ไบต์`,
    );
  }
  return data;
}

function assertSuccess(statusWord: number, offset: number): void {
  if (statusWord !== SW_SUCCESS) {
    throw new ApduError(`อ่านข้อมูลที่ offset 0x${offset.toString(16)} ไม่สำเร็จ`, statusWord);
  }
}
