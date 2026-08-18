/**
 * อ่านบัตรประชาชนไทยผ่านเครื่องอ่านสมาร์ทการ์ด PC/SC
 *
 * เฝ้ารอบัตรตลอดเวลา (แนะนำ):
 *   const watcher = new ThaiIdCardWatcher({ includePhoto: true })
 *   watcher.on('card', console.log)
 *
 * อ่านครั้งเดียวจบ:
 *   const card = await readCardOnce({ includePhoto: true })
 */

export { ThaiIdCardWatcher, readCardOnce, classifyError, isRecoverable } from './pcsc/reader.ts';
export type { WatcherEvents, WatcherOptions, ReadErrorReason } from './pcsc/reader.ts';

export { readThaiIdCard } from './card/thai-id.ts';
export type { ThaiIdCard, ReadOptions, ProgressInfo } from './card/thai-id.ts';

export { interpretStatusChange, STATE } from './pcsc/card-state.ts';
export { TimeoutError } from './pcsc/async-utils.ts';

export type { CardProtocol, Transmit } from './card/apdu.ts';
export type { Gender } from './card/decode.ts';
export { isValidThaiCid } from './card/decode.ts';
export {
  ThaiIdError,
  ApduError,
  NotThaiIdCardError,
  CardRemovedError,
  CorruptCardDataError,
  NoReaderError,
} from './card/errors.ts';
export { FIELDS, PHOTO } from './card/fields.ts';
