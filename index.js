const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./db');
const fs = require('fs');

// تهيئة البوت
const bot = new TelegramBot(config.token, { polling: true });

// متغير لتتبع حالة الإذاعة للمطور
let adminState = {};

// لتفادي تكرار رسالة الانضمام بين new_chat_members و chat_member
const processedJoinEvents = new Map();

// خدعة برمجية لمنع تلف الروابط أثناء النسخ واللصق
const tgLink = "https://" + "t.me/";

// دالة مساعدة لبناء رابط الجروب
function getGroupLink(group) {
    return tgLink + String(group || '').replace('@', '');
}

// دالة مساعدة لبناء الأزرار الخاصة بإضافة الأعضاء
function buildJoinKeyboard(buttonUrl) {
    return {
        inline_keyboard: [
            [{ text: "➕ اضف اعضاء", url: buttonUrl, style: 'danger' }]
        ]
    };
}

// دالة مساعدة لتحديد هل تم التعامل مع حدث الانضمام مسبقًا
function claimJoinEvent(chatId, userId) {
    const key = `${chatId}:${userId}`;
    const now = Date.now();
    const ttl = 4000;

    for (const [storedKey, expiresAt] of processedJoinEvents.entries()) {
        if (expiresAt <= now) {
            processedJoinEvents.delete(storedKey);
        }
    }

    if (processedJoinEvents.has(key)) {
        return false;
    }

    processedJoinEvents.set(key, now + ttl);
    return true;
}

// دالة لمعالجة رسالة /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fullName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');

    // التحقق من أن الرسالة في الخاص وليست في جروب
    if (msg.chat.type !== 'private') return;

    // تسجيل المستخدم في قاعدة البيانات
    db.getUser(userId, fullName);

    const welcomeMessage = "أهلاً يا **" + fullName + "**\n\n🎯 المطلوب لدخول الجروب السري: " + config.targetMembers + " عضو\n\nبالتوفيق للجميع ❤️";

    // الأزرار الأساسية (توجه المستخدم للجروب الأول كبداية)
    let keyboard = [
        [{ text: "➕ إضافة أصدقائي", url: getGroupLink(config.group1), style: 'danger' }],
        [{ text: "📊 إحصائياتي", callback_data: "my_stats", style: 'danger' }]
    ];

    // إضافة أزرار المطور
    if (userId.toString() === config.adminId.toString()) {
        keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db", style: 'danger' }]);
        keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast", style: 'danger' }]);
    }

    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: keyboard
        }
    }).catch(err => console.error("خطأ في إرسال رسالة الترحيب:", err.message));
});

// معالجة الضغط على الأزرار (Callback Queries)
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const fullName = query.from.first_name;

    if (data === "my_stats") {
        const user = db.getUser(userId, fullName);
        const remaining = Math.max(0, config.targetMembers - user.addedCount);

        const statsMsg = "📊 **إحصائياتك الحالية:**\n\n✅ عدد إضافاتك: " + user.addedCount + "\n🎯 الهدف: " + config.targetMembers + "\n🔥 المتبقي لك: " + remaining + " عضو\n\n🚀 استمر في الإضافة لفتح الرابط السري!";

        bot.editMessageText(statsMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "back_to_start", style: 'danger' }]]
            }
        });
    }
    else if (data === "back_to_start") {
        const welcomeMessage = "أهلاً يا **" + fullName + "**\n\n🎯 المطلوب لدخول الجروب السري: " + config.targetMembers + " عضو\n\nبالتوفيق للجميع ❤️";
        let keyboard = [
            [{ text: "➕ إضافة أصدقائي", url: getGroupLink(config.group1), style: 'danger' }],
            [{ text: "📊 إحصائياتي", callback_data: "my_stats", style: 'danger' }]
        ];
        if (userId.toString() === config.adminId.toString()) {
            keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db", style: 'danger' }]);
            keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast", style: 'danger' }]);
        }
        bot.editMessageText(welcomeMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    // أوامر المطور
    else if (data === "download_db" && userId.toString() === config.adminId.toString()) {
        bot.sendDocument(chatId, './db.json', { caption: "📁 تفضل، هذه أحدث نسخة من قاعدة البيانات الخاصة بالمستخدمين." });
    }
    else if (data === "broadcast" && userId.toString() === config.adminId.toString()) {
        adminState[userId] = "WAITING_FOR_BROADCAST_MSG";
        bot.sendMessage(chatId, "📢 قم بإرسال الرسالة الآن (نص، صورة، فيديو، الخ..). سيتم إرسالها لجميع مستخدمين البوت.\nلإلغاء الإذاعة أرسل كلمة الغاء", { parse_mode: "Markdown" });
    }

    bot.answerCallbackQuery(query.id);
});

// معالجة الإذاعة للمطور
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (adminState[userId] === "WAITING_FOR_BROADCAST_MSG" && msg.chat.type === 'private') {
        if (msg.text && msg.text.includes("الغاء")) {
            adminState[userId] = null;
            return bot.sendMessage(chatId, "تم إلغاء الإذاعة بنجاح.");
        }

        const users = db.getAllUsers();
        const userIds = Object.keys(users);

        bot.sendMessage(chatId, "⏳ جاري إرسال الإذاعة إلى " + userIds.length + " مستخدم...");
        adminState[userId] = null;

        let successCount = 0;
        let failCount = 0;

        for (const id of userIds) {
            try {
                await bot.copyMessage(id, chatId, msg.message_id);
                successCount++;
            } catch (err) {
                failCount++;
            }
        }

        bot.sendMessage(chatId, "✅ **اكتملت الإذاعة!**\n\nنجح الإرسال لـ: " + successCount + "\nفشل الإرسال لـ: " + failCount + " (حظروا البوت)", { parse_mode: "Markdown" });
    }
});

