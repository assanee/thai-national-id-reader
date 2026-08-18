/**
 * ลำดับขั้นการอ่านบัตรประชาชนหนึ่งใบ
 *
 * รับ transmit เข้ามาแทนที่จะเรียก PC/SC เอง — ชั้นนี้จึงทดสอบได้เต็มรูปแบบด้วยบัตรจำลอง
 */

import {
  SELECT_THAI_ID_APPLET,
  buildGetResponse,
  isSuccessStatus,
  pendingResponseLength,
  readField,
  splitResponse,
  type CardProtocol,
  type Transmit,
} from './apdu.ts';
import { CorruptCardDataError, NotThaiIdCardError } from './errors.ts';
import { FIELDS, PERSON_LAYOUT, PHOTO, type FieldSpec } from './fields.ts';
import {
  decodeThaiText,
  isValidThaiCid,
  parseAddress,
  parseBuddhistDate,
  parseGender,
  parseName,
  type Gender,
} from './decode.ts';

export type ThaiIdCard = {
  cid: string;
  titleTH: string;
  firstNameTH: string;
  middleNameTH: string;
  lastNameTH: string;
  titleEN: string;
  firstNameEN: string;
  middleNameEN: string;
  lastNameEN: string;
  birthDate: string | null;
  gender: Gender;
  address: string | null;
  issuer: string | null;
  issueDate: string | null;
  expireDate: string | null;
  photo: Buffer | null;
};

export type ProgressInfo = {
  step: string;
  /** 0-100 คำนวณจากจำนวนคำสั่ง APDU ที่ยิงไปแล้วเทียบกับทั้งหมด */
  percent: number;
};

export type ReadOptions = {
  /** อ่านรูปถ่ายด้วยหรือไม่ — เพิ่มอีก 20 คำสั่ง APDU จึงปิดไว้เป็นค่าเริ่มต้น */
  includePhoto?: boolean;
  /** แจ้งความคืบหน้า เพื่อให้ผู้เรียกแสดงสถานะระหว่างอ่านรูปที่ใช้เวลานาน */
  onProgress?: (progress: ProgressInfo) => void;
};

/** จำนวนคำสั่งที่ต้องยิงเมื่อไม่อ่านรูป: select + cid + person + 4 ฟิลด์เสริม */
const STEPS_WITHOUT_PHOTO = 7;

export async function readThaiIdCard(
  transmit: Transmit,
  protocol: CardProtocol,
  options: ReadOptions = {},
): Promise<ThaiIdCard> {
  const { includePhoto = false, onProgress } = options;
  const report = createProgressReporter(
    STEPS_WITHOUT_PHOTO + (includePhoto ? PHOTO.chunkCount : 0),
    onProgress,
  );

  report('เลือกแอปพลิเคชันบนบัตร');
  await selectApplet(transmit);

  report('อ่านเลขประจำตัวประชาชน');
  const cid = decodeThaiText(await readField(transmit, FIELDS.cid.offset, FIELDS.cid.length, protocol));

  // หลักตรวจสอบของเลขบัตรเป็นสัญญาณเดียวที่จับได้ว่าคำตอบจากบัตรเลื่อนกัน
  // เพราะฟิลด์อื่นที่เพี้ยนยังคงดูมีรูปแบบถูกต้องจนแยกไม่ออก
  if (!isValidThaiCid(cid)) {
    throw new CorruptCardDataError(`เลขบัตร "${cid}" ไม่ผ่านหลักตรวจสอบ`);
  }

  report('อ่านชื่อและวันเกิด');
  const person = await readField(transmit, FIELDS.person.offset, FIELDS.person.length, protocol);
  const nameTH = parseName(slice(person, PERSON_LAYOUT.fullNameTH));
  const nameEN = parseName(slice(person, PERSON_LAYOUT.fullNameEN));

  // ต้องอ่านทีละฟิลด์ตามลำดับ ห้ามใช้ Promise.all — บัตรเป็นอุปกรณ์ serial ที่มี state machine เดียว
  // การยิงคำสั่งพร้อมกันจะทำให้ GET RESPONSE ของ T=0 ไปรับข้อมูลของฟิลด์อื่นสลับกัน
  report('อ่านที่อยู่');
  const address = await readOptional(transmit, FIELDS.address, protocol, parseAddress);
  report('อ่านหน่วยงานที่ออกบัตร');
  const issuer = await readOptional(transmit, FIELDS.issuer, protocol, (text) => text);
  report('อ่านวันออกบัตร');
  const issueDate = await readOptional(transmit, FIELDS.issueDate, protocol, parseBuddhistDate);
  report('อ่านวันหมดอายุ');
  const expireDate = await readOptional(transmit, FIELDS.expireDate, protocol, parseBuddhistDate);

  const photo = includePhoto ? await readPhoto(transmit, protocol, report) : null;

  return {
    cid,
    titleTH: nameTH.title,
    firstNameTH: nameTH.firstName,
    middleNameTH: nameTH.middleName,
    lastNameTH: nameTH.lastName,
    titleEN: nameEN.title,
    firstNameEN: nameEN.firstName,
    middleNameEN: nameEN.middleName,
    lastNameEN: nameEN.lastName,
    birthDate: parseBuddhistDate(slice(person, PERSON_LAYOUT.birthDate)),
    gender: parseGender(slice(person, PERSON_LAYOUT.gender)),
    address,
    issuer,
    issueDate,
    expireDate,
    photo,
  };
}

