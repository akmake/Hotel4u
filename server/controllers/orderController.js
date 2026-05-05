import Order from '../models/Order.js';
import PriceList from '../models/PriceList.js';
import RoomType from '../models/RoomType.js';
import CustomerCard from '../models/CustomerCard.js'; 
import { calculateRoomTotalPrice } from '../lib/priceCalculator.js';
import { getNextSequenceValue } from '../models/Counter.js';
import nodemailer from 'nodemailer'; // נשמר למקרה שתרצה להפעיל ידנית, כרגע מבוטל באוטומציה
import { logAction } from '../utils/auditLogger.js';
import { catchAsync } from '../middlewares/errorHandler.js';

// --- פונקציות עזר פנימיות ---

// 1. ניקוי מספר טלפון
const normalizePhone = (phone) => {
    if (!phone) return '';
    let clean = phone.toString().replace(/\D/g, ''); 
    if (clean.startsWith('972')) clean = '0' + clean.slice(3);
    if (!clean.startsWith('0') && clean.length === 9) clean = '0' + clean;
    return clean;
};

// 2. סנכרון ל-CRM (כרטיס לקוח)
const syncOrderToCRM = async (order, interactionData) => {
    try {
        // חייבים טלפון כדי לסנכרן
        if (!interactionData || !order.customerPhone) return;

        const cleanPhone = normalizePhone(order.customerPhone);
        let card = await CustomerCard.findOne({ phone: cleanPhone });

        if (card) {
            // לקוח קיים - עדכון
            if (!card.timeline) card.timeline = [];
            
            // מניעת כפילויות
            const exists = card.timeline.some(t => 
                t.metadata && t.metadata.orderId && 
                t.metadata.orderId.toString() === order._id.toString() &&
                t.description === interactionData.description
            );

            if (!exists) {
                card.timeline.push(interactionData);
                card.lastEventDate = new Date();
                
                // עדכון שלב בחיים
                if (order.status === 'בוצע' || order.status === 'placed') {
                    card.lifecycleStage = 'past_customer';
                } else if (order.status === 'not_relevant' || order.status === 'cancelled') {
                    if (card.lifecycleStage !== 'active_order') card.lifecycleStage = 'cold';
                } else {
                    card.lifecycleStage = 'active_order';
                }

                await card.save();
            }
        } else {
            // לקוח חדש - יצירה
            await CustomerCard.create({
                phone: cleanPhone,
                name: order.customerName || 'לקוח ללא שם',
                email: order.customerEmail,
                lifecycleStage: 'active_order',
                lastEventDate: new Date(),
                timeline: [interactionData]
            });
        }
    } catch (err) {
        console.error("❌ Critical Error syncing Order to CRM:", err);
    }
};

// מילון תרגום סטטוסים
const statusTranslations = {
    'sent': 'נשלחה הצעה',
    'placed': 'בוצע / אושר',
    'not_relevant': 'לא רלוונטי',
    'cancelled': 'בוטל',
    'pending': 'בהמתנה',
    'in_progress': 'בטיפול',
    'בהמתנה': 'בהמתנה',
    'בוצע': 'בוצע',
    'לא רלוונטי': 'לא רלוונטי'
};

const getStatusName = (status) => statusTranslations[status] || status;

const calculateFinalTotal = (roomsPrice, extras, discountPercent) => {
    let extrasTotal = 0;
    if (extras && Array.isArray(extras)) {
        extrasTotal = extras.reduce((sum, ex) => sum + (ex.price * ex.quantity), 0);
    }
    const subTotal = roomsPrice + extrasTotal;
    const discountAmount = subTotal * (discountPercent / 100);
    return Math.max(0, subTotal - discountAmount);
};

// --- Controllers ---

