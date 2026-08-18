/**
 * ตรรกะการอ่านบัตรล้วน ๆ โดยไม่พึ่ง PC/SC หรือ native module ใด ๆ
 *
 * ใช้ทางเข้านี้เมื่อคุณมีชั้นเชื่อมต่อฮาร์ดแวร์ของตัวเองอยู่แล้ว เช่นแอป Electron
 * ที่ใช้ไลบรารีอื่นอยู่ หรือระบบที่รับ APDU ผ่านเครือข่าย
 *
 *   import { readThaiIdCard } from 'thai-national-id-reader/card'
 *
 *   const card = await readThaiIdCard(
 *     (command, expectedLength) => myTransport.send(command, expectedLength),
 *     'T=0',
 *   )
 *
 * ต่างจากทางเข้าหลัก (`thai-national-id-reader`) ตรงที่ไม่มี ThaiIdCardWatcher
 * และไม่ import `@pokusew/pcsclite` จึงไม่ต้อง rebuild native module ตามเวอร์ชัน Electron
 */

export { readThaiIdCard } from './thai-id.ts';
export type { ThaiIdCard, ReadOptions, ProgressInfo } from './thai-id.ts';

export {
  SELECT_THAI_ID_APPLET,
  buildGetResponse,
  buildReadCommand,
  isSuccessStatus,
  pendingResponseLength,
  readField,
  splitResponse,
  SW_SUCCESS,
} from './apdu.ts';
export type { CardProtocol, Transmit } from './apdu.ts';

export {
  decodeThaiText,
  isValidThaiCid,
  parseAddress,
  parseBuddhistDate,
  parseGender,
  parseName,
} from './decode.ts';
export type { Gender, ParsedName } from './decode.ts';

export { FIELDS, PERSON_LAYOUT, PHOTO } from './fields.ts';
export type { FieldSpec } from './fields.ts';

export {
  ThaiIdError,
  ApduError,
  NotThaiIdCardError,
  CardRemovedError,
  CorruptCardDataError,
  NoReaderError,
} from './errors.ts';
