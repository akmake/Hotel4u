import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay as baileysDelay } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import { fileURLToPath } from 'url';
import util from 'util';

// === המודלים שלך ===
import InboundEmail from '../models/InboundEmail.js';
import ReferrerAlias from '../models/ReferrerAlias.js';
import LeadTrigger from '../models/LeadTrigger.js';
import AutoReply from '../models/AutoReply.js';
import AutoReplyLog from '../models/AutoReplyLog.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js'; // ✨ המודל של היסטוריית הצ'אט
import { sendPushToAll } from '../utils/pushHandler.js';
import { updateCustomerLog } from './customerCardService.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let sock; 
let ioInstance;

// ==========================================
// === 1. פונקציות עזר (Helper Functions) ===
// ==========================================

// --- קלאס מדיה ---
class MessageMedia {
    constructor(mimetype, data, filename) {
        this.mimetype = mimetype;
        this.data = data;
        this.filename = filename;
    }

    static fromFilePath(filePath) {
        const b64data = fs.readFileSync(filePath, { encoding: 'base64' });
        const mimetype = mime.lookup(filePath) || 'application/octet-stream';
        const filename = path.basename(filePath);
        return new MessageMedia(mimetype, b64data, filename);
    }

    static async fromUrl(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const b64data = Buffer.from(arrayBuffer).toString('base64');
        const mimetype = response.headers.get('content-type') || 'application/octet-stream';
        const filename = path.basename(url);
        return new MessageMedia(mimetype, b64data, filename);
    }
}

// --- חילוץ תוכן הודעה ---
const getMessageContent = (msg) => {
    if (!msg.message) return '';
    const m = msg.message;

    // עדיפות ראשונה: טקסט רגיל
    if (m.conversation) return m.conversation;
    
    // הודעות מורחבות (תשובות/לינקים)
    if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;

    // מדיה עם כיתוב
    if (m.imageMessage && m.imageMessage.caption) return m.imageMessage.caption;
    if (m.videoMessage && m.videoMessage.caption) return m.videoMessage.caption;
    if (m.documentMessage && m.documentMessage.caption) return m.documentMessage.caption;

    return ''; // הודעה ריקה או ללא טקסט
};

// --- חילוץ מספר טלפון אמיתי ---
const extractTruePhoneNumber = (msg) => {
    const key = msg.key;
    if (key.remoteJidAlt && key.remoteJidAlt.includes('@s.whatsapp.net')) {
        return key.remoteJidAlt.replace(/\D/g, '');
    }
    if (key.remoteJid && !key.remoteJid.includes('@lid')) {
        return key.remoteJid.replace(/\D/g, '');
    }
    if (key.participant && key.participant.includes('@s.whatsapp.net')) {
        return key.participant.replace(/\D/g, '');
    }
    return ''; 
};

// --- מציאת שם ממליץ ---
async function getOfficialReferrerName(rawName) {
    if (!rawName) return null;
    const cleanName = rawName.trim().replace(/[.,;!?-]$/, '');
    const aliasEntry = await ReferrerAlias.findOne({ alias: cleanName });
    return aliasEntry ? aliasEntry.officialName : cleanName;
}

// --- אדפטר שליחת הודעות ---
const sendMessageAdapter = async (jid, content, options = {}) => {
    if (!sock) throw new Error('Socket not initialized');
    
    let targetJid = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;

    if (typeof content === 'string') {
        return await sock.sendMessage(targetJid, { text: content });
    }

    if (content instanceof MessageMedia) {
        const buffer = Buffer.from(content.data, 'base64');
        let msgParams = {};
        if (content.mimetype.startsWith('image')) {
            msgParams = { image: buffer, caption: options.caption };
        } else if (content.mimetype.startsWith('video')) {
            msgParams = { video: buffer, caption: options.caption, gifPlayback: false };
        } else if (content.mimetype.startsWith('audio')) {
            msgParams = { audio: buffer, ptt: options.sendAudioAsVoice || false, mimetype: content.mimetype };
        } else {
            msgParams = { document: buffer, mimetype: content.mimetype, fileName: content.filename || options.caption };
        }
        return await sock.sendMessage(targetJid, msgParams);
    }
};

