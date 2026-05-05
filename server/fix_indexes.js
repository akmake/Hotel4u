import mongoose from 'mongoose';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🔵 --- תיקון אינדקסים ידני ---');
console.log('כדי למנוע בעיות של נתיבים, אנא העתק את ה-CONNECTION STRING שלך (MONGODB_URI)');
console.log('מתוך קובץ ה-.env והדבק אותו כאן.');

rl.question('\n👉 הדבק את הכתובת כאן ולחץ Enter: ', async (uri) => {
  const cleanUri = uri.trim(); // מנקה רווחים אם נכנסו בטעות
  
  if (!cleanUri) {
      console.log('❌ לא הזנת כתובת! נסה שוב.');
      process.exit(1);
  }

  try {
      console.log('🔄 מנסה להתחבר...');
      await mongoose.connect(cleanUri);
      console.log('✅ מחובר בהצלחה!');
      
      const collection = mongoose.connection.collection('pricelists');
      console.log('🔍 מחפש את האינדקס הישן (name_1)...');

      // בדיקת קיום האינדקס
      const indexes = await collection.indexes();
      const indexExists = indexes.some(idx => idx.name === 'name_1');

      if (!indexExists) {
          console.log('⚠️ האינדקס "name_1" לא נמצא. כנראה שהוא כבר נמחק. הכל תקין.');
      } else {
          await collection.dropIndex('name_1');
          console.log('✅✅✅ הצלחה! האינדקס הישן נמחק.');
      }

  } catch (err) {
      if (err.code === 27) {
          console.log('⚠️ האינדקס כבר נמחק. הכל טוב.');
      } else {
          console.error('❌ שגיאה בהתחברות או במחיקה:', err.message);
      }
  } finally {
      if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
      }
      console.log('👋 סיימנו. אתה יכול להפעיל מחדש את השרת.');
      process.exit(0);
  }
});