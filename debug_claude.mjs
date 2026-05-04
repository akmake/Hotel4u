import * as mupdf from 'mupdf';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: './server/.env' });

const PDF_PATH = 'C:/Users/yosef dahan/Downloads/בדיקה.pdf';
const SCALE = 1.5;

const PROMPT = `זהו דף מגמרא שוטנשטיין.

קיימים שני סוגי דפים:
1. דף מקור (וילנא) — עם רש"י ותוספות, מבנה מורכב
2. דף ביאור — עברית מודרנית, שתי עמודות, כותרת בפורמט [מספר]:[א/ב] בפינה

אם זה דף מקור — השב בדיוק: SKIP

אם זה דף ביאור:
- חלץ את הטקסט המלא: עמודה ימנית מלמעלה למטה, אחר כך שמאלית
- מילות גמרא מודגשות (bold) — סמן אותן בין ** כך: **תניא**
- אל תכלול הערות שוליים
- טקסט רציף נקי
- בשורה הראשונה בלבד: כותרת הדף (למשל: סוטה ב:א)

החזר רק את הטקסט. ללא הסברים.`;

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const doc    = mupdf.Document.openDocument(fs.readFileSync(PDF_PATH), 'application/pdf');

  for (let i = 0; i < doc.countPages(); i++) {
    const page   = doc.loadPage(i);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
    const b64    = Buffer.from(pixmap.asPNG()).toString('base64');

    console.log(`\n▶ שולח דף ${i + 1}...`);
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: PROMPT },
      ]}],
    });

    const result = msg.content[0].text.trim();
    console.log(`תוצאה דף ${i + 1}:\n${result}\n${'─'.repeat(60)}`);
    fs.writeFileSync(`debug_claude_page${i + 1}.txt`, result, 'utf8');
  }

  console.log('\n✓ נשמר: debug_claude_page1.txt / debug_claude_page2.txt');
}

main().catch(console.error);