// --- ביצוע Flow ---
async function executeFlow(chatObj, flow, logId) {
    const minMs = flow.minDelayMinutes * 60 * 1000;
    const maxMs = flow.maxDelayMinutes * 60 * 1000;
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

    const scheduledTime = new Date(Date.now() + delay);
    await AutoReplyLog.findByIdAndUpdate(logId, { scheduledFor: scheduledTime });

    console.log(`⏳ [Flow] תוזמן לעוד ${delay / 1000} שניות.`);

    setTimeout(async () => {
        try {
            const jid = chatObj.id._serialized; 
            for (const step of flow.steps) {
                await sock.sendPresenceUpdate('composing', jid);
                await baileysDelay(2000); 
                await sock.sendPresenceUpdate('paused', jid);

                if (step.type === 'text') {
                    await sendMessageAdapter(jid, step.content);
                }
                else if (step.type === 'link') {
                    await sendMessageAdapter(jid, step.content);
                }
                else if (['image', 'video', 'document'].includes(step.type)) {
                    let media;
                    if (step.content.startsWith('/uploads')) {
                        const filename = step.content.replace('/uploads/files/', '').replace('/uploads/', '');
                        const possiblePaths = [
                            path.join('/var/www/zipori_uploads/files', filename),
                            path.join(process.cwd(), 'uploads/files', filename),
                            path.join(__dirname, '../uploads', filename)
                        ];
                        let filePathToUse = possiblePaths.find(p => fs.existsSync(p));
                        if (!filePathToUse) throw new Error(`File not found: ${filename}`);
                        media = MessageMedia.fromFilePath(filePathToUse);
                        if (step.type === 'document' && step.caption) media.filename = step.caption;
                    } else {
                        media = await MessageMedia.fromUrl(step.content);
                    }
                    await sendMessageAdapter(jid, media, { 
                        caption: (step.type !== 'document') ? (step.caption || '') : undefined,
                        sendAudioAsVoice: false 
                    });
                }
                await baileysDelay(3000);
            }
            await AutoReplyLog.findByIdAndUpdate(logId, { status: 'sent', sentAt: new Date() });
            console.log(`✅ [Flow] הסתיים בהצלחה.`);
        } catch (err) {
            console.error('❌ [Flow Error]:', err.message);
            await AutoReplyLog.findByIdAndUpdate(logId, { status: 'failed', errorMessage: err.message });
        }
    }, delay);
}

// ==========================================
// === 2. לוגיקה ראשית (Baileys) ===
// ==========================================

