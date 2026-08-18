/**
 * ชั้นเชื่อมกับฮาร์ดแวร์ผ่าน PC/SC
 *
 * หน้าที่เดียวคือแปลง event ของ pcsclite ให้เป็น event ของโดเมนเรา
 * แล้วส่ง transmit ต่อให้ชั้นอ่านบัตรใน card/ ซึ่งทดสอบได้โดยไม่ต้องมีเครื่องอ่าน
 *
 * ออกแบบให้ทำงานค้างไว้ตลอด: ไม่ว่าจะเกิดข้อผิดพลาดอะไร ตัวเฝ้ารอต้องกลับไป
 * รอบัตรใบถัดไปเสมอ ไม่หยุดทำงานและไม่ค้าง
 */

import { EventEmitter } from 'node:events';
import pcsclite from '@pokusew/pcsclite';
import type { CardProtocol, Transmit } from '../card/apdu.ts';
import {
  CardRemovedError,
  CorruptCardDataError,
  NoReaderError,
  NotThaiIdCardError,
} from '../card/errors.ts';
import {
  readThaiIdCard,
  type ProgressInfo,
  type ReadOptions,
  type ThaiIdCard,
} from '../card/thai-id.ts';
import { interpretStatusChange } from './card-state.ts';
import { TimeoutError, withRetry, withTimeout } from './async-utils.ts';

/** pcsclite ไม่ได้ export ชนิด CardReader ออกมา จึงดึงจาก signature ของ event 'reader' แทน */
type CardReader = Parameters<Parameters<ReturnType<typeof pcsclite>['on']>[1]>[0];

export type ReadErrorReason =
  | 'not-thai-id'
  | 'card-removed'
  | 'card-unresponsive'
  | 'corrupt-data'
  | 'timeout'
  | 'unknown';

export type WatcherEvents = {
  /** เริ่มเฝ้ารอแล้ว */
  started: [];
  /** หยุดเฝ้ารอแล้ว */
  stopped: [];
  /** เสียบเครื่องอ่านเข้ากับ USB หรือพบเครื่องอ่านที่เสียบอยู่แล้วตอนเริ่ม */
  'reader-connected': [readerName: string];
  /** ถอดเครื่องอ่านออกจาก USB */
  'reader-disconnected': [readerName: string];
  /** เสียบบัตรเข้าเครื่องอ่าน (ยังไม่เริ่มอ่าน) */
  'card-inserted': [info: { readerName: string; atr: Buffer | null }];
  /** ถอดบัตรออกจากเครื่องอ่าน */
  'card-removed': [info: { readerName: string }];
  /** เริ่มอ่านข้อมูลจากบัตร */
  reading: [info: { readerName: string }];
  /** ความคืบหน้าระหว่างอ่าน */
  progress: [progress: ProgressInfo];
  /** อ่านบัตรสำเร็จ */
  card: [card: ThaiIdCard];
  /** อ่านบัตรไม่สำเร็จ — willRetry บอกว่ากำลังจะลองใหม่หรือยอมแพ้แล้ว */
  'read-error': [
    error: Error,
    info: { reason: ReadErrorReason; attempt: number; willRetry: boolean },
  ];
  /** ข้อผิดพลาดระดับระบบ PC/SC ที่ไม่เกี่ยวกับการอ่านบัตรใบใดใบหนึ่ง */
  error: [error: Error];
};

export type WatcherOptions = ReadOptions & {
  /** เวลารอสูงสุดต่อหนึ่งคำสั่งที่คุยกับบัตร ป้องกันการค้างถาวร */
  operationTimeoutMs?: number;
  /** จำนวนครั้งที่ลองอ่านใหม่เมื่อเจอบัตรไม่ตอบสนอง */
  retryAttempts?: number;
  retryDelayMs?: number;
};

const DEFAULTS = {
  operationTimeoutMs: 10_000,
  retryAttempts: 3,
  retryDelayMs: 800,
};

export class ThaiIdCardWatcher extends EventEmitter<WatcherEvents> {
  #pcsc: ReturnType<typeof pcsclite> | null = null;
  readonly #options: WatcherOptions & typeof DEFAULTS;
  /** กันการอ่านซ้อน — บัตรอาจส่ง status event ซ้ำระหว่างที่ยังอ่านรอบก่อนไม่เสร็จ */
  #busy = false;
  #running = false;
  /** ปิดถาวรแล้ว — กันการเริ่มอัตโนมัติที่ตั้งเวลาไว้ปลุกขึ้นมาหลังผู้ใช้สั่งปิดไปแล้ว */
  #disposed = false;

