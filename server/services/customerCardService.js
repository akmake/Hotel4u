import CustomerCard from '../models/CustomerCard.js';

// פונקציה לניקוי מספרי טלפון (מונע כפילויות של 050-123 מול 050123)
const normalizePhone = (phone) => {
    if (!phone) return '';
    let clean = phone.replace(/\D/g, '');
    // המרה לפורמט ישראלי אחיד
    if (clean.startsWith('972')) clean = '0' + clean.slice(3);
    if (!clean.startsWith('0') && clean.length === 9) clean = '0' + clean;
    return clean;
};

export const updateCustomerLog = async ({ phone, name, email, eventType, description, metadata = {}, eventDate = null }) => {
    try {
        if (!phone) return;

        const cleanPhone = normalizePhone(phone);
        
        // שלב 1: מציאת הכרטיס (או לפי טלפון או לפי מייל)
        let card = await CustomerCard.findOne({ 
            $or: [
                { phone: cleanPhone },
                { email: email && email.length > 5 ? email : 'non_existent_email' }
            ]
        });

        // שלב 2: אם לא קיים - יוצרים חדש
        if (!card) {
            card = new CustomerCard({
                phone: cleanPhone,
                name: name || 'לקוח חדש',
                email: email || '',
                timeline: []
            });
        }

        // שלב 3: עדכון פרטים כלליים (אם השם החדש ארוך/ברור יותר מהישן)
        if (name && (!card.name || card.name === 'לקוח חדש' || card.name.length < name.length)) {
            card.name = name;
        }
        if (email && !card.email) {
            card.email = email;
        }

        // שלב 4: הוספת האירוע להיסטוריה
        // ה-timestamp הוא תמיד "עכשיו" כדי לדעת מתי השינוי קרה בפועל
        card.timeline.push({
            type: eventType,
            description: description || 'עדכון מערכת',
            metadata,
            timestamp: new Date()
        });

        // שלב 5: ניהול "תאריך המיקוד" (כדי לסדר את הרשימה בדף הראשי)
        // אם התקבל תאריך אירוע (למשל תאריך הגעה עתידי) - הוא הקובע!
        if (eventDate) {
            card.lastEventDate = new Date(eventDate);
        } else {
            // אם זה סתם הודעה, מעדכנים להיום, אבל רק אם התאריך הנוכחי בכרטיס הוא לא עתידי
            // (כדי לא לדרוס הזמנה לעוד חודש עם הודעת "היי" מהיום)
            const now = new Date();
            if (!card.lastEventDate || card.lastEventDate < now) {
                card.lastEventDate = now;
            }
        }

        // שלב 6: ניהול מחזור חיים (פעיל / ארכיון)
        if (eventType === 'order_created') {
            card.lifecycleStage = 'active_order';
        } 
        else if (eventType === 'status_change') {
            const descLower = description.toLowerCase();
            
            // ארכיון: בוצע או בוטל
            if (descLower.includes('בוצע') || descLower.includes('placed') || descLower.includes('אושר')) {
                card.lifecycleStage = 'past_customer'; 
            } 
            else if (descLower.includes('לא רלוונטי') || descLower.includes('בוטל') || descLower.includes('cancelled')) {
                card.lifecycleStage = 'cold'; 
            }
            // פעיל: בכל שאר המצבים (הצעה, בטיפול וכו')
            else {
                card.lifecycleStage = 'active_order';
            }
        }
        // אם לקוח ישן שלח הודעה חדשה - מקפיצים אותו חזרה ל"חדש"
        else if (eventType === 'message_in' && (card.lifecycleStage === 'cold' || card.lifecycleStage === 'past_customer')) {
            const lastActivity = card.updatedAt;
            const oneDay = 1000 * 60 * 60 * 24;
            // רק אם עבר יום מהפעילות האחרונה (כדי לא להקפיץ על כל פיפס)
            if (new Date() - lastActivity > oneDay) {
                card.lifecycleStage = 'new';
                // אם התאריך הקובע הוא בעבר, מקפיצים להיום
                if (!card.lastEventDate || card.lastEventDate < new Date()) {
                    card.lastEventDate = new Date();
                }
            }
        }

        await card.save();
        console.log(`✔ Customer Updated: ${cleanPhone} | Stage: ${card.lifecycleStage}`);

    } catch (error) {
        console.error(`❌ Error updating customer card:`, error);
    }
};