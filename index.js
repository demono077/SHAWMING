const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./db');
const fs = require('fs');

// تهيئة البوت
const bot = new TelegramBot(config.token, { polling: true });

// متغير لتتبع حالة الإذاعة للمطور
let adminState = {};

// دالة لمعالجة رسالة /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fullName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');

    // التحقق من أن الرسالة في الخاص وليست في جروب
    if (msg.chat.type !== 'private') return;

    // تسجيل المستخدم في قاعدة البيانات
    db.getUser(userId, fullName);

    const welcomeMessage = `أهلاً يا **${fullName}**\n\n🎯 المطلوب لدخول الجروب السري: ${config.targetMembers} عضو\n\nبالتوفيق للجميع ❤️`;

    // الأزرار الأساسية للمستخدم
    let keyboard = [
        [{ text: "➕ إضافة أصدقائي", url: `https://t.me/${config.addGroupUsername}` }],
        [{ text: "📊 إحصائياتي", callback_data: "my_stats" }]
    ];

    // إضافة أزرار المطور إذا كان المستخدم هو المطور
    if (userId.toString() === config.adminId.toString()) {
        keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db" }]);
        keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast" }]);
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
        
        const statsMsg = `📊 **إحصائياتك الحالية:**\n\n✅ عدد إضافاتك: ${user.addedCount}\n🎯 الهدف: ${config.targetMembers}\n🔥 المتبقي لك: ${remaining} عضو\n\n🚀 استمر في الإضافة لفتح الرابط السري!`;
        
        bot.editMessageText(statsMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "back_to_start" }]]
            }
        });
    } 
    else if (data === "back_to_start") {
        const welcomeMessage = `أهلاً يا **${fullName}**\n\n🎯 المطلوب لدخول الجروب السري: ${config.targetMembers} عضو\n\nبالتوفيق للجميع ❤️`;
        let keyboard = [
            [{ text: "➕ إضافة أصدقائي", url: `https://t.me/${config.addGroupUsername}` }],
            [{ text: "📊 إحصائياتي", callback_data: "my_stats" }]
        ];
        if (userId.toString() === config.adminId.toString()) {
            keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db" }]);
            keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast" }]);
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
        bot.sendMessage(chatId, "📢 قم بإرسال الرسالة الآن (نص، صورة، فيديو، الخ..). سيتم إرسالها لجميع مستخدمين البوت.\nلإلغاء الإذاعة أرسل `الغاء`.", { parse_mode: "Markdown" });
    }
    
    bot.answerCallbackQuery(query.id);
});

// معالجة الإذاعة للمطور
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // التحقق مما إذا كان المطور في وضع الإذاعة
    if (adminState[userId] === "WAITING_FOR_BROADCAST_MSG") {
        if (msg.text && msg.text.includes("الغاء")) {
            adminState[userId] = null;
            return bot.sendMessage(chatId, "تم إلغاء الإذاعة بنجاح.");
        }

        const users = db.getAllUsers();
        const userIds = Object.keys(users);
        
        bot.sendMessage(chatId, `⏳ جاري إرسال الإذاعة إلى ${userIds.length} مستخدم...`);
        adminState[userId] = null; // إنهاء حالة الإذاعة

        let successCount = 0;
        let failCount = 0;

        for (const id of userIds) {
            try {
                // نستخدم copyMessage لنسخ الرسالة كما هي (سواء كانت صورة، فيديو، نص)
                await bot.copyMessage(id, chatId, msg.message_id);
                successCount++;
            } catch (err) {
                failCount++; // المستخدم ربما قام بحظر البوت
            }
        }

        bot.sendMessage(chatId, `✅ **اكتملت الإذاعة!**\n\nنجح الإرسال لـ: ${successCount}\nفشل الإرسال لـ: ${failCount} (حظروا البوت)`, { parse_mode: "Markdown" });
    }
});

// مراقبة الجروب لمعرفة من قام بإضافة أعضاء
bot.on('message', (msg) => {
    // التأكد أن الرسالة تحتوي على أعضاء جدد
    if (msg.new_chat_members) {
        const adderId = msg.from.id;
        const adderName = msg.from.first_name;
        
        // حساب عدد الأعضاء المضافين (واستبعاد الشخص إذا كان قد دخل بنفسه عبر رابط)
        let addedRealMembersCount = 0;
        msg.new_chat_members.forEach(member => {
            if (member.id !== adderId && !member.is_bot) {
                addedRealMembersCount++;
            }
        });

        // إذا قام شخص بإضافة أشخاص حقيقيين (ليس نفسه وليس بوت)
        if (addedRealMembersCount > 0) {
            // تحديث بيانات الشخص الذي أضاف الأعضاء
            const updatedUser = db.addPoints(adderId, adderName, addedRealMembersCount);
            
            const remaining = Math.max(0, config.targetMembers - updatedUser.addedCount);
            
            // رسالة الجروب (كما في الصورة)
            const groupMsg = `⚠️ المستخدم **${adderName}** ضاف ${addedRealMembersCount} عضو جديد\n✅ المجموع الحالي: ${updatedUser.addedCount} عضو\n♻️ لازم توصل لـ ${config.targetMembers} عضو علشان تاخد السري فوراً\n🔥 الفاضل: ${remaining} عضو`;

            bot.sendMessage(msg.chat.id, groupMsg, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ اضف اعضاء", url: `https://t.me/${config.addGroupUsername}` }]
                    ]
                }
            });

            // التحقق مما إذا كان المستخدم وصل للهدف ولم يستلم الرابط بعد
            if (updatedUser.addedCount >= config.targetMembers && !updatedUser.reachedTarget) {
                // إرسال الرابط في الخاص
                const rewardMsg = `🎉 **ألف مبروك!** لقد أكملت إضافة ${config.targetMembers} عضو.\n\nتفضل رابط الجروب السري الخاص بك:\n${config.secretGroupLink}\n\nيُرجى عدم مشاركة الرابط مع أحد.`;
                
                bot.sendMessage(adderId, rewardMsg, { parse_mode: "Markdown" })
                    .then(() => {
                        // تحديث الحالة بأنه استلم الرابط لكي لا يرسله البوت مرة أخرى
                        db.setTargetReached(adderId);
                    })
                    .catch((err) => {
                        console.log(`فشل إرسال الرابط السري للمستخدم ${adderId}، ربما لم يقم بتشغيل البوت في الخاص.`);
                    });
            }
        }
    }
});

console.log("✅ البوت يعمل بنجاح...");