  constructor(options: WatcherOptions = {}) {
    super();
    this.#options = { ...DEFAULTS, ...options };
    // เริ่มใน tick ถัดไป เพื่อให้ผู้เรียกทันผูก listener ก่อน event แรกจะยิง
    // ห้าม unref ตัวนี้ — โหมดเฝ้ารอต้องอาศัยมันค้าง event loop ไว้
    // ไม่งั้นโปรแกรมที่ไม่มีงานอื่นจะจบทันทีก่อนได้เริ่มทำงานด้วยซ้ำ
    this.#autoStart = setImmediate(() => this.start());
  }

  #autoStart: ReturnType<typeof setImmediate> | null = null;

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running || this.#disposed) return;
    this.#running = true;

    const pcsc = pcsclite();
    this.#pcsc = pcsc;
    pcsc.on('error', (error) => this.emit('error', toError(error)));
    pcsc.on('reader', (reader) => this.#attachReader(reader));

    this.emit('started');
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#pcsc?.close();
    this.#pcsc = null;
    this.emit('stopped');
  }

  /** เลิกใช้แล้วปล่อยทรัพยากรทั้งหมด เรียกซ้ำได้ และเรียกก่อนเริ่มทำงานก็ได้ */
  close(): void {
    this.#disposed = true;
    if (this.#autoStart) {
      clearImmediate(this.#autoStart);
      this.#autoStart = null;
    }
    this.stop();
    this.removeAllListeners();
  }

  #attachReader(reader: CardReader): void {
    this.emit('reader-connected', reader.name);

    reader.on('error', (error) => this.emit('error', toError(error)));
    reader.on('end', () => this.emit('reader-disconnected', reader.name));

    reader.on('status', (status) => {
      // reader.state เป็น undefined ใน event แรกเสมอ เพราะ pcsclite ตั้งค่าหลังยิง event
      const change = interpretStatusChange(reader.state, status.state);

      if (change === 'removed') {
        this.emit('card-removed', { readerName: reader.name });
        return;
      }

      if (change === 'inserted') {
        this.emit('card-inserted', { readerName: reader.name, atr: status.atr ?? null });
        if (!this.#busy) void this.#handleCard(reader);
      }
    });
  }

  async #handleCard(reader: CardReader): Promise<void> {
    this.#busy = true;
    this.emit('reading', { readerName: reader.name });

    try {
      const card = await withRetry(() => this.#readOnce(reader), {
        attempts: this.#options.retryAttempts,
        delayMs: this.#options.retryDelayMs,
        shouldRetry: (error) => isRecoverable(error),
        onRetry: async (error, attempt) => {
          this.emit('read-error', toError(error), {
            reason: classifyError(error),
            attempt,
            willRetry: true,
          });
          await this.#resetCard(reader);
        },
      });
      this.emit('card', card);
    } catch (error) {
      this.emit('read-error', toError(error), {
        reason: classifyError(error),
        attempt: this.#options.retryAttempts,
        willRetry: false,
      });
    } finally {
      this.#busy = false;
    }
  }

  async #readOnce(reader: CardReader): Promise<ThaiIdCard> {
    const { operationTimeoutMs } = this.#options;
    const protocol = await withTimeout(connect(reader), operationTimeoutMs, 'เชื่อมต่อบัตร');

    try {
      const transmit: Transmit = (command, expectedLength) =>
        withTimeout(
          rawTransmit(reader, protocol, command, expectedLength),
          operationTimeoutMs,
          'ส่งคำสั่งไปยังบัตร',
        );

      return await readThaiIdCard(transmit, toCardProtocol(protocol), {
        includePhoto: this.#options.includePhoto,
        onProgress: (progress) => this.emit('progress', progress),
      });
    } finally {
      await disconnect(reader, reader.SCARD_LEAVE_CARD);
    }
  }

  /**
   * ปลุกบัตรที่ไม่ตอบสนองด้วยการตัดไฟแล้วจ่ายใหม่
   *
   * ต่อแบบ DIRECT ได้แม้บัตรไม่ตอบสนอง เพราะเป็นการคุยกับตัวเครื่องอ่านไม่ใช่ตัวบัตร
   * จากนั้นสั่ง reset ตอนตัดการเชื่อมต่อ
   */
  async #resetCard(reader: CardReader): Promise<void> {
    try {
      await withTimeout(
        connect(reader, reader.SCARD_SHARE_DIRECT),
        this.#options.operationTimeoutMs,
        'รีเซ็ตบัตร',
      );
      await disconnect(reader, reader.SCARD_RESET_CARD);
    } catch {
      // ปลุกไม่สำเร็จก็ไม่เป็นไร ให้รอบถัดไปของ withRetry จัดการต่อ
    }
  }
}

