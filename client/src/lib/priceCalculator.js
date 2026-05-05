// client/src/lib/priceCalculator.js

// היררכיית מחירים: מי נחשב "יקר" יותר בחדר
const guestHierarchy = {
  adult: { priceKey: 'teen', order: 1 },
  teen: { priceKey: 'teen', order: 2 },
  child: { priceKey: 'child', order: 3 },
};

/**
 * מחשב מחיר בסיס *לחבילה* (ללא הכפלה בלילות)
 * פונקציה פנימית - לא שינינו את הלוגיקה שלה
 */
export function calculateSinglePackageBasePrice(room, priceList) {
  const { adults = 0, teens = 0, children = 0, babies = 0 } = room;

  // 1. תינוקות: תוספת קבועה
  const babyCost = babies * (priceList.baby || 0);

  // 2. קבוצה עיקרית (ללא תינוקות)
  const mainGroupSize = adults + teens + children;
  let mainGroupPrice = 0;

  if (mainGroupSize === 0) {
    mainGroupPrice = 0;
  } else if (mainGroupSize === 1) {
    // מחיר יחיד בחדר (מחיר חבילה ליחיד)
    mainGroupPrice = priceList.single_room || 0;
  } else {
    // זוג ומעלה - ממיינים מהיקר לזול
    const guests = [
      ...Array(adults).fill('adult'),
      ...Array(teens).fill('teen'),
      ...Array(children).fill('child'),
    ];

    guests.sort((a, b) => guestHierarchy[a].order - guestHierarchy[b].order);

    // מחיר הבסיס לזוג (מחיר החבילה לזוג)
    mainGroupPrice = priceList.couple || 0;

    // תוספות עבור כל אדם מעבר לזוג
    for (let i = 2; i < guests.length; i++) {
      const guestType = guests[i];
      const priceKey = guestHierarchy[guestType].priceKey;
      mainGroupPrice += (priceList[priceKey] || 0);
    }
  }

  return mainGroupPrice + babyCost;
}

/**
 * הפונקציה הראשית לחישוב מחיר חדר (Client Side)
 * ✨ מתוקנת למניעת קריסות (תומכת גם במערך וגם באובייקט)
 */
export function calculateRoomTotalPrice(room, allPriceLists, selectedNames, nights = 1, roomSupplementPerNight = 0) {
    // הגנה בסיסית: אם אין מחירונים או שמות, אין מה לחשב
    if (!allPriceLists || !selectedNames || selectedNames.length === 0) {
        return (roomSupplementPerNight || 0) * nights;
    }

    // 🛑 התיקון הקריטי: 
    // אנחנו מנרמלים את allPriceLists למערך שטוח.
    // ככה לא משנה אם קיבלנו Object (מ-OrderPage) או Array (מ-OrderSummaryTable),
    // אנחנו תמיד נעבוד עם מערך תקין.
    const safePriceLists = Array.isArray(allPriceLists) 
        ? allPriceLists 
        : Object.values(allPriceLists || {});

    let totalPackageBasePrice = 0;

    // סיכום מחירי החבילה מכל המחירונים שנבחרו
    for (const name of selectedNames) {
        // במקום לגשת ישירות [name] (שנכשל אם זה מערך), אנחנו מחפשים ברשימה הבטוחה
        const priceList = safePriceLists.find(pl => pl.name === name);
        
        if (priceList) {
            totalPackageBasePrice += calculateSinglePackageBasePrice(room, priceList);
        }
    }

    // חישוב תוספת סוג החדר (ג'קוזי/מרפסת) כפול מספר הלילות
    const totalSupplement = roomSupplementPerNight * nights;

    // המחיר הסופי = מחיר החבילה + (תוספת חדר * לילות)
    return totalPackageBasePrice + totalSupplement;
}