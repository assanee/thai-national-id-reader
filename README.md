# thai-national-id-reader

อ่านบัตรประชาชนไทยผ่านเครื่องอ่านสมาร์ทการ์ดมาตรฐาน PC/SC — พัฒนาและทดสอบกับ **ACS ACR39U-NF**
แต่ใช้ได้กับเครื่องอ่าน PC/SC รุ่นอื่นเช่นกัน เพราะคุยผ่าน APDU มาตรฐาน ไม่ได้ผูกกับไดรเวอร์ของยี่ห้อใด

รองรับทั้ง **ESM (`import`) และ CommonJS (`require`)** พร้อม type definitions ครบ

## ติดตั้ง

```bash
npm install thai-national-id-reader
```

## ความต้องการของระบบ

- **Node.js 18 ขึ้นไป**
- เครื่องอ่านสมาร์ทการ์ดแบบเสียบที่รองรับ PC/SC
- **macOS** ใช้ได้ทันที (มี PCSC.framework มาในตัว)
- **Windows** ใช้ไดรเวอร์ CCID ที่มากับระบบ หรือติดตั้งไดรเวอร์จาก ACS
- **Linux** ต้องติดตั้ง `pcscd` และ `libpcsclite-dev` แล้วสั่ง `sudo systemctl start pcscd`

> แพ็กเกจนี้พึ่ง `@pokusew/pcsclite` ซึ่งเป็น native addon โดยปกติจะดาวน์โหลด binary สำเร็จรูปมาให้
> ถ้าแพลตฟอร์มของคุณไม่มี binary พร้อมใช้ เครื่องต้องมี build toolchain (Xcode CLT บน macOS,
> `build-essential` บน Linux, Visual Studio Build Tools บน Windows)

## ใช้งานผ่าน CLI

```bash
# เฝ้ารอบัตรตลอดเวลา — เสียบกี่ใบก็อ่านต่อเนื่อง (ค่าเริ่มต้น)
npx thai-id

# เฝ้ารอพร้อมอ่านรูปถ่าย (บันทึกเป็น photo-<เลขบัตร>.jpg)
npx thai-id --photo

# อ่านใบเดียวแล้วออก เหมาะกับการเรียกจากสคริปต์อื่น
npx thai-id --once

# JSON บรรทัดเดียวต่อหนึ่งใบ ต่อท่อเข้าโปรแกรมอื่นได้เลย
npx thai-id --json --quiet | while read line; do echo "$line" | jq .cid; done
```

ตัวอย่างผลลัพธ์:

```
  เลขประจำตัวประชาชน  1-2345-67890-12-3
  ชื่อ-สกุล (ไทย)      นาย สมชาย ใจดี
  ชื่อ-สกุล (อังกฤษ)   Mr. Somchai Jaidee
  วันเกิด              1987-12-31
  เพศ                  ชาย
  ที่อยู่               99/1 ซอยสุขุมวิท 5 ถนนสุขุมวิท ตำบลคลองเตย อำเภอคลองเตย จังหวัดกรุงเทพมหานคร
  ผู้ออกบัตร            สำนักงานเขตคลองเตย
  วันออกบัตร           2017-01-15
  วันหมดอายุ           2027-01-14
```

## ใช้งานเป็น library

**แบบครั้งเดียวจบ** — เหมาะกับ endpoint ที่ผู้ใช้กดปุ่มแล้วเสียบบัตร:

```ts
import { readCardOnce } from 'thai-national-id-reader';

const card = await readCardOnce({ includePhoto: true, timeoutMs: 30_000 });
console.log(card.cid, card.firstNameTH, card.lastNameTH);
```

หรือแบบ CommonJS:

```js
const { readCardOnce } = require('thai-national-id-reader');

readCardOnce({ includePhoto: true }).then((card) => console.log(card.cid));
```

**แบบเฝ้ารอต่อเนื่อง** — เหมาะกับเครื่องลงเวลาหรือจุดลงทะเบียนที่เปิดค้างไว้:

