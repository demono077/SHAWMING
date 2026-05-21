const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');

// التأكد من وجود ملف قاعدة البيانات، وإن لم يوجد يتم إنشاؤه
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({}));
}

// قراءة البيانات
function readDB() {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("خطأ في قراءة قاعدة البيانات:", error);
        return {};
    }
}

// حفظ البيانات
function writeDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));
    } catch (error) {
        console.error("خطأ في حفظ قاعدة البيانات:", error);
    }
}

// الحصول على بيانات مستخدم (أو إنشائه إن لم يكن موجوداً)
function getUser(userId, fullName) {
    const db = readDB();
    if (!db[userId]) {
        db[userId] = {
            name: fullName,
            addedCount: 0,
            reachedTarget: false
        };
        writeDB(db);
    }
    return db[userId];
}

// إضافة رصيد للمستخدم
function addPoints(userId, fullName, pointsToAdd) {
    const db = readDB();
    if (!db[userId]) {
        db[userId] = { name: fullName, addedCount: 0, reachedTarget: false };
    }
    db[userId].addedCount += pointsToAdd;
    writeDB(db);
    return db[userId];
}

// تحديث حالة المستخدم بأنه استلم الرابط
function setTargetReached(userId) {
    const db = readDB();
    if (db[userId]) {
        db[userId].reachedTarget = true;
        writeDB(db);
    }
}

// الحصول على جميع المستخدمين (مفيد للإذاعة)
function getAllUsers() {
    return readDB();
}

module.exports = {
    getUser,
    addPoints,
    setTargetReached,
    getAllUsers
};
