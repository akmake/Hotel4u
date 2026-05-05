import WhatsAppMessage from '../models/WhatsAppMessage.js';
import { getClient } from '../services/whatsappService.js'; // נוודא שיש לך יצוא כזה מהסרוויס

// 1. קבלת רשימת כל אנשי הקשר שדיברו איתנו (מסודר לפי האחרון)
export const getChatList = async (req, res) => {
  try {
    const chats = await WhatsAppMessage.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$remoteJid",
          lastMessage: { $first: "$text" },
          timestamp: { $first: "$timestamp" },
          pushName: { $first: "$pushName" },
          count: { $sum: 1 }
        }
      },
      { $sort: { timestamp: -1 } }
    ]);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: "Error fetching chats" });
  }
};

// 2. קבלת היסטוריית הודעות עם מספר ספציפי
export const getMessagesByNumber = async (req, res) => {
  try {
    const { number } = req.params; // המספר המלא כולל ה-@s.whatsapp.net
    const messages = await WhatsAppMessage.find({ remoteJid: number }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages" });
  }
};

// 3. שליחת הודעה דרך המערכת ושמירה ב-DB
export const sendMessage = async (req, res) => {
  try {
    const { to, text } = req.body;
    const client = getClient(); // מביא את החיבור של Baileys

    if (!client) return res.status(500).json({ message: "WhatsApp not connected" });

    // שליחה בוואטסאפ
    await client.sendMessage(to, { text });

    // שמירה ב-DB שלנו כדי שיופיע בצ'אט
    const newMessage = await WhatsAppMessage.create({
      remoteJid: to,
      fromMe: true,
      text: text,
      timestamp: new Date()
    });

    res.json(newMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send message" });
  }
};