const startWhatsApp = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Zipori Server', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('QR RECEIVED');
            qrcode.generate(qr, { small: true });
            if (ioInstance) ioInstance.emit('whatsapp_qr', qr);
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp();
            else if (ioInstance) ioInstance.emit('whatsapp_disconnected');
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected (Baileys)!');
            if (ioInstance) ioInstance.emit('whatsapp_ready');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            // ==========================================================
            // 🛑 תיקון קריטי: סינון קבוצות, סטטוסים וערוצים 🛑
            // ==========================================================
            const jid = msg.key.remoteJid || '';

            // 1. סינון קבוצות (מסתיים ב-g.us)
            if (jid.endsWith('@g.us')) return;

            // 2. סינון סטטוסים/שידורים (פותר את הבעיה של הודעות ריקות מהמספר שלך)
            if (jid.includes('status@broadcast')) return;
            if (jid.includes('@broadcast')) return;

            // 3. סינון ערוצים (Newsletters)
            if (jid.includes('@newsletter')) return;
            // ==========================================================


            // 1. חילוץ טקסט
            const bodyRaw = getMessageContent(msg); 
            const bodyLower = bodyRaw.toLowerCase().trim();

            // 2. חילוץ מספר
            const finalPhone = extractTruePhoneNumber(msg);
            
            if (!finalPhone) return;

            const senderName = msg.pushName || "Unknown";
            const responseJid = `${finalPhone}@s.whatsapp.net`;

            console.log('-----------------------------------');
            console.log(`📩 הודעה חדשה:`);
            console.log(`   שם: ${senderName}`);
            console.log(`   טלפון: ${finalPhone}`);
            console.log(`   תוכן: "${bodyRaw}"`);
            console.log('-----------------------------------');

            // 🔥 בדיקה קריטית לפני השמירה: האם הייתה הודעה כלשהי (צ'אט) מהמספר הזה בחודש האחרון? 🔥
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            // אנחנו בודקים בטבלת ההודעות הגולמיות (WhatsAppMessage) ולא בטבלת הלידים!
            const hasRecentChatHistory = await WhatsAppMessage.findOne({
                remoteJid: responseJid,
                timestamp: { $gte: thirtyDaysAgo }
            });

            // ✨ שמירה לממשק ה-WhatsApp Clone (מתבצעת אחרי הבדיקה כדי לא לספור את ההודעה הנוכחית כהיסטוריה)
            if (bodyRaw) {
                await WhatsAppMessage.create({
                    remoteJid: responseJid,
                    fromMe: false,
                    text: bodyRaw,
                    pushName: senderName,
                    timestamp: new Date()
                });
            }

            const chatObj = {
                id: { _serialized: responseJid }, 
                name: senderName,
                sendMessage: async (content, options) => sendMessageAdapter(responseJid, content, options),
                sendStateTyping: async () => sock.sendPresenceUpdate('composing', responseJid),
                clearState: async () => sock.sendPresenceUpdate('paused', responseJid)
            };

            const activeFlows = await AutoReply.find({ isActive: true }).lean();
            const matchedFlow = activeFlows.find(f => f.triggerText && bodyLower.includes(f.triggerText.toLowerCase().trim()));

            let isBot = false;
            let referrer = null;

            if (matchedFlow) {
                isBot = true;
                await AutoReply.findByIdAndUpdate(matchedFlow._id, { $inc: { usageCount: 1 } });
                const newLog = await AutoReplyLog.create({
                    senderName, senderPhone: finalPhone, triggerText: matchedFlow.triggerText, fullMessage: bodyRaw, status: 'pending'
                });
                executeFlow(chatObj, matchedFlow, newLog._id);
            }

            const activeTriggers = await LeadTrigger.find({ isActive: true }).lean();
            const matchedTrigger = activeTriggers.find(t => bodyLower.includes(t.text));

            // ✨ תנאי הליד החדש: בוט, או טריגר, או שאין שום היסטוריית צ'אט בחודש האחרון
            if (isBot || matchedTrigger || !hasRecentChatHistory) {
                
                if (matchedTrigger) {
                    const idx = bodyLower.indexOf(matchedTrigger.text);
                    const rest = bodyRaw.substring(idx + matchedTrigger.text.length).trim();
                    if (rest) {
                        referrer = await getOfficialReferrerName(rest.split(/\s+/).slice(0, 2).join(' '));
                    }
                }

                // קביעת סוג הליד
                let leadType = 'General WhatsApp'; // ברירת מחדל לפנייה כללית
                if (matchedTrigger) leadType = 'WhatsApp Trigger';
                else if (isBot) leadType = 'WhatsApp Bot';

                // יצירת הליד (CRM)
                await InboundEmail.create({
                    from: senderName, 
                    type: leadType, 
                    body: bodyRaw || '(Media Message)',
                    receivedAt: new Date(),
                    status: isBot ? 'bot' : 'new',
                    parsedName: senderName, 
                    parsedPhone: finalPhone, 
                    
                    // הטקסט נכנס להערות
                    parsedNote: bodyRaw, 

                    referrer: referrer, 
                    hotel: null, 
                    handledBy: null
                });

                // עדכון כרטיס לקוח (Timeline)
                const newInboundMsg = await InboundEmail.findOne({ 
                    from: senderName, 
                    body: bodyRaw || '(Media Message)',
                    receivedAt: { $gte: new Date(Date.now() - 5000) }
                }).sort({ createdAt: -1 });

                await updateCustomerLog({
                    phone: finalPhone, 
                    name: senderName,
                    eventType: 'message_in',
                    description: `הודעה נכנסת: ${bodyRaw ? bodyRaw.substring(0, 50) + (bodyRaw.length > 50 ? '...' : '') : 'מדיה'}`,
                    metadata: { 
                        messageId: newInboundMsg ? newInboundMsg._id : null
                    }
                });

                if (!isBot) {
                    const pushBody = bodyRaw ? bodyRaw : 'New Media Message';
                    // שינוי קטן בכותרת כדי שתדע למה זה נוצר
                    const titlePrefix = !hasRecentChatHistory ? 'לקוח חדש/חוזר (ללא פעילות 30 יום)' : 'ליד חדש';
                    sendPushToAll({ title: `${titlePrefix}: ${senderName}`, body: pushBody, url: '/leads' });
                }
            }

        } catch (e) {
            console.error('Error processing message:', e);
        }
    });
};

// ==========================================
// === 3. ייצוא (Exports) ===
// ==========================================

export const initWhatsAppListener = (socketIo) => {
    ioInstance = socketIo;
    console.log('🔄 Starting WhatsApp Service (Baileys Engine)...');
    startWhatsApp();
};

export const getWhatsappLogs = async () => {
    try {
        const logs = await AutoReplyLog.find().sort({ createdAt: -1 }).limit(50);
        return logs;
    } catch (error) {
        console.error('Error fetching logs:', error);
        return [];
    }
};

export const sendWhatsAppMessage = async ({ chatId, text }) => {
    if (!sock) throw new Error('WhatsApp not connected');
    const jid = chatId.includes('@') ? chatId : `${chatId.replace(/\D/g, '')}@s.whatsapp.net`; 
    await sendMessageAdapter(jid, text);
};

export const getWhatsAppStatus = () => {
    return { isConnected: !!sock?.user, wid: sock?.user?.id, pushName: sock?.user?.name };
};

export const getClient = () => sock;

export const scanAndReplyToOldChats = async () => {
    return { message: "Scan not supported in Baileys migration yet." };
};