// יצירת הזמנה
export const createOrder = async (req, res) => {
    const {
        hotel, rooms, notes, customerName, customerPhone, status, numberOfNights = 1,
        extras = [], discountPercent = 0, customerEmail, eventDate
    } = req.body;

    if (!hotel) return res.status(400).json({ message: 'חובה לבחור מלון.' });
    if (!customerName) return res.status(400).json({ message: 'שם הלקוח הוא שדה חובה.' });
    if ((!rooms || rooms.length === 0) && (!extras || extras.length === 0)) {
        return res.status(400).json({ message: 'ההזמנה חייבת להכיל לפחות חדר אחד או תוספת אחת.' });
    }

    try {
        // חישובי מחירים
        const priceListsFromDB = await PriceList.find({ hotel });
        const priceListsMap = Object.fromEntries(priceListsFromDB.map(pl => [pl.name, pl.toObject()]));
        const hotelRoomTypes = await RoomType.find({ hotel });
        const roomTypesMap = Object.fromEntries(hotelRoomTypes.map(rt => [rt._id.toString(), rt]));

        let roomsTotalPrice = 0;
        const roomsWithServerPrice = (rooms || []).map(room => {
            let supplement = 0;
            let roomTypeName = 'רגיל';
            if (room.roomTypeId && roomTypesMap[room.roomTypeId]) {
                const rt = roomTypesMap[room.roomTypeId];
                supplement = rt.supplementPerNight || 0;
                roomTypeName = rt.name;
            } else if (room.roomSupplement !== undefined) {
                supplement = room.roomSupplement;
            }
            const price = calculateRoomTotalPrice(room, priceListsMap, room.price_list_names, numberOfNights, supplement);
            roomsTotalPrice += price;
            return { ...room, price, roomType: roomTypeName, roomSupplement: supplement, notes: room.notes };
        });

        const finalPrice = calculateFinalTotal(roomsTotalPrice, extras, discountPercent);
        const orderNumber = await getNextSequenceValue('orderNumber');

        const newOrderInMongo = await Order.create({
            orderNumber, hotel, user: req.user.id, salespersonName: req.user.name,
            createdBy: req.user.id, createdByName: req.user.name,
            customerName, customerPhone, customerEmail,
            eventDate: eventDate ? new Date(eventDate) : new Date(),
            status: status || 'בהמתנה', numberOfNights, rooms: roomsWithServerPrice,
            extras, discountPercent, total_price: finalPrice, notes,
        });

        await logAction(req, 'CREATE', 'Order', newOrderInMongo._id, `נוצרה הזמנה חדשה #${orderNumber} עבור ${customerName}`);

        // CRM Sync
        const interactionData = {
            type: 'order_created',
            date: new Date(),
            description: `נוצרה הזמנה חדשה #${orderNumber} (${getStatusName(status || 'בהמתנה')})`,
            user: req.user._id, 
            metadata: { orderId: newOrderInMongo._id, changedBy: req.user.id }
        };
        await syncOrderToCRM(newOrderInMongo, interactionData);

        res.status(201).json(newOrderInMongo);
    } catch (error) {
        console.error("Order creation error:", error);
        res.status(500).json({ message: "שגיאה בשמירת ההזמנה." });
    }
}; 

