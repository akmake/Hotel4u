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

const sync = async () => {
    try {
        console.log('🔌 מתחבר ל-MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        
        console.log('🧹 מנקה כרטיסים ישנים...');
        await CustomerCard.deleteMany({});

        const customersMap = new Map(); 

        // 1. טעינת הזמנות
        console.log('📦 מעבד הזמנות...');
        const orders = await Order.find({}).sort({ createdAt: 1 });
        
        for (const order of orders) {
            if (!order.customerPhone) continue;
            const phone = order.customerPhone.trim();
            
            if (!customersMap.has(phone)) {
                customersMap.set(phone, {
                    phone,
                    name: order.customerName,
                    email: order.customerEmail,
                    timeline: [],
                    lastEventDate: new Date(0), // תאריך ליצירת קשר אחרון
                    nextArrivalDate: null // תאריך הגעה עתידי (אם יש)
                });
            }

            const customer = customersMap.get(phone);
            
            // עדכון פרטים
            if (!customer.name) customer.name = order.customerName;
            if (!customer.email && order.customerEmail) customer.email = order.customerEmail;

            // בדיקת תאריך הגעה
            const arrivalDate = order.eventDate ? new Date(order.eventDate) : null;
            const today = new Date();
            today.setHours(0,0,0,0);

            // אם זו הזמנה עתידית או להיום - נשמור את התאריך שלה
            if (arrivalDate && arrivalDate >= today && order.status !== 'not_relevant' && order.status !== 'cancelled') {
                if (!customer.nextArrivalDate || arrivalDate < customer.nextArrivalDate) {
                    customer.nextArrivalDate = arrivalDate;
                }
            }

            // הוספה לציר הזמן
            customer.timeline.push({
                type: 'order_created',
                description: `הזמנה #${order.orderNumber} לתאריך ${arrivalDate ? arrivalDate.toLocaleDateString('he-IL') : 'לא ידוע'}`,
                metadata: { orderId: order._id },
                timestamp: order.createdAt // מתי נוצרה ההזמנה
            });

            // אם ההזמנה נוצרה אחרי הפעילות האחרונה, נעדכן את "נראה לאחרונה"
            if (order.createdAt > customer.lastEventDate) {
                customer.lastEventDate = order.createdAt;
            }
        }

        // 2. טעינת וואטסאפ
        console.log('💬 מעבד הודעות...');
        const messages = await InboundEmail.find({}).sort({ receivedAt: 1 });

        for (const msg of messages) {
            let phone = msg.parsedPhone;
            if (!phone && /^\d+$/.test(msg.from)) phone = msg.from;
            if (!phone) continue;

            if (!customersMap.has(phone)) {
                customersMap.set(phone, {
                    phone,
                    name: msg.parsedName || msg.from,
                    email: '',
                    timeline: [],
                    lastEventDate: new Date(0),
                    nextArrivalDate: null
                });
            }

            const customer = customersMap.get(phone);

            customer.timeline.push({
                type: 'message_in',
                description: `הודעה: ${msg.body?.substring(0, 40) || 'מדיה'}`,
                metadata: { messageId: msg._id },
                timestamp: msg.receivedAt
            });

            if (msg.receivedAt > customer.lastEventDate) {
                customer.lastEventDate = msg.receivedAt;
            }
        }

        // 3. שמירה וחישוב סטטוס סופי
        console.log(`💾 שומר ${customersMap.size} כרטיסים...`);
        let count = 0;
        
        for (const data of customersMap.values()) {
            data.timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            let stage = 'past_customer'; // ברירת מחדל: היסטוריה

            // אם יש תאריך הגעה עתידי - זה לקוח פעיל בהזמנה!
            if (data.nextArrivalDate) {
                stage = 'active_order';
            } 
            // אם אין הזמנה עתידית, אבל דיבר איתנו בחודש האחרון - זה מתעניין/ליד חם
            else {
                const monthAgo = new Date();
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                if (data.lastEventDate > monthAgo) {
                    stage = 'new'; // ליד טרי
                }
            }

            await CustomerCard.create({
                phone: data.phone,
                name: data.name,
                email: data.email,
                lastEventDate: data.nextArrivalDate || data.lastEventDate, // המיון יהיה לפי ההגעה הקרובה או הפעילות האחרונה
                lifecycleStage: stage,
                timeline: data.timeline
            });
            count++;
            if (count % 50 === 0) process.stdout.write('.');
        }

        console.log('\n✨ סנכרון הושלם! הסטטוסים מעודכנים לפי תאריכי הגעה.');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

sync();