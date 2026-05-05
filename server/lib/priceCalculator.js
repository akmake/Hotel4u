// server/lib/priceCalculator.js (וגם ב-client/src/lib - יש לוודא זהות!)

// היררכיית מחירים: מי נחשב "יקר" יותר בחדר
const guestHierarchy = {
  adult: { priceKey: 'teen', order: 1 },
  teen: { priceKey: 'teen', order: 2 },
  child: { priceKey: 'child', order: 3 },
};

/**
 * מחשב מחיר בסיס *לחבילה* עבור הרכב אורחים ומחירון ספציפי.
 * (לא מוכפל בלילות - המחיר במחירון הוא המחיר הסופי להרכב זה)
 */
export function calculateSinglePackageBasePrice(room, priceList) {
  const { adults = 0, teens = 0, children = 0, babies = 0 } = room;

  // 1. תינוקות: תוספת קבועה (בדרך כלל למחיר כולל)
  const babyCost = babies * (priceList.baby || 0);

  // 2. קבוצה עיקרית (ללא תינוקות)
  const mainGroupSize = adults + teens + children;
  let mainGroupPrice = 0;

  if (mainGroupSize === 0) {
    mainGroupPrice = 0;
  } else if (mainGroupSize === 1) {
    // מחיר יחיד בחדר
    mainGroupPrice = priceList.single_room || 0;
  } else {
    // זוג ומעלה
    // ממיינים כדי ששני ה"יקרים" ביותר יתפסו את מחיר ה"זוג"
    const guests = [
      ...Array(adults).fill('adult'),
      ...Array(teens).fill('teen'),
      ...Array(children).fill('child'),
    ];

    guests.sort((a, b) => guestHierarchy[a].order - guestHierarchy[b].order);

    // מחיר הבסיס לזוג (מחיר החבילה)
    mainGroupPrice = priceList.couple || 0;

    // תוספות עבור כל אדם מעבר לזוג (החל מהאדם השלישי)
    for (let i = 2; i < guests.length; i++) {
      const guestType = guests[i];
      const priceKey = guestHierarchy[guestType].priceKey;
      mainGroupPrice += (priceList[priceKey] || 0);
    }
  }

  return mainGroupPrice + babyCost;
}

/**
 * הפונקציה הראשית לחישוב מחיר חדר.
 * משקללת: 
 * 1. מחירונים נבחרים (מחיר פיקס לחבילה)
 * 2. תוספת סוג חדר * מספר הלילות (רק התוספת מוכפלת!)
 * * @param {Object} room - אובייקט החדר (כמויות אורחים)
 * @param {Object} allPriceLists - מפה של כל המחירונים הזמינים
 * @param {Array} selectedNames - מערך שמות המחירונים שנבחרו לחדר זה
 * @param {Number} nights - מספר הלילות בהזמנה
 * @param {Number} roomSupplementPerNight - תוספת שקלית *ללילה* עבור סוג החדר
 */
export function calculateRoomTotalPrice(room, allPriceLists, selectedNames, nights = 1, roomSupplementPerNight = 0) {
    if (!allPriceLists || !selectedNames || selectedNames.length === 0) {
        return 0;
    }

    let totalPackageBasePrice = 0;

    // סיכום מחירי החבילה מכל המחירונים שנבחרו
    // (הנחה: המחיר במחירון הוא גלובלי לכל התקופה, כמו שביקשת)
    for (const name of selectedNames) {
        const priceList = allPriceLists[name];
        if (priceList) {
            totalPackageBasePrice += calculateSinglePackageBasePrice(room, priceList);
        }
    }

    // חישוב תוספת סוג החדר (ג'קוזי/מרפסת) כפול מספר הלילות
    const totalSupplement = roomSupplementPerNight * nights;

    // המחיר הסופי = מחיר החבילה + (תוספת חדר * לילות)
    return totalPackageBasePrice + totalSupplement;
}