```ts
import { ThaiIdCardWatcher } from 'thai-national-id-reader';

const watcher = new ThaiIdCardWatcher({ includePhoto: true });

watcher.on('reader-connected', (name) => console.log('เชื่อมต่อเครื่องอ่าน:', name));
watcher.on('card-inserted', ({ atr }) => showWaiting(atr));
watcher.on('reading', () => showSpinner());
watcher.on('progress', ({ step, percent }) => updateBar(step, percent));
watcher.on('card', (card) => saveEmployee(card));
watcher.on('card-removed', () => resetForm());
watcher.on('read-error', (error, { reason, willRetry }) => {
  if (!willRetry) showError(reason);
});
```

### Event ทั้งหมด

| Event | ยิงเมื่อ | ข้อมูลที่ส่งมา |
|---|---|---|
| `started` | เริ่มเฝ้ารอ | — |
| `reader-connected` | เสียบเครื่องอ่าน USB หรือพบตอนเริ่ม | `readerName: string` |
| `reader-disconnected` | ถอดเครื่องอ่านออกจาก USB | `readerName: string` |
| `card-inserted` | เสียบบัตร (ก่อนเริ่มอ่าน) | `{ readerName, atr }` |
| `reading` | เริ่มอ่านข้อมูล | `{ readerName }` |
| `progress` | ระหว่างอ่าน | `{ step, percent }` |
| `card` | อ่านสำเร็จ | `ThaiIdCard` |
| `read-error` | อ่านไม่สำเร็จ | `error, { reason, attempt, willRetry }` |
| `card-removed` | ถอดบัตรออก | `{ readerName }` |
| `error` | ข้อผิดพลาดระดับระบบ PC/SC | `Error` |
| `stopped` | หยุดเฝ้ารอ | — |

`reason` ใน `read-error` มีค่าเป็น `'not-thai-id'` `'card-removed'` `'card-unresponsive'`
`'corrupt-data'` `'timeout'` หรือ `'unknown'` ใช้แยกได้ว่าควรบอกผู้ใช้ให้เปลี่ยนบัตรหรือให้เสียบใหม่

### ข้อควรรู้เรื่องประสิทธิภาพ

`watcher.close()` **บล็อก event loop ราวหนึ่งวินาที** เพราะต้องรอ thread เฝ้าดูสถานะของ pcsclite จบก่อน

ระบบที่อ่านบัตรบ่อย เช่น HTTP endpoint **ต้องใช้ watcher ตัวเดียวยาว ๆ** อย่าเรียก `readCardOnce()`
ต่อหนึ่งคำขอ เพราะแต่ละครั้งจะสร้างและปิด watcher ใหม่ ทำให้ทั้งเซิร์ฟเวอร์หยุดนิ่งหนึ่งวินาทีต่อการอ่านหนึ่งใบ

### ความทนทาน

ตัวเฝ้ารอออกแบบให้ทำงานค้างไว้ตลอดโดยไม่ต้องมีคนดูแล:

- **ทุกคำสั่งที่คุยกับบัตรมีตัวจับเวลา** (`operationTimeoutMs` ค่าเริ่มต้น 5 วินาที) — พบจากการทดสอบจริงว่า `SCardConnect` ค้างได้แบบไม่มี callback กลับมาเลย ถ้าไม่มีตัวจับเวลา ระบบจะแข็งค้างถาวร
- **ลองใหม่อัตโนมัติเมื่อบัตรไม่ตอบสนอง** (`retryAttempts` ค่าเริ่มต้น 3 ครั้ง) โดยสั่งรีเซ็ตบัตรก่อนลองรอบใหม่ทุกครั้ง
- **ไม่หยุดทำงานเมื่อเกิดข้อผิดพลาด** — อ่านพลาดแล้วกลับไปรอบัตรใบถัดไปเสมอ
- **รองรับการถอด/เสียบเครื่องอ่านระหว่างทำงาน** โดยไม่ต้องรีสตาร์ต
- **ตรวจข้อมูลที่อ่านมาด้วยหลักตรวจสอบของเลขบัตร** — จับกรณีที่คำตอบจากบัตรเลื่อนกัน
  ซึ่งเป็นความล้มเหลวที่เงียบที่สุด เพราะทุกฟิลด์ยังดูมีรูปแบบถูกต้อง แล้วลองอ่านใหม่อัตโนมัติ

