import InboundEmail from '../models/InboundEmail.js';
import ReferrerAlias from '../models/ReferrerAlias.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import AppError from '../utils/AppError.js';
import { updateCustomerLog } from '../services/customerCardService.js'; // ✨ הוספנו את זה!

// --- פונקציות עזר (Helpers) ---

// מציאת שם רשמי (למשל "אינסטגרם" במקום "אינסטה")
export async function getOfficialReferrerName(rawName) {
    if (!rawName) return null;
    const cleanName = rawName.trim();
    const aliasEntry = await ReferrerAlias.findOne({ alias: cleanName });
    return aliasEntry ? aliasEntry.officialName : cleanName;
}

// ניתוח טקסט של המייל (Parsing)
export async function parseLeadBodyAsync(rawBody) {
    const data = {
        parsedName: null,
        parsedPhone: null,
        parsedNote: null,
        conversationLink: null,
        rawReferrer: null
    };

    if (typeof rawBody !== 'string') return data;

    try {
        // זיהוי שם
        const nameMatch = rawBody.match(/שם מלא:\s*([\s\S]*?)\s*מספר וואטצאפ/);
        if (nameMatch && nameMatch[1]) data.parsedName = nameMatch[1].trim();

        // זיהוי טלפון
        const waPhoneMatch = rawBody.match(/מספר וואטצאפ\s*([\s\S]*?)\s*מספר לחזרה/);
        if (waPhoneMatch && waPhoneMatch[1]) {
            let phone = waPhoneMatch[1].trim().replace(/[^0-9+]/g, '');
            if (phone.startsWith('0')) phone = '972' + phone.substring(1);
            data.parsedPhone = phone;
        }

        // זיהוי הערה
        let noteMatch = rawBody.match(/הערה:\s*([\s\S]*?)\s*View Conversation/);
        if (!noteMatch) noteMatch = rawBody.match(/הערה:\s*([\s\S]*?)$/);
        if (noteMatch && noteMatch[1]) data.parsedNote = noteMatch[1].trim();

        // זיהוי לינק לשיחה
        const linkMatch = rawBody.match(/View Conversation\s*<(.*?)>/);
        if (linkMatch && linkMatch[1]) data.conversationLink = linkMatch[1].trim();

        // זיהוי "הגעתי דרך"
        const referralPattern = /הגעתי\s+דרך\s+(.+)/i;
        const referralMatch = rawBody.match(referralPattern);

        if (referralMatch && referralMatch[1]) {
            let rawReferrer = referralMatch[1].trim().split(/\s+/).slice(0, 2).join(' ');
            rawReferrer = rawReferrer.replace(/[.,;!]$/, '');
            data.rawReferrer = rawReferrer;
        }

        return data;
    } catch (error) {
        console.error("Error parsing lead body:", error);
        return data;
    }
}

// --- פונקציות ניהול (Controllers) ---

export const getAllLeads = catchAsync(async (req, res) => {
    const leads = await InboundEmail.find({})
        .sort({ receivedAt: -1 })
        .populate('handledBy', 'name')
        .limit(200);
    res.status(200).json(leads);
});

// עיבוד ידני (Process Lead)
export const processLead = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const lead = await InboundEmail.findById(id);
    if (!lead) return next(new AppError('פנייה לא נמצאה', 404));

    const parsedData = await parseLeadBodyAsync(lead.body);

    // אם מצאנו מפנה בעיבוד חוזר, נעדכן את השדה הנסתר
    if (parsedData.rawReferrer) {
        lead.referrer = await getOfficialReferrerName(parsedData.rawReferrer);
    }

    Object.assign(lead, {
        parsedName: parsedData.parsedName || lead.parsedName,
        parsedPhone: parsedData.parsedPhone || lead.parsedPhone,
        parsedNote: parsedData.parsedNote || lead.parsedNote,
        conversationLink: parsedData.conversationLink || lead.conversationLink,
        status: 'processed',
        handledBy: req.user._id
    });

    const updatedLead = await lead.save();
    res.status(200).json(updatedLead);
});

// ✨ עדכון סטטוס + תיעוד בהיסטוריה ✨
export const updateLeadStatus = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    const lead = await InboundEmail.findById(id);
    if (!lead) return next(new AppError('פנייה לא נמצאה', 404));

    const oldStatus = lead.status;

    // עדכון הסטטוס החדש באובייקט
    lead.status = status;

    // לוגיקה לטיפול בסיבות דחייה ושיוך נציג
    if (status === 'not_relevant' || status === 'handled') {
        lead.rejectionReason = rejectionReason || 'לא צוין פירוט';
    }

    // אם הסטטוס חוזר להיות "פתוח" או "בטיפול", נאפס את הסיבה
    if (status === 'new' || status === 'in_progress') {
        lead.rejectionReason = null;
        lead.handledBy = null;
    }

    // שיוך נציג מטפל בסטטוסים רלוונטיים
    if (['closed', 'handled', 'contact_saved', 'not_relevant', 'in_progress'].includes(status)) {
        // אם כבר יש מטפל לא דורסים אותו, אלא אם זה טיפול ראשוני
        if (!lead.handledBy) {
            lead.handledBy = req.user._id;
        }
    }

    let description = ''; // נשמור את התיאור לשימוש גם בעדכון הכרטיס

    // ✨✨ הוספת האינטראקציה להיסטוריה (Timeline) של הליד עצמו ✨✨
    if (status && oldStatus !== status) {
        // מיפוי שמות לתצוגה יפה
        const statusMap = {
            'new': 'חדש',
            'processed': 'עובד',
            'in_progress': 'בטיפול',
            'handled': 'טופל',
            'contact_saved': 'איש קשר נשמר',
            'not_relevant': 'לא רלוונטי',
            'closed': 'סגור'
        };

        const oldStatusName = statusMap[oldStatus] || oldStatus;
        const newStatusName = statusMap[status] || status;
        description = `סטטוס שונה מ-"${oldStatusName}" ל-"${newStatusName}"`;

        // אם יש סיבת דחייה, נוסיף אותה לתיאור
        if ((status === 'not_relevant' || status === 'handled') && lead.rejectionReason) {
            description += ` | סיבה: ${lead.rejectionReason}`;
        }

        // וודא שהמערך קיים
        if (!lead.interactions) lead.interactions = [];
        lead.interactions.push({
            type: 'status_change', // צבע כתום ב-Lookup Page
            date: new Date(),
            description: description,
            user: req.user._id,
            metadata: {
                from: oldStatus,
                to: status,
                reason: rejectionReason
            }
        });
    }

    const updatedLead = await lead.save();

    // ✨✨✨ עדכון הלקוח המרכזי בזמן אמת ✨✨✨
    if (description) {
        await updateCustomerLog({
            phone: lead.parsedPhone || lead.from, // שימוש בטלפון שפוענח או במספר השולח
            name: lead.parsedName,
            eventType: 'status_change',
            description: `בעדכון ליד: ${description}`,
            metadata: { 
                messageId: lead._id,
                changedBy: req.user._id 
            }
        });
    }

    res.status(200).json(updatedLead);
});

export const deleteLead = catchAsync(async (req, res, next) => {
    await InboundEmail.findByIdAndDelete(req.params.id);
    res.status(204).send();
});