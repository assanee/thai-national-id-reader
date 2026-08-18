/**
 * เครื่องมือ async ที่ทำให้ตัวเฝ้ารอทำงานได้ต่อเนื่องโดยไม่ค้าง
 *
 * แยกออกมาเพราะเป็นตรรกะบริสุทธิ์ ทดสอบได้โดยไม่ต้องมีฮาร์ดแวร์
 */

export class TimeoutError extends Error {
  constructor(task: string, ms: number) {
    super(`${task} ไม่ตอบสนองภายใน ${ms} มิลลิวินาที`);
    this.name = 'TimeoutError';
  }
}

/**
 * จำกัดเวลารองานที่อาจไม่เรียก callback กลับมาเลย
 *
 * จำเป็นเพราะพบว่า SCardConnect ค้างถาวรได้เมื่อบัตรอยู่ในสถานะไม่ตอบสนอง
 * ถ้าไม่มีตัวจับเวลา ตัวเฝ้ารอจะแข็งค้างและต้องรีสตาร์ตเท่านั้นจึงจะฟื้น
 */
export function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type RetryOptions = {
  attempts: number;
  delayMs?: number;
  /** คืน false เพื่อยอมแพ้ทันทีโดยไม่ลองใหม่ เช่นเมื่อรู้แน่ว่าไม่ใช่บัตรประชาชน */
  shouldRetry?: (error: unknown) => boolean;
  /** เรียกก่อนลองใหม่ทุกครั้ง ใช้เคลียร์สถานะ เช่นสั่งรีเซ็ตบัตร */
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
};

export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, delayMs = 0, shouldRetry = () => true, onRetry } = options;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`attempts ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป (ได้รับ ${attempts})`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) break;
      await onRetry?.(error, attempt);
      if (delayMs > 0) await delay(delayMs);
    }
  }
  throw lastError;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