**หลักการที่ใช้ตัดสินว่าจะลองใหม่หรือไม่:** ลองใหม่ได้เฉพาะเมื่อคำสั่งก่อนหน้า *จบไปแล้วจริง*
(`card-unresponsive`, `corrupt-data`) ส่วน `timeout` ห้ามลองใหม่ เพราะตัวจับเวลาแค่เลิกรอ
ไม่ได้ยกเลิก `SCardConnect` ที่ยังค้างถือ handle อยู่ การเชื่อมต่อซ้อนเข้าไปจะทำให้ slot ของ PC/SC
พังจนต้องถอดสาย USB

## ข้อมูลที่ได้

| ฟิลด์ | ชนิด | หมายเหตุ |
|---|---|---|
| `cid` | `string` | เลขประจำตัว 13 หลัก ไม่มีขีดคั่น |
| `titleTH` `firstNameTH` `middleNameTH` `lastNameTH` | `string` | ชื่อภาษาไทย |
| `titleEN` `firstNameEN` `middleNameEN` `lastNameEN` | `string` | ชื่อภาษาอังกฤษ |
| `birthDate` | `string \| null` | รูปแบบ ISO `YYYY-MM-DD` แปลงจาก พ.ศ. แล้ว |
| `gender` | `'male' \| 'female' \| 'unknown'` | |
| `address` | `string \| null` | ที่อยู่ตามทะเบียนบ้าน ประกอบเป็นบรรทัดเดียว |
| `issuer` | `string \| null` | หน่วยงานที่ออกบัตร |
| `issueDate` `expireDate` | `string \| null` | รูปแบบ ISO |
| `photo` | `Buffer \| null` | JPEG ประมาณ 5 KB (เมื่อสั่ง `includePhoto`) |

ฟิลด์ที่เป็น `null` แปลว่าบัตรใบนั้นอ่านฟิลด์ดังกล่าวไม่ได้ — ระบบจะคืนฟิลด์ที่เหลือให้ตามปกติ
ไม่ทิ้งข้อมูลทั้งใบ ยกเว้น `cid` ที่ถือว่าจำเป็น

## โครงสร้างโค้ด

```
src/
├── card/           ตรรกะการอ่านบัตรทั้งหมด — ไม่รู้จัก PC/SC เลย
│   ├── apdu.ts     ประกอบคำสั่ง APDU และซ่อนความต่างของโปรโตคอล T=0 / T=1
│   ├── fields.ts   ตาราง offset บนบัตร (ข้อมูลล้วน ไม่มี logic)
│   ├── decode.ts   TIS-620 → ข้อความ, พ.ศ. → ISO, แยกชื่อและที่อยู่
│   ├── thai-id.ts  ลำดับขั้นการอ่านบัตรหนึ่งใบ
│   └── errors.ts   ชนิดข้อผิดพลาดที่แยกกันชัดเจน
├── pcsc/
│   ├── reader.ts       ชั้นเชื่อมฮาร์ดแวร์ — แปลง event ของ pcsclite เป็น event ของโดเมน
│   ├── card-state.ts   ตีความบิตสถานะของ PC/SC (pure function)
│   └── async-utils.ts  ตัวจับเวลาและการลองใหม่
├── cli.ts
└── index.ts
```

เส้นแบ่งสำคัญคือ `readThaiIdCard()` รับฟังก์ชัน `transmit` เข้ามาเป็นพารามิเตอร์
แทนที่จะเรียก PC/SC เอง ทำให้ตรรกะการอ่านบัตรทั้งหมดทดสอบได้โดยไม่ต้องมีเครื่องอ่านและบัตรจริง

## พัฒนาต่อ

```bash
npm install          # ติดตั้ง dependency
npm test             # รันเทสต์ทั้งหมด (ไม่ต้องมีเครื่องอ่านเสียบ)
npm run typecheck    # ตรวจ type
npm run read         # รัน CLI จากซอร์สโดยตรง
npm run build        # สร้าง dist/ ทั้ง ESM และ CommonJS พร้อม .d.ts
npm run verify:package  # แพ็กแล้วติดตั้งจริงในโฟลเดอร์ชั่วคราว เพื่อทดสอบว่าใช้งานได้
```

ซอร์สเขียนด้วย TypeScript และรันตรง ๆ ได้บน Node 22.18+ ผ่าน type stripping ในตัวของ Node
จึงไม่ต้อง build ระหว่างพัฒนา ส่วน `npm run build` ใช้ตอนจะเผยแพร่เท่านั้น