/**
 * เลือก applet ของบัตรประชาชน แล้วเคลียร์ข้อมูลที่บัตรค้างไว้ให้หมด
 *
 * บัตร T=0 ตอบ 0x61xx แปลว่า "สำเร็จ และมีข้อมูล xx ไบต์รออยู่"
 * ISO 7816-4 บังคับให้สั่ง GET RESPONSE มารับก่อนส่งคำสั่งถัดไป
 * ถ้าข้ามขั้นนี้ ข้อมูลที่ค้างจะไปโผล่ในคำตอบของคำสั่งถัดไปแล้วทำให้ทุกฟิลด์เลื่อนกันทั้งชุด
 */
async function selectApplet(transmit: Transmit): Promise<void> {
  const { statusWord } = splitResponse(await transmit(SELECT_THAI_ID_APPLET, 2));
  if (!isSuccessStatus(statusWord)) {
    throw new NotThaiIdCardError();
  }

  const pendingBytes = pendingResponseLength(statusWord);
  if (pendingBytes > 0) {
    await transmit(buildGetResponse(pendingBytes), pendingBytes + 2);
  }
}

function slice(person: Buffer, range: { start: number; end: number }): string {
  return decodeThaiText(person.subarray(range.start, range.end));
}

/**
 * อ่านฟิลด์ที่ไม่จำเป็นต้องมี — บัตรเก่าบางใบอ่านบางฟิลด์ไม่ได้
 * กรณีนั้นคืน null แทนที่จะทิ้งข้อมูลทั้งใบ
 */
async function readOptional<T>(
  transmit: Transmit,
  field: FieldSpec,
  protocol: CardProtocol,
  parse: (text: string) => T,
): Promise<T | null> {
  try {
    return parse(decodeThaiText(await readField(transmit, field.offset, field.length, protocol)));
  } catch {
    return null;
  }
}

/** นับคำสั่งที่ยิงไปแล้วเทียบกับทั้งหมด เพื่อให้ผู้เรียกแสดงแถบความคืบหน้าได้ */
function createProgressReporter(
  totalSteps: number,
  onProgress?: (progress: ProgressInfo) => void,
): (step: string) => void {
  let completed = 0;
  return (step) => {
    completed += 1;
    onProgress?.({ step, percent: Math.round((completed / totalSteps) * 100) });
  };
}

async function readPhoto(
  transmit: Transmit,
  protocol: CardProtocol,
  report: (step: string) => void,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];

  for (let index = 0; index < PHOTO.chunkCount; index += 1) {
    report(`อ่านรูปถ่าย ${index + 1}/${PHOTO.chunkCount}`);
    try {
      const offset = PHOTO.offset + index * PHOTO.chunkLength;
      chunks.push(await readField(transmit, offset, PHOTO.chunkLength, protocol));
    } catch {
      // ไฟล์ JPEG ที่ขาดกลางคันเปิดไม่ได้ การคืนของที่ใช้ไม่ได้แย่กว่าการบอกว่าไม่มีรูป
      return null;
    }
  }

  return Buffer.concat(chunks);
}
