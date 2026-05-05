// server/controllers/admin/dashboardController.js
import { catchAsync } from '../../middlewares/errorHandler.js';
import Order from '../../models/Order.js';
import User from '../../models/User.js';
import InboundEmail from '../../models/InboundEmail.js';

export const getDashboardStats = catchAsync(async (req, res, next) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // הגדרת קבוצות סטטוסים לחישוב מדויק
  const CLOSED_STATUSES = ['בוצע', 'converted'];
  // כל הסטטוסים שנחשבים "כסף על הרצפה"
  const WAITING_STATUSES = ['sent', 'placed', 'in_progress', 'בטיפול', 'בהמתנה', 'חדש']; 
  const IRRELEVANT_STATUSES = ['לא רלוונטי', 'not_relevant', 'cancelled'];

  const [
    orderStats,
    totalUsers,
    totalLeads,
    leadsPerDay,
    salesByPerson,
    rejectionReasons,
    leadConversion
  ] = await Promise.all([
    // 1. סיכום כללי
    Order.aggregate([
      {
        $group: {
          _id: null,
          totalSales: { $sum: "$total_price" },
          totalOrders: { $sum: 1 }
        }
      }
    ]),
    // 2. ספירות
    User.countDocuments(),
    InboundEmail.countDocuments({ receivedAt: { $gte: thirtyDaysAgo } }),
    // 3. גרף לידים
    InboundEmail.aggregate([
      { $match: { receivedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$receivedAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),

    // 4. ✨✨ ביצועי אנשי מכירות - חישוב כספי מתוקן ✨✨
    Order.aggregate([
        { 
            $match: { 
                // מביא הכל חוץ ממבוטלים
                status: { $nin: IRRELEVANT_STATUSES },
                salespersonName: { $exists: true, $ne: null }
            } 
        },
        { 
            $group: { 
                _id: "$salespersonName", 
                
                // --- עסקאות סגורות ---
                closedCount: { 
                    $sum: { $cond: [{ $in: ["$status", CLOSED_STATUSES] }, 1, 0] } 
                },
                totalRevenue: { 
                    $sum: { $cond: [{ $in: ["$status", CLOSED_STATUSES] }, "$total_price", 0] } 
                },
                
                // --- עסקאות בהמתנה (כסף על הרצפה) ---
                // סופר גם "בטיפול", גם "נשלח" וגם "בהמתנה"
                waitingCount: { 
                    $sum: { $cond: [{ $in: ["$status", WAITING_STATUSES] }, 1, 0] } 
                },
                waitingRevenue: { 
                    $sum: { $cond: [{ $in: ["$status", WAITING_STATUSES] }, "$total_price", 0] } 
                },

                // (אופציונלי) ספציפית "בטיפול" אם רוצים להפריד בגרף, אבל נכלל כבר ב-waitingRevenue למעלה
                inProgressCount: { 
                    $sum: { $cond: [{ $in: ["$status", ['in_progress', 'בטיפול']] }, 1, 0] } 
                }
            } 
        },
        { $sort: { totalRevenue: -1 } }
    ]),

    // 5. סיבות דחייה
    Order.aggregate([
        { $match: { status: { $in: IRRELEVANT_STATUSES }, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: "$rejectionReason", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]),
    // 6. סטטוס לידים
    InboundEmail.aggregate([
        { $match: { receivedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
    ])
  ]);

  // איחוד נתונים
  const leadRejections = await InboundEmail.aggregate([
      { $match: { status: { $in: ['not_relevant', 'לא רלוונטי'] }, receivedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$rejectionReason", count: { $sum: 1 } } }
  ]);
  const combinedRejections = [...rejectionReasons];
  leadRejections.forEach(lr => {
      const existing = combinedRejections.find(r => r._id === lr._id);
      if (existing) existing.count += lr.count;
      else combinedRejections.push(lr);
  });

  res.status(200).json({
    totalSales: orderStats[0]?.totalSales || 0,
    totalOrders: orderStats[0]?.totalOrders || 0,
    totalUsers,
    totalLeads,
    leadsPerDay,
    salesByPerson,
    rejectionReasons: combinedRejections,
    leadStats: leadConversion
  });
});