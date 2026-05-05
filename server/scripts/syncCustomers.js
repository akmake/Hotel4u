import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import Order from '../models/Order.js';
import InboundEmail from '../models/InboundEmail.js';
import CustomerCard from '../models/CustomerCard.js';

// אותה פונקציית נרמול כמו בסרוויס - חובה!
const normalizePhone = (phone) => {
    if (!phone) return '';
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('972')) clean = '0' + clean.slice(3);
    if (!clean.startsWith('0') && clean.length === 9) clean = '0' + clean;
    return clean;
};

const sync = async () => {
    try {
        console.log('🔌 מתחבר ל-MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        
        console.log('🧹 מוחק את כל הכרטיסים הקיימים (Reset)...');
        await CustomerCard.deleteMany({});

        const customers = new Map();

        // --- שלב 1: עיבוד הזמנות ---
        const orders = await Order.find({}).sort({ createdAt: 1 });
        console.log(`📦 מעבד ${orders.length} הזמנות...`);
        
        for (const o of orders) {
            const p = normalizePhone(o.customerPhone);
            if (!p) continue;

            if (!customers.has(p)) customers.set(p, { 
                phone: p, name: o.customerName, email: o.customerEmail, 
                timeline: [], lastEventDate: new Date(0), lifecycleStage: 'new' 
            });

            const c = customers.get(p);
            
            // עדכון שם ומייל
            if (!c.name) c.name = o.customerName;
            if (!c.email && o.customerEmail) c.email = o.customerEmail;
            
            // תאריך קובע: תאריך ההגעה אם יש (והוא עתידי), אחרת תאריך היצירה
            // זה מה שקובע את המיון ברשימה
            const relevantDate = o.eventDate ? new Date(o.eventDate) : o.createdAt;
            if (relevantDate > c.lastEventDate) c.lastEventDate = relevantDate;

            // קביעת סטטוס הכרטיס לפי ההזמנה האחרונה
            let statusDisplay = o.status;
            if (o.status === 'בוצע' || o.status === 'placed') {
                c.lifecycleStage = 'past_customer'; // ארכיון
                statusDisplay = 'בוצע';
            } else if (o.status === 'לא רלוונטי' || o.status === 'not_relevant' || o.status === 'cancelled') {
                c.lifecycleStage = 'cold'; // ארכיון
                statusDisplay = 'לא רלוונטי';
            } else {
                c.lifecycleStage = 'active_order'; // פעיל
            }

            // בניית התיאור לטיימליין (כולל הערות!)
            let desc = `הזמנה #${o.orderNumber} (${statusDisplay})`;
            if (o.notes) desc += `\nסיבה/הערה: ${o.notes}`;

            c.timeline.push({
                type: 'order_created',
                description: desc,
                metadata: { orderId: o._id },
                timestamp: o.createdAt // מתי זה קרה בהיסטוריה
            });
        }

        // --- שלב 2: עיבוד הודעות וואטסאפ ---
        const msgs = await InboundEmail.find({}).sort({ receivedAt: 1 });
        console.log(`💬 מעבד ${msgs.length} הודעות...`);

        for (const m of msgs) {
            let p = normalizePhone(m.parsedPhone || m.from);
            if (!p) continue;

            // אם אין כרטיס - יוצרים חדש. אם יש - ממזגים.
            if (!customers.has(p)) customers.set(p, { 
                phone: p, name: m.parsedName || 'פנייה מוואטסאפ', email: '', 
                timeline: [], lastEventDate: new Date(0), lifecycleStage: 'new' 
            });

            const c = customers.get(p);
            
            c.timeline.push({
                type: 'message_in',
                description: `הודעה: ${m.body?.substring(0,40) || 'מדיה'}`,
                metadata: { messageId: m._id },
                timestamp: m.receivedAt
            });
            
            // עדכון תאריך רק אם התאריך הנוכחי בכרטיס הוא לא עתידי
            // (כדי לא לדרוס תאריך הזמנה עתידית עם הודעה ישנה)
            const now = new Date();
            if (c.lastEventDate < now && m.receivedAt > c.lastEventDate) {
                c.lastEventDate = m.receivedAt;
            }
        }

        // --- שלב 3: שמירה לדאטה-בייס ---
        console.log(`💾 שומר ${customers.size} כרטיסים מאוחדים...`);
        let count = 0;
        for (const c of customers.values()) {
            // מיון הטיימליין שיהיה מסודר כרונולוגית
            c.timeline.sort((a,b) => b.timestamp - a.timestamp); 
            
            await CustomerCard.create(c);
            count++;
            if (count % 50 === 0) process.stdout.write('.');
        }
        
        console.log('\n✅ סנכרון הושלם בהצלחה!');
        process.exit(0);

    } catch (e) { 
        console.error('❌ שגיאה:', e); 
        process.exit(1); 
    }
};

sync();