// עדכון הזמנה (מתוקן - ללא קריסות וללא מיילים)
export const updateOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'ההזמנה לא נמצאה' });

        // שמירת מצב קודם לזיהוי שינויים
        const oldStatus = order.status;
        const oldNotes = order.notes;

        // שימוש בנתונים החדשים, ואם הם חסרים - שמירה על הקיים (מונע מחיקת נתונים בעדכון חלקי)
        const customerName = req.body.customerName || order.customerName;
        const customerPhone = req.body.customerPhone || order.customerPhone;
        const customerEmail = req.body.customerEmail !== undefined ? req.body.customerEmail : order.customerEmail;
        const hotel = req.body.hotel || order.hotel;
        const status = req.body.status || order.status;
        const notes = req.body.notes !== undefined ? req.body.notes : order.notes;
        const numberOfNights = req.body.numberOfNights || order.numberOfNights;
        const discountPercent = req.body.discountPercent !== undefined ? req.body.discountPercent : order.discountPercent;
        const optimaNumber = req.body.optimaNumber !== undefined ? req.body.optimaNumber : order.optimaNumber;
        let eventDate = req.body.eventDate ? new Date(req.body.eventDate) : order.eventDate;

        // בדיקות תקינות לסגירת עסקה
        if (status === 'בוצע' && oldStatus !== 'בוצע') {
            if (!optimaNumber) return res.status(400).json({ message: 'חובה להזין מספר הזמנה מאופטימה כדי לסגור עסקה.' });
            if (!eventDate) return res.status(400).json({ message: 'חובה לעדכן תאריך הגעה כדי לסגור עסקה.' });
            order.closedBy = req.user.id;
            order.closedByName = req.user.name;
        }

        // חישוב מחדש של מחירים (רק אם השתנו נתונים רלוונטיים)
        let roomsWithServerPrice = order.rooms;
        let roomsTotalPrice = 0;
        
        if (req.body.rooms || req.body.numberOfNights || req.body.hotel) {
             const priceListsFromDB = await PriceList.find({ hotel });
             const priceListsMap = Object.fromEntries(priceListsFromDB.map(pl => [pl.name, pl.toObject()]));
             const hotelRoomTypes = await RoomType.find({ hotel });
             const roomTypesMap = Object.fromEntries(hotelRoomTypes.map(rt => [rt._id.toString(), rt]));
             
             // אם לא נשלחו חדרים חדשים, משתמשים בישנים
             const roomsToProcess = req.body.rooms || order.rooms;

             roomsWithServerPrice = roomsToProcess.map(room => {
                let supplement = 0;
                let roomTypeName = room.roomType || 'רגיל';
                if (room.roomTypeId && roomTypesMap[room.roomTypeId]) {
                    const rt = roomTypesMap[room.roomTypeId];
                    supplement = rt.supplementPerNight || 0;
                    roomTypeName = rt.name;
                } else if (room.roomSupplement !== undefined) {
                    supplement = room.roomSupplement;
                }
                const price = calculateRoomTotalPrice(room, priceListsMap, room.price_list_names, numberOfNights, supplement);
                roomsTotalPrice += price;
                return { ...room, price, roomType: roomTypeName, roomSupplement: supplement, notes: room.notes };
            });
        } else {
            // אם לא השתנה מבנה החדרים, לוקחים את המחיר הקיים
            roomsTotalPrice = order.rooms.reduce((sum, r) => sum + r.price, 0);
        }

        const extras = req.body.extras !== undefined ? req.body.extras : order.extras;
        let finalPrice = calculateFinalTotal(roomsTotalPrice, extras, discountPercent);
        
        // עקיפה ידנית למחיר אם נשלחה
        if (req.body.total_price !== undefined) finalPrice = req.body.total_price;

        // עדכון האובייקט
        order.customerName = customerName;
        order.customerPhone = customerPhone;
        order.customerEmail = customerEmail;
        order.hotel = hotel;
        order.status = status;
        order.notes = notes;
        order.numberOfNights = numberOfNights;
        order.rooms = roomsWithServerPrice;
        order.extras = extras;
        order.discountPercent = discountPercent;
        order.total_price = finalPrice;
        order.optimaNumber = optimaNumber;
        order.eventDate = eventDate;

        // זיהוי שינויים ויצירת לוג ל-CRM
        const statusChanged = status && status !== oldStatus;
        const notesChanged = notes && notes !== oldNotes;
        let interactionData = null;

        if (statusChanged || notesChanged) {
            const statusMap = { 'new': 'חדש', 'in_progress': 'בטיפול', 'won': 'נסגר בהצלחה', 'lost': 'אבוד', 'bozaa': 'בוצע', 'cancel': 'בוטל' };
            const oldStatusName = statusMap[oldStatus] || oldStatus;
            const newStatusName = statusMap[status] || status;

            let description = statusChanged 
                ? `סטטוס שונה מ-"${oldStatusName}" ל-"${newStatusName}"` 
                : 'עודכנו פרטי הזמנה';

            if (notes && notes.trim() !== '' && notes !== oldNotes) description += ` | הערה: ${notes}`;

            interactionData = {
                type: 'status_change',
                date: new Date(),
                description: `בהזמנה #${order.orderNumber}: ${description}`,
                user: req.user._id,
                metadata: { orderId: order._id, previousStatus: oldStatus, newStatus: status }
            };

            // הוספה להיסטוריה הפנימית של ההזמנה
            if (!order.interactions) order.interactions = [];
            order.interactions.push(interactionData);
        }

        // שמירה בדאטה בייס
        const updatedOrder = await order.save();

        // 🔥 CRM Sync - קורה עכשיו תמיד כשיש שינוי, לא משנה מאיזה דף 🔥
        if (interactionData) {
            await syncOrderToCRM(updatedOrder, interactionData);
        }

        // 🛑 לוגיקת המיילים בוטלה לבקשתך כדי למנוע קריסות והודעות ללקוח 🛑
        // if (originalStatus !== 'confirmed' && req.body.status === 'confirmed') { ... }

        res.json(updatedOrder);

    } catch (error) {
        console.error("Order update error:", error);
        res.status(500).json({ message: "שגיאה בעדכון ההזמנה" });
    }
};

// --- שאר הפונקציות ללא שינוי ---

export const getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.id }).sort({ orderNumber: -1 }).populate('hotel', 'name');
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: "שגיאה בטעינת היסטוריית ההזמנות." });
    }
};

