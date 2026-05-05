import Message from '../models/Message.js';
import User from '../models/User.js';
import { getSocketIO } from '../socket.js';
import { sendPushToUser } from '../utils/pushHandler.js';

// === מטריצת הרשאות ===
const PERMISSION_MATRIX = {
    'admin': ['all'],
    'sales': ['admin', 'shift_manager', 'maintenance'],
    'shift_manager': ['all'],
    'housekeeper': ['shift_manager', 'maintenance'],
    'maintenance': ['all']
};

export const getMyContacts = async (req, res) => {
    const myRole = req.user.role;
    const myId = req.user._id;

    const allowedRoles = PERMISSION_MATRIX[myRole] || [];
    let query = {};
    if (!allowedRoles.includes('all')) {
        query.role = { $in: allowedRoles };
    }

    const contacts = await User.find({
        ...query,
        _id: { $ne: myId }
    }).select('name role email').lean();

    const contactsWithCounts = await Promise.all(contacts.map(async (contact) => {
        const unreadCount = await Message.countDocuments({
            sender: contact._id,
            recipient: myId,
            isRead: false
        });

        const lastMessage = await Message.findOne({
            $or: [
                { sender: myId, recipient: contact._id },
                { sender: contact._id, recipient: myId }
            ]
        }).sort({ createdAt: -1 }).select('text createdAt mediaType').lean(); // הוספנו mediaType לשליפה

        // עדכון תצוגה אם ההודעה האחרונה היא קובץ
        if (lastMessage && !lastMessage.text && lastMessage.mediaType) {
            lastMessage.text = `[${lastMessage.mediaType}]`; 
        }

        return {
            ...contact,
            unreadCount,
            lastMessage
        };
    }));

    contactsWithCounts.sort((a, b) => {
        if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
        const dateA = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(0);
        const dateB = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(0);
        return dateB - dateA;
    });

    res.json(contactsWithCounts);
};

export const getMessages = async (req, res) => {
    const { otherUserId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
        $or: [
            { sender: myId, recipient: otherUserId },
            { sender: otherUserId, recipient: myId }
        ]
    })
    .sort({ createdAt: 1 })
    .populate('relatedOrder', 'orderNumber customerName total_price status');

    res.json(messages);
};

// ✨ הפונקציה המעודכנת לתמיכה בקבצים
export const sendMessage = async (req, res) => {
    const { recipientId, text, orderId, isForwarded } = req.body;
    const senderId = req.user._id;
    const senderName = req.user.name;

    let mediaUrl = null;
    let mediaType = null;
    let fileName = null;

    if (req.file) {
        mediaUrl = `/uploads/files/${req.file.filename}`;
        fileName = req.file.originalname;
        
        const mime = req.file.mimetype;
        if (mime.startsWith('image/')) mediaType = 'image';
        else if (mime.startsWith('video/')) mediaType = 'video';
        else mediaType = 'document';
    }

    const newMessage = await Message.create({
        sender: senderId,
        recipient: recipientId,
        text: text || '',
        mediaUrl,
        mediaType,
        fileName,
        relatedOrder: orderId || null,
        isForwarded: isForwarded === 'true' || isForwarded === true
    });

    const populatedMessage = await newMessage.populate('relatedOrder', 'orderNumber customerName status');

    try {
        const io = getSocketIO();
        io.to(recipientId).emit('receive_message', populatedMessage);
        io.to(senderId).emit('message_sent_confirmation', populatedMessage);

        const pushBody = mediaType 
            ? `📷 נשלח ${mediaType === 'image' ? 'תמונה' : mediaType === 'video' ? 'סרטון' : 'קובץ'}` 
            : text;

        sendPushToUser(recipientId, {
            title: `הודעה מ-${senderName}`,
            body: pushBody,
            url: '/chat'
        });

    } catch (err) {
        console.error("Notification error:", err.message);
    }

    res.status(201).json(populatedMessage);
};

export const markAsRead = async (req, res) => {
    const { senderId } = req.body;
    const myId = req.user._id;

    await Message.updateMany(
        { sender: senderId, recipient: myId, isRead: false },
        { $set: { isRead: true } }
    );

    try {
        const io = getSocketIO();
        io.to(senderId).emit('messages_read_update', { byUserId: myId });
    } catch (err) { console.error(err); }

    res.json({ success: true });
};

export const deleteMessage = async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findOne({ _id: messageId, sender: userId });
    if (!message) return res.status(403).json({ message: 'לא מורשה' });

    message.isDeleted = true;
    await message.save();

    try {
        const io = getSocketIO();
        io.to(message.recipient.toString()).emit('message_deleted', { messageId });
        io.to(userId.toString()).emit('message_deleted', { messageId });
    } catch (err) { console.error(err); }

    res.json({ success: true });
};