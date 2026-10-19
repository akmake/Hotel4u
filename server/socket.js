import { Server } from 'socket.io';
import Message from './models/Message.js'; 
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import { pmsJwtSecret } from './utils/jwtSecret.js';

let io;

export const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: [
                "http://localhost:5173",
                "https://ziporiteem.com",
                process.env.CLIENT_URL
            ].filter(Boolean),
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: 60000,
    });

    io.on('connection', (socket) => {
        console.log(`🔌 New Connection: ${socket.id}`);

        // 1. הצטרפות לחדר צ'אט פרטי
        socket.on('join_chat', (userId) => {
            if (!userId) return;
            socket.join(userId);
            socket.userId = userId; 
            console.log(`👤 User ${userId} joined room`);
        });

        // 2. הצטרפות לחדר מלון עבור עדכוני יומן
        socket.on('join_hotel', (hotelId) => {
            if (!hotelId) return;
            socket.join(hotelId);
            console.log(`🏨 Socket ${socket.id} joined hotel room: ${hotelId}`);
        });

        // 3. טיפול באירועי הקלדה (Typing)
        socket.on('typing_start', (recipientId) => {
            io.to(recipientId).emit('user_typing', { senderId: socket.userId });
        });

        socket.on('typing_stop', (recipientId) => {
            io.to(recipientId).emit('user_stopped_typing', { senderId: socket.userId });
        });

        // 4. טיפול בסימון "נקרא" (V כחול)
        socket.on('mark_as_read_realtime', async ({ senderId }) => {
            try {
                await Message.updateMany(
                    { sender: senderId, recipient: socket.userId, isRead: false },
                    { $set: { isRead: true } }
                );
                io.to(senderId).emit('messages_read_update', { byUserId: socket.userId });
            } catch (error) {
                console.error("Error marking as read in socket:", error);
            }
        });

        socket.on('disconnect', () => {
            console.log(`❌ Disconnected: ${socket.id}`);
        });
    });

    // PMS live updates: namespace /pms, signed in with the PMS bearer token; one room per property.
    // Only "what changed" is sent (entity + action), never record contents — screens reload through the API.
    const pms = io.of('/pms');
    pms.use(async (socket, next) => {
        try {
            const claim = jwt.verify(String(socket.handshake.auth?.token || ''), pmsJwtSecret());
            const user = await User.findById(claim.id).select('property role active tokenVersion').lean();
            if (!user || user.active === false || Number(user.tokenVersion || 0) !== Number(claim.tv || 0)) return next(new Error('unauthorized'));
            const wanted = String(socket.handshake.auth?.propertyId || user.property || '');
            const cross = ['super_admin', 'chain_admin'].includes(user.role);
            if (!wanted || (!cross && wanted !== String(user.property))) return next(new Error('forbidden'));
            socket.join(`property:${wanted}`);
            return next();
        } catch {
            return next(new Error('unauthorized'));
        }
    });

    return io;
};

export function emitPropertyChange(propertyId, payload) {
    if (!io || !propertyId) return;
    try { io.of('/pms').to(`property:${propertyId}`).emit('pms:change', payload); } catch { /* live updates are best effort */ }
}

// פונקציית הגישה (מוצהרת כאן פעם אחת בלבד!)
export const getSocketIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};