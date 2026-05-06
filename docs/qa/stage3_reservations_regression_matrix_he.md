# Stage 3 Reservations Regression Matrix (Pre-Implementation)

תאריך: 6 במאי 2026  
מטרה: בדיקות מקדימות לפני rollout הטמעות עומק במודול הזמנות.

## 1) הנחות

1. כל הבדיקות על בסיס הנתיב ` /api/pms/reservations `.
2. קיימים משתמשי בדיקה לכל role מרכזי:
1. `receptionist`
2. `front_desk_manager`
3. `sales_manager`
4. `finance_manager`
5. `property_admin`
6. `readonly_user` (אם קיים)
3. קיימים לפחות שני properties לבדיקת cross-tenant scope.
4. קיים dataset עם:
1. direct reservations
2. OTA reservations
3. multi-room reservations
4. split reservations
5. folio עם posted lines

## 2) פורמט בדיקה אחיד

לכל תרחיש נבדקים ארבעה מישורים:
1. `API`: קוד סטטוס + מבנה envelope.
2. `Authorization`: role/scope enforcement.
3. `Data`: collections שהושפעו.
4. `Audit`: נרשם event נכון עם actor.

## 3) קטלוג תרחישים

| ID | קבוצה | Endpoint | Preconditions | Expected |
|---|---|---|---|---|
| A-001 | Auth | `GET /` | ללא token | `401` |
| A-002 | Auth | `POST /` | ללא token | `401` |
| A-003 | Auth | `POST /:id/check-in` | token לא תקף | `401` |
| A-004 | Scope | `GET /:id` | token של property B, reservation של property A | `403` |
| A-005 | Scope | `PATCH /:id` | token של property B, reservation של property A | `403` |
| A-006 | Scope | `POST /:id/check-out` | token של property B, reservation של property A | `403` |
| A-007 | Scope | `POST /transfer-charges` | from/to reservations מ-property אחר | `403` או `400` בהתאם לנתיב |
| A-008 | Scope | `GET /rooms/:reservationRoomId/segments` | room שייך ל-property אחר | `403` |
| A-009 | Scope | `POST /availability/check` | propertyId מחוץ ל-scope | `403` |
| A-010 | Scope | `POST /:id/add-service` | reservation מחוץ ל-scope | `403` |
| B-001 | RBAC | `POST /` | role לא ב-COMMERCIAL | `403` |
| B-002 | RBAC | `POST /` עם `allowOverbooking=true` | role `receptionist` | `403` |
| B-003 | RBAC | `POST /` עם `allowOverbooking=true` | role `front_desk_manager` | `201` |
| B-004 | RBAC | `POST /:id/check-in` עם `overrideClean=true` | role `receptionist` | `403` |
| B-005 | RBAC | `POST /:id/check-in` עם `overrideClean=true` | role `front_desk_manager` | `200` |
| B-006 | RBAC | `POST /:id/check-out` עם `forceCheckout=true` | role `receptionist` | `403` |
| B-007 | RBAC | `POST /:id/check-out` עם `forceCheckout=true` | role `finance_manager` | `200` |
| B-008 | RBAC | `POST /:id/cancellation-fee` | role `receptionist` | `403` |
| B-009 | RBAC | `POST /:id/cancellation-fee` | role `finance_manager` | `201` |
| B-010 | RBAC | `POST /:id/no-show-fee` | role `receptionist` | `403` |
| B-011 | RBAC | `POST /:id/no-show-fee` | role `finance_manager` | `201` |
| B-012 | RBAC | `POST /:id/upgrade` | role `receptionist` | `403` |
| B-013 | RBAC | `POST /:id/upgrade` | role `front_desk_manager` | `200` |
| B-014 | RBAC | `POST /transfer-charges` | role לא High Priv checkout | `403` |
| C-001 | Lifecycle | `POST /:id/confirm` | status=`quote`, available inventory | `200`, status=`confirmed` |
| C-002 | Lifecycle | `POST /:id/confirm` | status לא מותר (למשל `checked_out`) | `400` |
| C-003 | Lifecycle | `POST /:id/check-in` | guest blacklisted | `400` |
| C-004 | Lifecycle | `POST /:id/check-in` | assigned room dirty, ללא override | `409` |
| C-005 | Lifecycle | `POST /:id/check-in` | flow תקין | `200`; Reservation=`in_house`; Room=`occupied` |
| C-006 | Lifecycle | `POST /:id/check-in` | flow תקין | Folio כולל room-night lines לכל לילה |
| C-007 | Lifecycle | `POST /:id/check-out` | folio balance>0, ללא force | `400` |
| C-008 | Lifecycle | `POST /:id/check-out` | folio balance>0, עם force והרשאה | `200` |
| C-009 | Lifecycle | `POST /:id/check-out` | flow תקין | Folio=`closed`; Room=`checked_out+dirty` |
| C-010 | Lifecycle | `POST /:id/check-out` | flow תקין | נוצר `HousekeepingTask` מסוג `checkout_clean` |
| C-011 | Lifecycle | `POST /:id/cancel` | reservation כבר `checked_out` | `400` |
| C-012 | Lifecycle | `POST /:id/cancel` | flow תקין | status=`cancelled`; reservationRooms=`cancelled` |
| C-013 | Lifecycle | `POST /:id/no-show` | flow תקין | status=`no_show`; reservationRooms=`no_show` |
| C-014 | Lifecycle | `POST /:id/partial-check-in` | חלק מהחדרים | status=`partially_checked_in` |
| C-015 | Lifecycle | `POST /:id/partial-check-out` | חלק מהחדרים | status=`partially_checked_out` |
| C-016 | Lifecycle | `POST /:id/partial-check-out` | כל החדרים | status=`checked_out`; checkedOutAt set |
| D-001 | Finance | `POST /:id/cancellation-fee` | amount<=0 | `400` |
| D-002 | Finance | `POST /:id/no-show-fee` | amount<=0 | `400` |
| D-003 | Finance | `POST /:id/cancellation-fee` | flow תקין | folio line `type=fee` נוסף |
| D-004 | Finance | `POST /:id/no-show-fee` | flow תקין | folio line `type=fee` נוסף |
| D-005 | Finance | `POST /:id/add-service` | reservation status=`cancelled` | `400` |
| D-006 | Finance | `POST /:id/add-service` | reservation status=`no_show` | `400` |
| D-007 | Finance | `POST /:id/add-service` | flow תקין | קו שירות מתווסף לפוליו (או כשל enum מזוהה עד תיקון) |
| D-008 | Finance | `POST /transfer-charges` | lineIds ריקים | `400` |
| D-009 | Finance | `POST /transfer-charges` | from/to ב-properties שונים | `400` |
| D-010 | Finance | `POST /transfer-charges` | flow תקין | source lines->voided; target lines->posted clones |
| D-011 | Finance | `POST /transfer-charges` | flow תקין | audit action=`folio.transfer_charges` |
| D-012 | Finance | `POST /:id/check-out` | flow תקין | folio close idempotent against retry |
| E-001 | Inventory | `POST /` | create confirmed reservation | bookedCount עולה לכל לילות השהייה |
| E-002 | Inventory | `POST /:id/cancel` | cancel confirmed reservation | bookedCount יורד לכל לילות השהייה |
| E-003 | Inventory | `POST /:id/no-show` | no-show | bookedCount יורד |
| E-004 | Inventory | `POST /:id/extend` | no availability בטווח חדש | `409` |
| E-005 | Inventory | `POST /:id/extend` | flow תקין | departure/nights/totals עודכנו; inventory הוגדל |
| E-006 | Inventory | `POST /:id/early-departure` | תאריך לא חוקי | `400` |
| E-007 | Inventory | `POST /:id/early-departure` | flow תקין | inventory released לטווח המקוצר |
| E-008 | Inventory | `POST /:id/rooms` | no availability | `409` |
| E-009 | Inventory | `POST /:id/rooms` | flow תקין | ReservationRoom+StaySegment נוצרו; totals עלו |
| E-010 | Inventory | `DELETE /rooms/:reservationRoomId` | flow תקין | inventory released; totals ירדו |
| F-001 | Search/Paging | `GET /?q=` | חיפוש בשם אורח עם pagination | לזהות פער `total` מול data אם קיים |
| F-002 | Search/Paging | `GET /?q=` | שם אורח בעמוד שאינו ראשון | לוודא שלא נעלם בגלל סינון אחרי limit |
| F-003 | Data Consistency | `POST /:id/merge` | כשל יזום באמצע flow | לבדוק orphan/inconsistent state |
| F-004 | Data Consistency | `POST /:id/split` | כשל יזום אחרי יצירת reservation חדש | לבדוק התאמות room lines/segments |
| F-005 | Reliability | `POST /:id/add-service` כפול מהיר | request כפול | לבדוק האם נוצרו כפילויות לא רצויות |
| F-006 | Reliability | `POST /:id/cancellation-fee` כפול מהיר | request כפול | לבדוק כפילויות fee |
| F-007 | Security | `POST /:id/express-checkout-link` | decode token | לוודא שאין מידע רגיש מעבר לנדרש |
| F-008 | Security | `POST /:id/express-checkout-link` | ניסיון reuse אחרי expiry | אמור להיכשל כאשר יאומץ מנגנון verify persisted |