export const getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ orderNumber: -1 }).populate('user', 'name').populate('hotel', 'name');
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: "שגיאה בטעינת כל ההזמנות." });
    }
};

export const searchAllOrders = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.json([]);
        const orders = await Order.find({
            $and: [
                { status: { $ne: 'cancelled' } },
                {
                    $or: [
                        { customerName: { $regex: query, $options: 'i' } },
                        { customerPhone: { $regex: query, $options: 'i' } },
                        { orderNumber: !isNaN(query) ? Number(query) : null }
                    ].filter(Boolean)
                }
            ]
        })
        .select('orderNumber customerName customerPhone status hotel total_price createdByName createdAt optimaNumber user rooms extras notes discountPercent')
        .populate('hotel', 'name')
        .sort({ createdAt: -1 })
        .limit(10);
        res.json(orders);
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ message: "שגיאה בחיפוש הזמנות." });
    }
};

export const getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name').populate('hotel', 'name');
        if (!order) return res.status(404).json({ message: 'ההזמנה לא נמצאה' });
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: "שגיאה בטעינת ההזמנה" });
    }
};

export const getPublicQuoteById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('hotel', 'name brandColor logoUrl address phone');
        if (!order) return res.status(404).json({ message: 'ההזמנה לא נמצאה' });
        res.json({
            orderNumber: order.orderNumber,
            hotel: order.hotel,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            customerEmail: order.customerEmail,
            eventDate: order.eventDate,
            createdAt: order.createdAt,
            rooms: order.rooms,
            total_price: order.total_price,
            numberOfNights: order.numberOfNights,
            extras: order.extras,
            discountPercent: order.discountPercent,
            notes: order.notes
        });
    } catch (error) {
        res.status(500).json({ message: "שגיאה בטעינת ההזמנה" });
    }
};

export const deleteOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'ההזמנה לא נמצאה' });
        if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'אין הרשאה למחוק הזמנה זו' });
        }
        await Order.findByIdAndDelete(req.params.id);
        await logAction(req, 'DELETE', 'Order', req.params.id, `נמחקה הזמנה #${order.orderNumber}`);
        res.json({ message: 'ההזמנה נמחקה' });
    } catch (error) {
        res.status(500).json({ message: 'שגיאה במחיקת ההזמנה' });
    }
};

export const sendOrderEmail = async (req, res) => {
    try {
        const { email, customerName } = req.body;
        const pdfBuffer = req.file?.buffer;
        if (!email || !pdfBuffer) {
            return res.status(400).json({ message: 'חסר כתובת אימייל או קובץ PDF' });
        }
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            tls: { rejectUnauthorized: false }
        });
        const mailOptions = {
            from: `"הצעות מחיר" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `הצעת מחיר עבור ${customerName}`,
            html: `
                <div dir="rtl" style="font-family: Arial, sans-serif;">
                    <h2>שלום ${customerName},</h2>
                    <p>תודה שפנית אלינו.</p>
                    <p>מצורפת הצעת המחיר כקובץ PDF לבקשתך.</p>
                    <br>
                    <p>בברכה,</p>
                    <p>צוות ההזמנות</p>
                </div>
            `,
            attachments: [
                {
                    filename: 'quote.pdf',
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };
        await transporter.sendMail(mailOptions);
        await logAction(req, 'EXPORT', 'Order', req.params.id, `נשלחה הצעת מחיר במייל ל-${email}`);
        res.status(200).json({ message: 'Email sent successfully' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ message: 'שגיאה בשליחת המייל', error: error.message });
    }
};

export const getMyOrderStats = catchAsync(async (req, res) => {
    const userId = req.user._id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const openOrders = await Order.aggregate([
        {
            $match: {
                user: userId,
                status: { $in: ['בהמתנה', 'sent', 'in_progress', 'בטיפול'] }
            }
        },
        {
            $group: {
                _id: null,
                count: { $sum: 1 },
                totalValue: { $sum: "$total_price" }
            }
        }
    ]);

    const monthlySales = await Order.aggregate([
        {
            $match: {
                user: userId,
                status: { $in: ['בוצע', 'placed'] },
                createdAt: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: null,
                count: { $sum: 1 },
                totalValue: { $sum: "$total_price" }
            }
        }
    ]);

    res.status(200).json({
        pending: {
            count: openOrders[0]?.count || 0,
            value: openOrders[0]?.totalValue || 0,
        },
        monthly: {
            count: monthlySales[0]?.count || 0,
            value: monthlySales[0]?.totalValue || 0,
        },
    });
});