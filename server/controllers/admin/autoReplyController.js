import AutoReply from '../../models/AutoReply.js';
import AutoReplyLog from '../../models/AutoReplyLog.js'; // הייבוא החדש
import { scanAndReplyToOldChats } from '../../services/whatsappService.js';
import { catchAsync } from '../../middlewares/errorHandler.js';

export const getFlows = catchAsync(async (req, res) => {
    const flows = await AutoReply.find({}).sort({ createdAt: -1 });
    res.json(flows);
});

export const updateFlow = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updatedFlow = await AutoReply.findByIdAndUpdate(id, req.body, {
        new: true, // מחזיר את האובייקט המעודכן
        runValidators: true
    });

    if (!updatedFlow) {
        return res.status(404).json({ message: 'הזרימה לא נמצאה' });
    }

    res.json(updatedFlow);
});

export const createFlow = catchAsync(async (req, res) => {
    const newFlow = await AutoReply.create(req.body);
    res.status(201).json(newFlow);
});

export const deleteFlow = catchAsync(async (req, res) => {
    await AutoReply.findByIdAndDelete(req.params.id);
    res.json({ message: 'נמחק בהצלחה' });
});

export const triggerScan = catchAsync(async (req, res) => {
    const result = await scanAndReplyToOldChats();
    res.json(result);
});

// ✨ פונקציה חדשה לקבלת הלוגים
export const getLogs = catchAsync(async (req, res) => {
    // מביא את ה-50 האחרונים, מהחדש לישן
    const logs = await AutoReplyLog.find({}).sort({ createdAt: -1 }).limit(50);
    res.json(logs);
});