function connect(reader: CardReader, shareMode?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    reader.connect({ share_mode: shareMode ?? reader.SCARD_SHARE_SHARED }, (error, protocol) => {
      if (error) reject(toError(error));
      else resolve(protocol);
    });
  });
}

function rawTransmit(
  reader: CardReader,
  protocol: number,
  command: Buffer,
  expectedLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    reader.transmit(command, expectedLength, protocol, (error, response) => {
      if (error) reject(isRemovedError(error) ? new CardRemovedError() : toError(error));
      else resolve(response);
    });
  });
}

function disconnect(reader: CardReader, disposition: number): Promise<void> {
  return new Promise((resolve) => {
    // ความล้มเหลวตอนตัดการเชื่อมต่อไม่ควรกลบข้อผิดพลาดจริงที่เกิดระหว่างอ่าน
    reader.disconnect(disposition, () => resolve());
  });
}

function toCardProtocol(protocol: number): CardProtocol {
  return protocol === 2 ? 'T=1' : 'T=0';
}

export function classifyError(error: unknown): ReadErrorReason {
  if (error instanceof NotThaiIdCardError) return 'not-thai-id';
  if (error instanceof CardRemovedError) return 'card-removed';
  if (error instanceof CorruptCardDataError) return 'corrupt-data';
  if (error instanceof TimeoutError) return 'timeout';
  if (isUnresponsiveError(error)) return 'card-unresponsive';
  return 'unknown';
}

/**
 * ลองใหม่ได้เฉพาะเมื่องานก่อนหน้าจบไปแล้วจริง
 *
 * 0x80100066 คือข้อผิดพลาดที่บัตรตอบกลับมา แปลว่าคำสั่งเดิมจบแล้ว handle ว่าง ลองใหม่ได้ปลอดภัย
 *
 * ส่วน timeout ห้ามลองใหม่เด็ดขาด เพราะ withTimeout แค่เลิกรอ ไม่ได้ยกเลิก SCardConnect
 * ที่ยังค้างและถือ handle อยู่ฝั่ง native การยิง connect ตัวใหม่ซ้อนเข้าไปจะทำให้ slot
 * ของ PC/SC พังทั้งตัวจนต้องถอดสาย USB ถึงจะฟื้น (เจอจริงระหว่างพัฒนา)
 */
export function isRecoverable(error: unknown): boolean {
  const reason = classifyError(error);
  return reason === 'card-unresponsive' || reason === 'corrupt-data';
}

function isUnresponsiveError(error: unknown): boolean {
  return /unresponsive|0x80100066/i.test(messageOf(error));
}

function isRemovedError(error: unknown): boolean {
  return /removed|SCARD_W_REMOVED_CARD|0x80100069/i.test(messageOf(error));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * รอบัตรหนึ่งใบ อ่านข้อมูล แล้วหยุด
 * เหมาะกับการเรียกใช้แบบครั้งเดียวจบ เช่นจาก endpoint ของเซิร์ฟเวอร์
 */
export function readCardOnce(
  options: WatcherOptions & { timeoutMs?: number } = {},
): Promise<ThaiIdCard> {
  const { timeoutMs = 60_000, ...watcherOptions } = options;

  return new Promise((resolve, reject) => {
    const watcher = new ThaiIdCardWatcher(watcherOptions);
    let readerName: string | null = null;

    const finish = (settle: () => void) => {
      clearTimeout(timer);
      watcher.close();
      settle();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          readerName === null
            ? new NoReaderError()
            : new Error(`หมดเวลารอบัตร — พบเครื่องอ่าน "${readerName}" แล้วแต่ยังไม่มีบัตรเสียบ`),
        ),
      );
    }, timeoutMs);

    watcher.on('reader-connected', (name) => {
      readerName = name;
    });
    watcher.on('progress', (progress) => watcherOptions.onProgress?.(progress));
    watcher.on('card', (card) => finish(() => resolve(card)));
    watcher.on('read-error', (error, info) => {
      if (!info.willRetry) finish(() => reject(error));
    });
    watcher.on('error', (error) => finish(() => reject(error)));
  });
}
