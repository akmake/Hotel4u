import mongoose from 'mongoose';

const whatsappMessageSchema = new mongoose.Schema({
  remoteJid: { type: String, required: true, index: true }, // המספר של הלקוח (למשל 97250...@s.whatsapp.net)
  fromMe: { type: Boolean, required: true }, // האם אני שלחתי או הוא?
  text: { type: String, required: false }, // תוכן ההודעה
  timestamp: { type: Date, default: Date.now }, // מתי נשלח
  status: { type: String, default: 'sent' }, // sent, delivered, read
  pushName: { type: String } // השם של הלקוח בוואטסאפ
});

export default mongoose.model('WhatsAppMessage', whatsappMessageSchema);