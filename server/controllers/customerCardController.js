// server/controllers/customerCardController.js
// ✅ הוספה: endpoint חדש getCalendarOrders לשליפת הזמנות ללוח השנה ב-CRM

import CustomerCard from '../models/CustomerCard.js';
import Order from '../models/Order.js';
import { logAction } from '../utils/auditLogger.js';

// --- 1. שליפת נתונים עם תיקון תאריכים ---
export const getCustomerCard = async (req, res) => {
    try {
        const { query, page = 1, limit = 24, id, tab = 'active' } = req.query;

        // --- תרחיש 1: פירוט מלא ללקוח ספציפי ---
        if (id) {
            const card = await CustomerCard.findById(id)
                .populate({
                    path: 'timeline.metadata.orderId',
                    select: 'orderNumber status total_price eventDate numberOfNights roomType hotel createdAt updatedAt',
                    populate: { path: 'hotel', select: 'name' }
                })
                .populate({
                    path: 'timeline.metadata.messageId',
                    select: 'receivedAt body type'
                })
                .populate({
                    path: 'timeline.user',
                    select: 'name'
                })
                .lean();

            if (!card) return res.status(404).json({ message: 'לא נמצא' });

            // תיקון תאריכים בשרת
            if (card.timeline && card.timeline.length > 0) {
                card.timeline.forEach(event => {
                    if (event.type === 'order_created' && event.metadata?.orderId?.createdAt) {
                        event.date = event.metadata.orderId.createdAt;
                    }
                    if (event.type === 'message_in' && event.metadata?.messageId?.receivedAt) {
                        event.date = event.metadata.messageId.receivedAt;
                    }
                    if (!event.date && event._id) {
                        try {
                            event.date = new Date(parseInt(event._id.toString().substring(0, 8), 16) * 1000);
                        } catch (e) {}
                    }
                    if (!event.date && event.timestamp) {
                        event.date = event.timestamp;
                    }
                });

                card.timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
            }

            return res.json({ mode: 'detail', result: card });
        }

        // --- תרחיש 2: רשימה ---
        let filter = {};
        if (query) {
            filter = {
                $or: [
                    { phone: { $regex: query, $options: 'i' } },
                    { email: { $regex: query, $options: 'i' } },
                    { name: { $regex: query, $options: 'i' } }
                ]
            };
        } else {
            if (tab === 'active') {
                filter.lifecycleStage = { $in: ['active_order', 'new'] };
            } else if (tab === 'archive') {
                filter.lifecycleStage = { $in: ['past_customer', 'cold'] };
            }
        }

        const skip = (Number(page) - 1) * Number(limit);
        const total = await CustomerCard.countDocuments(filter);

        const cards = await CustomerCard.find(filter)
            .sort({ lastEventDate: -1 })
            .skip(skip)
            .limit(Number(limit))
            .select('name phone email lastEventDate lifecycleStage')
            .lean();

        return res.json({
            mode: 'list',
            results: cards,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                totalItems: total
            }
        });

    } catch (error) {
        console.error('Error fetching customer cards:', error);
        res.status(500).json({ message: 'שגיאה בשליפת נתונים' });
    }
};


// --- 2. הוספת תיעוד ידני ---
export const addManualInteraction = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, description } = req.body;

        if (!description) {
            return res.status(400).json({ message: 'חובה לרשום תוכן לתיעוד.' });
        }

        const card = await CustomerCard.findById(id);
        if (!card) {
            return res.status(404).json({ message: 'כרטיס לקוח לא נמצא.' });
        }

        const newInteraction = {
            type: type || 'note',
            date: new Date(),
            description: description,
            user: req.user._id,
            metadata: {
                isManual: true,
                addedBy: req.user.name
            }
        };

        card.timeline.push(newInteraction);
        card.lastEventDate = new Date();

        await card.save();
        await logAction(req, 'UPDATE', 'CustomerCard', card._id, `תיעוד ידני: ${type}`);

        res.json({ message: 'התיעוד נוסף בהצלחה', timeline: card.timeline });

    } catch (error) {
        console.error('Error adding interaction:', error);
        res.status(500).json({ message: 'שגיאה בהוספת התיעוד.' });
    }
};


// --- ✅ 3. חדש: שליפת הזמנות לפי חודש ללוח השנה ---
export const getCalendarOrders = async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({ message: 'year and month are required' });
        }

        const y = Number(year);
        const m = Number(month) - 1; // JS months are 0-based

        // תחילת וסוף החודש
        const startOfMonth = new Date(y, m, 1);
        const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);

        // מחפש הזמנות שטווח הימים שלהן חופף לחודש המבוקש
        // הזמנה שמתחילה ב-eventDate ונמשכת numberOfNights לילות
        // לכן: eventDate <= endOfMonth AND (eventDate + nights) >= startOfMonth
        const orders = await Order.find({
            eventDate: { $lte: endOfMonth },
            status: { $nin: ['cancelled', 'בוטל', 'not_relevant', 'לא רלוונטי'] }
        })
        .populate('hotel', 'name')
        .select('orderNumber customerName customerPhone eventDate numberOfNights status hotel total_price salespersonName')
        .lean();

        // סינון: רק הזמנות שימי השהייה שלהן חופפים לחודש
        const filtered = orders.filter(order => {
            const start = new Date(order.eventDate);
            const nights = order.numberOfNights || 1;
            const end = new Date(start);
            end.setDate(end.getDate() + nights - 1);

            return end >= startOfMonth && start <= endOfMonth;
        });

        res.json(filtered);

    } catch (error) {
        console.error('Error fetching calendar orders:', error);
        res.status(500).json({ message: 'שגיאה בשליפת נתוני לוח שנה' });
    }
};