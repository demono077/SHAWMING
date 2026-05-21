const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./db');
const fs = require('fs');

// تهيئة البوت
const bot = new TelegramBot(config.token, { polling: true });

// متغير لتتبع حالة الإذاعة للمطور
let adminState = {};

// خدعة برمجية لمنع تلف الروابط أثناء النسخ واللصق
const tgLink = "https://" + "t.me/";

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
        [{ text: "➕ إضافة أصدقائي", url: tgLink + config.group1, style: 'danger' }],
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
    });
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
            [{ text: "➕ إضافة أصدقائي", url: tgLink + config.group1, style: 'danger' }],
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

    if (adminState[userId] === "WAITING_FOR_BROADCAST_MSG") {
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

// مراقبة الجروبات لمعرفة من قام بالانضمام أو إضافة أعضاء
bot.on('message', (msg) => {
    if (msg.chat.type !== 'private' && msg.new_chat_members) {
        const adderId = msg.from.id;
        const adderName = msg.from.first_name;
        
        // تحديد مسار الزر بناءً على اسم الجروب الذي تم إرسال الرسالة فيه
        let buttonUrl = "";
        if (msg.chat.username && msg.chat.username.toLowerCase() === config.group1.toLowerCase()) {
            // لو كنا في الجروب الأول، الزر يودي للجروب الثاني
            buttonUrl = tgLink + config.group2;
        } else {
            // لو كنا في الجروب الثاني (أو أي جروب آخر)، الزر يفتح الملف الشخصي للجروب الثاني للإضافة
            buttonUrl = "tg://resolve?domain=" + config.group2;
        }

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

        // 1. إذا انضم المستخدم بنفسه
        if (selfJoin) {
            const user = db.getUser(adderId, adderName);
            const remaining = Math.max(0, config.targetMembers - user.addedCount);

            const welcomeGroupMsg = "⚠️ المستخدم **" + adderName + "** ضاف 0 عضو جديد\n✅ المجموع الحالي: " + user.addedCount + " عضو\n♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n🔥 الفاضل: " + remaining + " عضو";

            bot.sendMessage(msg.chat.id, welcomeGroupMsg, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ اضف اعضاء", url: buttonUrl, style: 'danger' }]
                    ]
                }
            });
        }

        // 2. إذا قام المستخدم بإضافة أعضاء آخرين
        if (addedRealMembersCount > 0) {
            // ملاحظة: يتم احتساب النقاط بغض النظر عن الجروب الذي يضيف فيه طالما البوت أدمن، لكن المنطق يوجههم للجروب الثاني
            const updatedUser = db.addPoints(adderId, adderName, addedRealMembersCount);
            const remaining = Math.max(0, config.targetMembers - updatedUser.addedCount);

            const groupMsg = "⚠️ المستخدم **" + adderName + "** ضاف " + addedRealMembersCount + " عضو جديد\n✅ المجموع الحالي: " + updatedUser.addedCount + " عضو\n♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n🔥 الفاضل: " + remaining + " عضو";

            bot.sendMessage(msg.chat.id, groupMsg, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ اضف اعضاء", url: buttonUrl, style: 'danger' }]
                    ]
                }
            });

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