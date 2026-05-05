const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
// const User = require('../models/User'); // שחרר את ההערה כשתחבר למודל שלך

// POST: העלאת תמונה
router.post('/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // --- יצירת ה-URL לשמירה ב-DB ---
        // הפורמט הזה עובד מושלם עם ה-Nginx שהגדרנו
        const relativePath = `/uploads/images/${req.file.filename}`;

        // דוגמה לשמירה ב-DB (התאם למודל שלך):
        // const userId = req.user._id;
        // await User.findByIdAndUpdate(userId, { profilePic: relativePath });

        res.status(200).json({
            message: 'Image uploaded successfully',
            filePath: relativePath, // זה מה שהפרונט צריך לשים ב-src
            fullUrl: `${req.protocol}://${req.get('host')}${relativePath}` // למקרה שצריך נתיב מלא
        });

    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;