`verify:package` ตรวจสิ่งที่เทสต์ปกติจับไม่ได้ เพราะเทสต์รันบนซอร์ส ไม่ใช่บนแพ็กเกจที่ติดตั้งแล้ว —
เช่น `exports` ชี้ผิดไฟล์ ไฟล์จำเป็นไม่ถูกใส่ใน `files` หรือ type ที่ผู้ใช้มองไม่เห็น

## เทสต์

เทสต์ใช้บัตรจำลองใน `tests/fake-card.ts` ซึ่งเป็น `Buffer` ก้อนเดียวที่เขียนข้อมูลไว้ตาม offset จริง
และจำลองพฤติกรรมของทั้ง T=0 (ตอบ `61xx` แล้วต้องสั่ง GET RESPONSE ตามหลัง) และ T=1

ชุดเทสต์แบ่งเป็น:

| ไฟล์ | ครอบคลุม |
|---|---|
| `decode.test.ts` | ถอด TIS-620, แปลง พ.ศ., แยกชื่อและที่อยู่ |
| `apdu.test.ts` | ประกอบคำสั่ง, ความต่างของ T=0 กับ T=1 |
| `thai-id.test.ts` | ลำดับการอ่านบัตรทั้งใบ |
| `card-state.test.ts` | ตีความบิตสถานะของ PC/SC |
| `async-utils.test.ts` | ตัวจับเวลาและการลองใหม่ |
| `recovery.test.ts` | จัดประเภทข้อผิดพลาดและตัดสินใจว่าจะลองใหม่ไหม |
| `edge-cases.test.ts` | ค่าที่ขอบเขต, วันที่ที่ไม่มีจริง, ข้อมูลไม่ครบ |
| `fuzz.test.ts` | ยิงข้อมูลขยะ 3,000 รอบต่อเคส ตัวถอดรหัสต้องไม่ระเบิด |
| `watcher-lifecycle.test.ts` | เริ่ม/หยุด/ปิดซ้ำ และการไม่รั่วของทรัพยากร |

## แก้ปัญหาที่พบบ่อย

**ขึ้นว่าไม่พบเครื่องอ่านบัตร**
ตรวจว่าระบบเห็นเครื่องอ่านหรือยัง — บน macOS สั่ง `pcsctest` แล้วดูรายการ reader

**อ่านได้แต่ภาษาไทยเพี้ยน**
แปลว่าที่ไหนสักแห่งตีความข้อมูลเป็น UTF-8 บัตรเก็บข้อความเป็น TIS-620 ซึ่งไลบรารีนี้ถอดรหัสให้แล้ว
ปัญหามักอยู่ที่ปลายทางที่รับค่าต่อ

**บน Linux ขึ้น SCARD_E_NO_SERVICE**
`pcscd` ยังไม่ทำงาน — สั่ง `sudo systemctl start pcscd`
ถ้าเครื่องอ่านถูกแย่งจับ ให้ blacklist kernel module `pn533` และ `nfc`

**บัตรบางใบอ่านฟิลด์ใดฟิลด์หนึ่งไม่ได้**
offset ของบัตรบางรุ่นต่างกันเล็กน้อย แก้ได้ที่ `src/card/fields.ts` จุดเดียว

**ขึ้น `card-unresponsive` หรือ `timeout` ซ้ำ ๆ ทั้งที่บัตรเสียบอยู่**
เกิดเมื่อ slot ของ PC/SC daemon ค้าง อาการคือระบบยังอ่าน ATR ได้ปกติ
และ `SCardConnect` แบบ `DIRECT` สำเร็จ แต่แบบ `SHARED`/`EXCLUSIVE` ค้าง
วิธีแก้ตามลำดับ:

1. ถอดบัตรออกแล้วเสียบใหม่
2. **ถอดสาย USB ของเครื่องอ่านออกทั้งเส้น รอ 3 วินาที แล้วเสียบกลับ** (ได้ผลที่สุด)
3. บน macOS ถ้ายังไม่หาย: `sudo killall -9 com.apple.ifdreader`

ตรวจว่าเป็นอาการนี้จริงหรือไม่ด้วย `system_profiler SPSmartCardsDataType`
ถ้ายังเห็น ATR อยู่แต่โปรแกรมต่อบัตรไม่ได้ แสดงว่าใช่