## 4) Assertions לדאטה בכל תרחיש כתיבה

בכל תרחיש C/D/E/F עם כתיבה יש לבצע שאילתות אימות:
1. `Reservation` status/timestamps נכונים.
2. `ReservationRoom` statuses תואמים ל-top-level reservation.
3. `Room` occ/clean status תואם lifecycle.
4. `Folio.lines` ומאזנים עקביים (posted/voided).
5. `InventoryDate.bookedCount` השתנה בדיוק בטווח התאריכים הנכון.
6. `AuditLog` מכיל action מתאים עם actor/property/entityId.

## 5) Smoke Suite מוצעת ל-CI לפני כל מיזוג

1. `B-004`, `B-006`, `B-009`, `B-013`
2. `C-005`, `C-007`, `C-009`, `C-012`, `C-013`
3. `D-003`, `D-007`, `D-010`
4. `E-001`, `E-002`, `E-005`, `E-010`
5. `F-001`, `F-003`

## 6) Exit Criteria לשלב הטמעה

1. כל תרחישי High Risk (`C`, `D`, `E`, `F-003/F-004`) עברו.
2. אין תרחיש עם orphan update בין Reservation/Folio/Room/ReservationRoom.
3. RBAC ו-scope מגיבים `403` בכל תרחיש של גישה לא מורשית.
4. אין פערי inventory לא מוסברים לאחר תרחישי cancel/no-show/extend/early-departure.
5. הבעיות הקריטיות מ-Preflight Findings נסגרו או קיבלו mitigation מפורש.

