import { SELECT_THAI_ID_APPLET, type CardProtocol, type Transmit } from '../src/card/apdu.ts';
import { fixedField } from './helpers.ts';

/**
 * บัตรประชาชนจำลองสำหรับเทสต์
 *
 * บัตรจริงคือหน่วยความจำแบนก้อนเดียวที่อ่านด้วย offset — ของจำลองจึงใช้ Buffer ก้อนเดียว
 * แล้วเขียนแต่ละฟิลด์ลงไปตาม offset จริง ทำให้ทดสอบตาราง offset ไปพร้อมกันในตัว
 */

const MEMORY_SIZE = 0x15dd;
const PHOTO_OFFSET = 0x017b;
const PHOTO_SIZE = 20 * 0xff;

export type FakeCardOptions = {
  protocol: CardProtocol;
  /** จำลองบัตรชนิดอื่นที่เลือก applet ของบัตรประชาชนไม่ได้ */
  selectFails?: boolean;
  /** จำลองฟิลด์ที่อ่านไม่ได้ เพื่อทดสอบว่าฟิลด์อื่นยังอ่านต่อได้ */
  failOffsets?: number[];
  /** เลขบัตร ค่าเริ่มต้นเป็นเลขสมมติที่หลักตรวจสอบถูกต้อง */
  cid?: string;
};

export function createFakeCard(options: FakeCardOptions) {
  const { protocol, selectFails = false, failOffsets = [], cid = '1234567890121' } = options;

  const memory = Buffer.alloc(MEMORY_SIZE, 0x20);
  memory.write(cid, 0x0004, 'ascii');
  fixedField('นาย#สมชาย##ใจดี', 100).copy(memory, 0x0011);
  fixedField('Mr.#Somchai##Jaidee', 100).copy(memory, 0x0075);
  memory.write('25301231', 0x00d9, 'ascii');
  memory.write('1', 0x00e1, 'ascii');
  fixedField('สำนักงานเขตคลองเตย', 100).copy(memory, 0x00f6);
  memory.write('25600115', 0x0167, 'ascii');
  memory.write('25700114', 0x016f, 'ascii');
  fixedField('99/1###ซอยสุขุมวิท 5#ถนนสุขุมวิท#ตำบลคลองเตย#อำเภอคลองเตย#จังหวัดกรุงเทพมหานคร', 100)
    .copy(memory, 0x1579);

  // รูปถ่ายจำลอง: ขึ้นต้นด้วย magic number ของ JPEG เหมือนของจริง
  const photo = Buffer.alloc(PHOTO_SIZE, 0x5a);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(photo, 0);
  photo.copy(memory, PHOTO_OFFSET);

  const commands: Buffer[] = [];
  let pending = Buffer.alloc(0);

  const statusWord = (sw: number) => Buffer.from([(sw >> 8) & 0xff, sw & 0xff]);

  const transmit: Transmit = async (command) => {
    commands.push(Buffer.from(command));

    if (command.equals(SELECT_THAI_ID_APPLET)) {
      if (selectFails) return statusWord(0x6a82);
      // บัตรจริงแบบ T=0 ตอบ 0x610A ("สำเร็จ มีข้อมูล 10 ไบต์รออยู่") ไม่ใช่ 0x9000
      // ยืนยันจาก ACR39U-NF กับบัตรจริง ATR 3B7996 00FF "TH NID 15"
      if (protocol === 'T=1') return statusWord(0x9000);
      pending = Buffer.alloc(0x0a, 0xff); // ข้อมูล FCI ที่บัตรค้างไว้ให้มารับ
      return statusWord(0x610a);
    }

    // คำสั่งอ่านข้อมูล: 80 B0 <offset> 02 00 <len>
    if (command[0] === 0x80 && command[1] === 0xb0) {
      const offset = command.readUInt16BE(2);
      const length = command[6] ?? 0;
      if (failOffsets.includes(offset)) return statusWord(0x6a83);

      const data = memory.subarray(offset, offset + length);
      if (protocol === 'T=1') return Buffer.concat([data, statusWord(0x9000)]);

      pending = data;
      return statusWord(0x6100 | length);
    }

    // GET RESPONSE: 00 C0 00 00 <len>
    if (command[0] === 0x00 && command[1] === 0xc0) {
      return Buffer.concat([pending, statusWord(0x9000)]);
    }

    throw new Error(`บัตรจำลองไม่รู้จักคำสั่ง ${command.toString('hex')}`);
  };

  return { transmit, commands, photo };
}
