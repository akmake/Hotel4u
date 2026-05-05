// server/controllers/admin/orderAdminController.js
// ✅ תיקון: הוספת סנכרון CRM כשמנהל משנה סטטוס/שם דרך ניהול הזמנות

import Order from '../../models/Order.js';
import User from '../../models/User.js';
import CustomerCard from '../../models/CustomerCard.js';
import { logAction } from '../../utils/auditLogger.js';

// --- פונקציית עזר: ניקוי טלפון ---
const normalizePhone = (phone) => {
    if (!phone) return '';
    let clean = phone.toString().replace(/\D/g, '');
    if (clean.startsWith('972')) clean = '0' + clean.slice(3);
    if (!clean.startsWith('0') && clean.length === 9) clean = '0' + clean;
    return clean;
};

// --- פונקציית עזר: סנכרון שינויים ל-CRM ---
const syncAdminChangeToCRM = async (order, description, userId, metadata = {}) => {
    try {
        if (!order.customerPhone) return;

        const cleanPhone = normalizePhone(order.customerPhone);
        const card = await CustomerCard.findOne({ phone: cleanPhone });
        if (!card) return;

        const interactionData = {
            type: 'status_change',
            date: new Date(),
            description,
            user: userId,
            metadata: {
                orderId: order._id,
                isManual: false,
                ...metadata
            }
        };

        // מניעת כפילויות
        const exists = card.timeline.some(t =>
            t.metadata?.orderId?.toString() === order._id.toString() &&
            t.description === description
        );

        if (!exists) {
            card.timeline.push(interactionData);
            card.lastEventDate = new Date();

            // עדכון lifecycleStage
            if (order.status === 'בוצע' || order.status === 'placed') {
                card.lifecycleStage = 'past_customer';
            } else if (order.status === 'not_relevant' || order.status === 'cancelled' || order.status === 'בוטל') {
                if (card.lifecycleStage !== 'active_order') card.lifecycleStage = 'cold';
            } else {
                card.lifecycleStage = 'active_order';
            }

            await card.save();
        }
    } catch (err) {
        console.error("❌ Error syncing admin change to CRM:", err);
    }
};


/**
 * @desc    שליפת כל ההזמנות
 * @route   GET /api/admin/orders
 * @access  Admin
 */
export const getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('user', 'name email')
            .populate('hotel', 'name')
            .sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: "שגיאה בטעינת ההזמנות." });
    }
};

/**
 * @desc    שליפת מפת הזמנות לעמלות
 * @route   GET /api/admin/orders/commission-map
 * @access  Admin
 */
export const getOrdersForCommissionMap = async (req, res) => {
    try {
        const orders = await Order.find({}, 'orderNumber createdByName closedByName')
            .lean();

        const map = {};
        orders.forEach(o => {
            if (o.createdByName && o.closedByName && o.createdByName !== o.closedByName) {
                map[o.orderNumber] = {
                    creator: o.createdByName,
                    closer: o.closedByName,
                    isSplit: true
                };
            }
        });

        res.json(map);
    } catch (error) {
        res.status(500).json({ message: 'שגיאה בשליפת מפת הזמנות.' });
    }
};


/**
 * @desc    עדכון הזמנה (סטטוס, שם, שיוך נציג)
 * @route   PUT /api/admin/orders/:id
 * @access  Admin
 *
 * ✅ תיקון: כל שינוי מסתנכרן ל-CRM (סטטוס, שם, שיוך)
 */
export const updateOrder = async (req, res) => {
    const { id } = req.params;
    const { customerName, customerPhone, status, notes, newUserId } = req.body;

    try {
        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ message: "ההזמנה לא נמצאה." });
        }

        const oldStatus = order.status;
        const oldName = order.customerName;

        // עדכונים רגילים
        if (customerName) order.customerName = customerName;
        if (customerPhone) order.customerPhone = customerPhone;
        if (status) order.status = status;
        if (notes) order.notes = notes;

        // --- לוגיקה לשינוי שיוך נציג ---
        if (newUserId && newUserId !== order.user.toString()) {
            const newUser = await User.findById(newUserId);
            if (!newUser) {
                return res.status(404).json({ message: "המשתמש החדש לא נמצא במערכת" });
            }

            const prevName = order.salespersonName || 'נציג קודם';
            order.user = newUser._id;
            order.salespersonName = newUser.name;

            await logAction(req, 'UPDATE', 'Order', order._id, `שיוך ההזמנה שונה מ-${prevName} ל-${newUser.name}`);

            // ✅ סנכרון שינוי שיוך ל-CRM
            await syncAdminChangeToCRM(
                order,
                `בהזמנה #${order.orderNumber}: שיוך שונה מ-"${prevName}" ל-"${newUser.name}"`,
                req.user._id,
                { previousOwner: prevName, newOwner: newUser.name }
            );
        }

        // ✅ סנכרון שינוי סטטוס ל-CRM
        if (status && status !== oldStatus) {
            const statusMap = {
                'sent': 'נשלחה הצעה', 'placed': 'בוצע', 'not_relevant': 'לא רלוונטי',
                'cancelled': 'בוטל', 'בהמתנה': 'בהמתנה', 'בוצע': 'בוצע',
                'לא רלוונטי': 'לא רלוונטי', 'בטיפול': 'בטיפול', 'in_progress': 'בטיפול'
            };
            const oldStatusName = statusMap[oldStatus] || oldStatus;
            const newStatusName = statusMap[status] || status;

            await syncAdminChangeToCRM(
                order,
                `בהזמנה #${order.orderNumber}: סטטוס שונה מ-"${oldStatusName}" ל-"${newStatusName}"`,
                req.user._id,
                { previousStatus: oldStatus, newStatus: status }
            );
        }

        // ✅ סנכרון שינוי שם לקוח ל-CRM (ועדכון שם בכרטיס הלקוח)
        if (customerName && customerName !== oldName) {
            try {
                const cleanPhone = normalizePhone(order.customerPhone);
                const card = await CustomerCard.findOne({ phone: cleanPhone });
                if (card) {
                    card.name = customerName; // עדכון השם בכרטיס
                    await card.save();
                }
            } catch (e) {
                console.error("Error updating customer name in CRM:", e);
            }
        }

        const updatedOrder = await order.save();

        await updatedOrder.populate('user', 'name email');
        await updatedOrder.populate('hotel', 'name');

        res.json(updatedOrder);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "שגיאה בעדכון ההזמנה." });
    }
};


/**
 * @desc    מחיקת הזמנה
 * @route   DELETE /api/admin/orders/:id
 * @access  Admin
 */
export const deleteOrder = async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'ההזמנה לא נמצאה' });
        }
        res.json({ message: 'ההזמנה נמחקה בהצלחה' });
    } catch (error) {
        res.status(500).json({ message: 'שגיאה במחיקת ההזמנה' });
    }
};