// استقبال فوري إضافي عند تغيّر حالة العضو في الجروب (مسار احتياطي)
bot.on('chat_member', async (update) => {
    try {
        if (!update || !update.chat || !update.from || !update.new_chat_member) return;
        if (update.chat.type === 'private') return;

        const chatId = update.chat.id;
        const adderId = update.from.id;
        const adderName = update.from.first_name || 'مستخدم';

        const oldStatus = update.old_chat_member && update.old_chat_member.status ? update.old_chat_member.status : null;
        const newStatus = update.new_chat_member.status;

        if (oldStatus !== 'left' || newStatus !== 'member') return;

        if (!claimJoinEvent(chatId, adderId)) return;

        const user = db.getUser(adderId, adderName);
        const remaining = Math.max(0, config.targetMembers - user.addedCount);

        const buttonUrl = getGroupLink(config.group2);

        const welcomeGroupMsg = "⚠️ المستخدم **" + adderName + "** ضاف 0 عضو جديد\n✅ المجموع الحالي: " + user.addedCount + " عضو\n♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n🔥 الفاضل: " + remaining + " عضو";

        await bot.sendMessage(chatId, welcomeGroupMsg, {
            parse_mode: "Markdown",
            reply_markup: buildJoinKeyboard(buttonUrl)
        }).catch(err => console.log("خطأ في إرسال الرسالة بالجروب:", err.message));

        bot.answerCallbackQuery && bot.answerCallbackQuery(update.id).catch(() => {});
    } catch (err) {
        console.log("خطأ chat_member:", err.message);
    }
});

// مراقبة الجروبات لمعرفة من قام بالانضمام أو إضافة أعضاء
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' && msg.new_chat_members) {
        const adderId = msg.from.id;
        const adderName = msg.from.first_name;

        // جميع الأزرار داخل الجروبات ستوجه المستخدم للجروب الثاني الخاص بالإضافة
        const buttonUrl = getGroupLink(config.group2);

        db.getUser(adderId, adderName);

        let addedRealMembersCount = 0;
        let selfJoin = false;

        msg.new_chat_members.forEach(member => {
            if (member.id === adderId) {
                selfJoin = true;
            } else if (!member.is_bot) {
                addedRealMembersCount++;
            }
        });

        // 1. إذا انضم المستخدم بنفسه لأي من الجروبين
        if (selfJoin) {
            if (!claimJoinEvent(msg.chat.id, adderId)) {
                // لو تم التعامل معه من chat_member بالفعل، لا نكرر الرسالة
            } else {
                const user = db.getUser(adderId, adderName);
                const remaining = Math.max(0, config.targetMembers - user.addedCount);

                const welcomeGroupMsg = "⚠️ المستخدم **" + adderName + "** ضاف 0 عضو جديد\n✅ المجموع الحالي: " + user.addedCount + " عضو\n♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n🔥 الفاضل: " + remaining + " عضو";

                await bot.sendMessage(msg.chat.id, welcomeGroupMsg, {
                    parse_mode: "Markdown",
                    reply_markup: buildJoinKeyboard(buttonUrl)
                }).catch(err => console.log("خطأ في إرسال الرسالة بالجروب:", err.message));
            }
        }

        // 2. إذا قام المستخدم بإضافة أعضاء آخرين
        if (addedRealMembersCount > 0) {
            const updatedUser = db.addPoints(adderId, adderName, addedRealMembersCount);
            const remaining = Math.max(0, config.targetMembers - updatedUser.addedCount);

            const groupMsg = "⚠️ المستخدم **" + adderName + "** ضاف " + addedRealMembersCount + " عضو جديد\n✅ المجموع الحالي: " + updatedUser.addedCount + " عضو\n♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n🔥 الفاضل: " + remaining + " عضو";

            await bot.sendMessage(msg.chat.id, groupMsg, {
                parse_mode: "Markdown",
                reply_markup: buildJoinKeyboard(buttonUrl)
            }).catch(err => console.log("خطأ في إرسال الرسالة بالجروب:", err.message));

            // تسليم الجروب السري إذا تم إكمال الهدف
            if (updatedUser.addedCount >= config.targetMembers && !updatedUser.reachedTarget) {
                const rewardMsg = "🎉 **ألف مبروك!** لقد أكملت إضافة " + config.targetMembers + " عضو.\n\nتفضل رابط الجروب السري الخاص بك:\n" + config.secretGroupLink + "\n\nيُرجى عدم مشاركة الرابط مع أحد.";

                bot.sendMessage(adderId, rewardMsg, { parse_mode: "Markdown" })
                    .then(() => {
                        db.setTargetReached(adderId);
                    })
                    .catch((err) => {
                        console.log("فشل إرسال الرابط السري للمستخدم " + adderId + "، ربما لم يقم بتشغيل البوت في الخاص.");
                    });
            }
        }
    }
});

console.log("✅ البوت يعمل بنجاح...");