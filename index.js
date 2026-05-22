const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./db');
const fs = require('fs');

// تهيئة البوت
const bot = new TelegramBot(config.token, { polling: true });

// متغير لتتبع حالة الإذاعة للمطور
let adminState = {};

// متغيرات للرسائل الوهمية
let fakeMessagesEnabled = false;
let fakeMessageInterval = null;
let fakeNames = [];
try {
    if (fs.existsSync('./names_clean.json')) {
        fakeNames = JSON.parse(fs.readFileSync('./names_clean.json', 'utf8'));
    }
} catch (err) {
    console.error("خطأ في قراءة ملف الأسماء:", err.message);
}

// لتفادي تكرار رسالة الانضمام بين new_chat_members و chat_member
const processedJoinEvents = new Map();

// متغير لتوقيت الرسائل الوهمية بالثواني (الافتراضي 60)
let fakeMessageIntervalSeconds = 60;

// دالة مساعدة لتحويل تنسيقات رسالة التليجرام إلى HTML لدعم الإذاعة
function convertBotMessageToHtml(text, entities) {
    if (!text) return '';
    if (!entities || entities.length === 0) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    let html = '';
    const tags = {};
    for (const e of entities) {
        if (!tags[e.offset]) tags[e.offset] = { start: [], end: [] };
        if (!tags[e.offset + e.length]) tags[e.offset + e.length] = { start: [], end: [] };

        let startTag = '', endTag = '';
        switch (e.type) {
            case 'bold': startTag = '<b>'; endTag = '</b>'; break;
            case 'italic': startTag = '<i>'; endTag = '</i>'; break;
            case 'underline': startTag = '<u>'; endTag = '</u>'; break;
            case 'strikethrough': startTag = '<s>'; endTag = '</s>'; break;
            case 'spoiler': startTag = '<tg-spoiler>'; endTag = '</tg-spoiler>'; break;
            case 'code': startTag = '<code>'; endTag = '</code>'; break;
            case 'pre': 
                startTag = e.language ? `<pre><code class="language-${e.language}">` : '<pre>'; 
                endTag = e.language ? '</code></pre>' : '</pre>'; 
                break;
            case 'text_link': startTag = `<a href="${e.url}">`; endTag = '</a>'; break;
            case 'text_mention': startTag = `<a href="tg://user?id=${e.user.id}">`; endTag = '</a>'; break;
            case 'blockquote': startTag = '<blockquote>'; endTag = '</blockquote>'; break;
        }
        if (startTag) {
            tags[e.offset].start.push(startTag);
            tags[e.offset + e.length].end.unshift(endTag); 
        }
    }

    for (let i = 0; i < text.length; i++) {
        if (tags[i]) {
            html += tags[i].end.join('');
            html += tags[i].start.join('');
        }
        const char = text[i];
        if (char === '&') html += '&amp;';
        else if (char === '<') html += '&lt;';
        else if (char === '>') html += '&gt;';
        else html += char;
    }
    if (tags[text.length]) {
        html += tags[text.length].end.join('');
    }

    return html;
}

// دالة لحفظ الإعدادات في ملف config.js لتكون دائمة بعد إعادة التشغيل
function saveConfig() {
    const configContent = `module.exports = {\n` +
        `    // توكن البوت الخاص بك\n` +
        `    token: "${config.token}",\n    \n` +
        `    // قائمة أيديات المطورين (يمكنك إضافة أي عدد من المطورين هنا)\n` +
        `    adminIds: [${config.adminIds.join(', ')}],\n    \n` +
        `    // يوزر الجروب الأول (البوابة) - بدون علامة @\n` +
        `    group1: "${config.group1}", \n    \n` +
        `    // يوزر الجروب الثاني (الذي يتم فيه إضافة الأعضاء) - بدون علامة @\n` +
        `    group2: "${config.group2}",\n    \n` +
        `    // رابط الجروب السري (الذي يحصل عليه بعد إكمال 50 عضو)\n` +
        `    secretGroupLink: "${config.secretGroupLink}",\n    \n` +
        `    // عدد الأعضاء المطلوب إضافتهم للجروب الثاني\n` +
        `    targetMembers: ${config.targetMembers}\n` +
        `};`;
    try {
        fs.writeFileSync('./config.js', configContent, 'utf8');
    } catch (err) {
        console.error("خطأ في حفظ الإعدادات:", err.message);
    }
}

const tgLink = "https://" + "t.me/";

function getGroupLink(group) {
    return tgLink + String(group || '').replace('@', '');
}

function getGroupProfileLink(group) {
    return tgLink + String(group || '').replace('@', '') + "?profile";
}

function buildJoinKeyboard(buttonUrl) {
    return {
        inline_keyboard: [
            [{ text: "➕ اضف اعضاء", url: buttonUrl }]
        ]
    };
}

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

function createFakeMessageText(randomName, addedCount, totalCount, remaining) {
    return "⚠️ المستخدم " + randomName + " ضاف " + addedCount + " عضو جديد\n" +
        "✅ المجموع الحالي: " + totalCount + " عضو\n" +
        "♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n" +
        "🔥 الفاضل: " + remaining + " عضو";
}

async function sendFakeMessage() {
    if (!fakeMessagesEnabled || fakeNames.length === 0) return;
    
    try {
        if (config.group1) {
            const randomName1 = fakeNames[Math.floor(Math.random() * fakeNames.length)];
            const addedCount1 = Math.floor(Math.random() * 5) + 1;
            const totalCount1 = Math.floor(Math.random() * (45 - addedCount1 + 1)) + addedCount1;
            const remaining1 = Math.max(0, config.targetMembers - totalCount1);
            
            const groupMsg1 = createFakeMessageText(randomName1, addedCount1, totalCount1, remaining1);
            const chatId1 = String(config.group1).startsWith('@') ? config.group1 : '@' + config.group1;
            const buttonUrl1 = getGroupLink(config.group2);
            await bot.sendMessage(chatId1, groupMsg1, { reply_markup: buildJoinKeyboard(buttonUrl1) }).catch(()=>{});
        }
        
        if (config.group2) {
            const randomName2 = fakeNames[Math.floor(Math.random() * fakeNames.length)];
            const addedCount2 = Math.floor(Math.random() * 5) + 1;
            const totalCount2 = Math.floor(Math.random() * (45 - addedCount2 + 1)) + addedCount2;
            const remaining2 = Math.max(0, config.targetMembers - totalCount2);
            
            const groupMsg2 = createFakeMessageText(randomName2, addedCount2, totalCount2, remaining2);
            const chatId2 = String(config.group2).startsWith('@') ? config.group2 : '@' + config.group2;
            const buttonUrl2 = getGroupProfileLink(config.group2);
            await bot.sendMessage(chatId2, groupMsg2, { reply_markup: buildJoinKeyboard(buttonUrl2) }).catch(()=>{});
        }
    } catch (err) {
        // تجاهل الأخطاء الصامتة للرسائل الوهمية
    }
}

function updateFakeMessagesInterval() {
    if (fakeMessageInterval) {
        clearInterval(fakeMessageInterval);
        fakeMessageInterval = null;
    }
    if (fakeMessagesEnabled) {
        fakeMessageInterval = setInterval(sendFakeMessage, fakeMessageIntervalSeconds * 1000);
    }
}

function toggleFakeMessages() {
    fakeMessagesEnabled = !fakeMessagesEnabled;
    updateFakeMessagesInterval();
    return fakeMessagesEnabled;
}

async function sendGroupProgressMessage(chatId, adderName, addedCount, totalCount, remaining, buttonUrl) {
    const groupMsg = "⚠️ المستخدم " + adderName + " ضاف " + addedCount + " عضو جديد\n" +
        "✅ المجموع الحالي: " + totalCount + " عضو\n" +
        "♻️ لازم توصل لـ " + config.targetMembers + " عضو علشان تاخد السري فوراً\n" +
        "🔥 الفاضل: " + remaining + " عضو";

    try {
        await bot.sendMessage(chatId, groupMsg, {
            reply_markup: buildJoinKeyboard(buttonUrl)
        });
        return true;
    } catch (err) {
        console.log("خطأ في إرسال رسالة التحديث بالجروب:", err.message);
        return false;
    }
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fullName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
    const username = msg.from.username ? `@${msg.from.username}` : 'لا يوجد يوزر';

    if (msg.chat.type !== 'private') return;

    const allUsers = db.getAllUsers();
    const isNewUser = !allUsers[userId];

    db.getUser(userId, fullName);

    if (isNewUser) {
        const notifyMsg = `🆕 <b>مستخدم جديد دخل البوت!</b>\n\n👤 الاسم: ${fullName}\n🏷️ اليوزر: ${username}\n🆔 الأيدي: <code>${userId}</code>\n🔗 الرابط: <a href="tg://user?id=${userId}">${fullName}</a>`;
        
        config.adminIds.forEach(adminId => {
            bot.sendMessage(adminId, notifyMsg, { parse_mode: "HTML" }).catch(()=>{});
        });
    }

    const welcomeMessage = "أهلاً يا <b>" + fullName + "</b>\n\n🎯 المطلوب لدخول الجروب السري: " + config.targetMembers + " عضو\n\nبالتوفيق للجميع ❤️";

    let keyboard = [
        [{ text: "➕ إضافة أصدقائي", url: getGroupLink(config.group1) }],
        [{ text: "📊 إحصائياتي", callback_data: "my_stats" }]
    ];

    if (config.adminIds.some(id => id.toString() === userId.toString())) {
        keyboard.push([{ text: "⚙️ إدارة الجروبات", callback_data: "manage_groups" }]);
        keyboard.push([{ text: "👥 عرض المستخدمين", callback_data: "admin_users_list" }]);
        keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db" }]);
        keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast" }]);
        
        const fakeBtnText = fakeMessagesEnabled ? "🔴 إيقاف الرسائل الوهمية" : "🟢 تشغيل الرسائل الوهمية";
        keyboard.push([{ text: fakeBtnText, callback_data: "toggle_fake" }]);
        keyboard.push([{ text: `⏱ توقيت الوهمي: ${fakeMessageIntervalSeconds}ث`, callback_data: "edit_fake_interval" }]);
    }

    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: keyboard
        }
    }).catch(err => console.error("خطأ في إرسال رسالة الترحيب:", err.message));
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const fullName = query.from.first_name;

    if (data === "my_stats") {
        const user = db.getUser(userId, fullName);
        const remaining = Math.max(0, config.targetMembers - user.addedCount);

        const statsMsg = "📊 <b>إحصائياتك الحالية:</b>\n\n✅ عدد إضافاتك: " + user.addedCount + "\n🎯 الهدف: " + config.targetMembers + "\n🔥 المتبقي لك: " + remaining + " عضو\n\n🚀 استمر في الإضافة لفتح الرابط السري!";

        bot.editMessageText(statsMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "back_to_start" }]]
            }
        }).catch(err => console.error(err.message));
    }
    else if (data === "back_to_start") {
        const welcomeMessage = "أهلاً يا <b>" + fullName + "</b>\n\n🎯 المطلوب لدخول الجروب السري: " + config.targetMembers + " عضو\n\nبالتوفيق للجميع ❤️";
        let keyboard = [
            [{ text: "➕ إضافة أصدقائي", url: getGroupLink(config.group1) }],
            [{ text: "📊 إحصائياتي", callback_data: "my_stats" }]
        ];
        if (config.adminIds.some(id => id.toString() === userId.toString())) {
            keyboard.push([{ text: "⚙️ إدارة الجروبات", callback_data: "manage_groups" }]);
            keyboard.push([{ text: "👥 عرض المستخدمين", callback_data: "admin_users_list" }]);
            keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db" }]);
            keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast" }]);
            
            const fakeBtnText = fakeMessagesEnabled ? "🔴 إيقاف الرسائل الوهمية" : "🟢 تشغيل الرسائل الوهمية";
            keyboard.push([{ text: fakeBtnText, callback_data: "toggle_fake" }]);
            keyboard.push([{ text: `⏱ توقيت الوهمي: ${fakeMessageIntervalSeconds}ث`, callback_data: "edit_fake_interval" }]);
        }
        bot.editMessageText(welcomeMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: keyboard }
        }).catch(err => console.error(err.message));
    }
    else if (data === "manage_groups" && config.adminIds.some(id => id.toString() === userId.toString())) {
        const groupsMsg = `⚙️ <b>إدارة الجروبات</b>\n\n` +
            `الجروب الأول الحالي (البوابة): @${config.group1}\n` +
            `الجروب الثاني الحالي: @${config.group2}\n\n` +
            `اختر الجروب الذي تريد تغييره:`;
        
        const keyboard = [
            [{ text: "تغيير الجروب الأول", callback_data: "edit_group1" }],
            [{ text: "تغيير الجروب الثاني", callback_data: "edit_group2" }],
            [{ text: "🔙 رجوع", callback_data: "back_to_start" }]
        ];

        bot.editMessageText(groupsMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: keyboard }
        }).catch(err => console.error("حدث خطأ أثناء تحميل إدارة الجروبات: ", err.message));
    }
    else if (data === "edit_group1" && config.adminIds.some(id => id.toString() === userId.toString())) {
        adminState[userId] = "WAITING_FOR_GROUP1";
        bot.sendMessage(chatId, "أرسل يوزر الجروب الأول (البوابة) الجديد بدون علامة @\nلإلغاء التعديل أرسل كلمة الغاء");
    }
    else if (data === "edit_group2" && config.adminIds.some(id => id.toString() === userId.toString())) {
        adminState[userId] = "WAITING_FOR_GROUP2";
        bot.sendMessage(chatId, "أرسل يوزر الجروب الثاني الجديد بدون علامة @\nلإلغاء التعديل أرسل كلمة الغاء");
    }
    else if (data === "admin_users_list" && config.adminIds.some(id => id.toString() === userId.toString())) {
        const users = db.getAllUsers();
        const userIds = Object.keys(users);
        
        let rows = [];
        let count = 0;

        for (const id of userIds) {
            const u = users[id];
            const name = u.name || "مستخدم";
            const added = u.addedCount || 0;
            const link = `tg://user?id=${id}`;

            rows.push([
                { text: `👤 ${name}`, url: link },
                { text: `✅ إضافاته: ${added}`, callback_data: 'noop' }
            ]);

            count++;
            if (count >= 80) break; 
        }

        if (rows.length === 0) {
            bot.editMessageText("❌ لا يوجد مستخدمين حتى الآن.", {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "back_to_start" }]] }
            }).catch(err => console.error(err.message));
            return;
        }

        rows.push([{ text: '🔙 رجوع', callback_data: 'back_to_start' }]);

        let textMsg = `👥 <b>قائمة المستخدمين في البوت:</b>\n\nإجمالي المسجلين: <code>${userIds.length}</code> مستخدم`;
        if (userIds.length > 80) {
            textMsg += `\n⚠️ <i>تم عرض أحدث 80 مستخدم فقط نظراً لقيود تليجرام، يمكنك تحميل قاعدة البيانات لرؤية الجميع.</i>`;
        }

        bot.editMessageText(textMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows }
        }).catch(err => {
            console.log("خطأ في عرض قائمة المستخدمين:", err.message);
        });
    }
    else if (data === "noop") {
        bot.answerCallbackQuery(query.id);
    }
    else if (data === "download_db" && config.adminIds.some(id => id.toString() === userId.toString())) {
        bot.sendDocument(chatId, './db.json', { caption: "📁 تفضل، هذه أحدث نسخة من قاعدة البيانات الخاصة بالمستخدمين." });
    }
    else if (data === "broadcast" && config.adminIds.some(id => id.toString() === userId.toString())) {
        adminState[userId] = "WAITING_FOR_BROADCAST_MSG";
        bot.sendMessage(chatId, "📢 قم بإرسال الرسالة الآن (نص، صورة، فيديو، الخ..). سيتم إرسالها لجميع مستخدمي البوت.\nلإلغاء الإذاعة أرسل كلمة الغاء");
    }
    else if (data === "toggle_fake" && config.adminIds.some(id => id.toString() === userId.toString())) {
        const isEnabled = toggleFakeMessages();
        
        let keyboard = [
            [{ text: "➕ إضافة أصدقائي", url: getGroupLink(config.group1) }],
            [{ text: "📊 إحصائياتي", callback_data: "my_stats" }]
        ];
        keyboard.push([{ text: "⚙️ إدارة الجروبات", callback_data: "manage_groups" }]);
        keyboard.push([{ text: "👥 عرض المستخدمين", callback_data: "admin_users_list" }]);
        keyboard.push([{ text: "📁 تحميل قاعدة البيانات", callback_data: "download_db" }]);
        keyboard.push([{ text: "📢 إذاعة رسالة", callback_data: "broadcast" }]);
        
        const fakeBtnText = isEnabled ? "🔴 إيقاف الرسائل الوهمية" : "🟢 تشغيل الرسائل الوهمية";
        keyboard.push([{ text: fakeBtnText, callback_data: "toggle_fake" }]);
        keyboard.push([{ text: `⏱ توقيت الوهمي: ${fakeMessageIntervalSeconds}ث`, callback_data: "edit_fake_interval" }]);
        
        bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
            chat_id: chatId,
            message_id: messageId
        }).catch(()=>{});
    }
    else if (data === "edit_fake_interval" && config.adminIds.some(id => id.toString() === userId.toString())) {
        adminState[userId] = "WAITING_FOR_FAKE_INTERVAL";
        bot.sendMessage(chatId, "⏱ ارسل الوقت بالثواني (مثال: 60)\nلإلغاء التعديل أرسل كلمة الغاء");
    }

    bot.answerCallbackQuery(query.id);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (adminState[userId] === "WAITING_FOR_GROUP1" && msg.chat.type === 'private') {
        if (msg.text && msg.text.includes("الغاء")) {
            adminState[userId] = null;
            return bot.sendMessage(chatId, "تم إلغاء تعديل الجروب الأول.");
        }
        
        let newGroup = msg.text.trim().replace('@', '');
        config.group1 = newGroup;
        saveConfig(); 
        adminState[userId] = null;
        
        return bot.sendMessage(chatId, `✅ تم تغيير الجروب الأول بنجاح إلى: @${newGroup}`);
    }

    if (adminState[userId] === "WAITING_FOR_GROUP2" && msg.chat.type === 'private') {
        if (msg.text && msg.text.includes("الغاء")) {
            adminState[userId] = null;
            return bot.sendMessage(chatId, "تم إلغاء تعديل الجروب الثاني.");
        }
        
        let newGroup = msg.text.trim().replace('@', '');
        config.group2 = newGroup;
        saveConfig(); 
        adminState[userId] = null;
        
        return bot.sendMessage(chatId, `✅ تم تغيير الجروب الثاني بنجاح إلى: @${newGroup}`);
    }

    if (adminState[userId] === "WAITING_FOR_FAKE_INTERVAL" && msg.chat.type === 'private') {
        if (msg.text && msg.text.includes("الغاء")) {
            adminState[userId] = null;
            return bot.sendMessage(chatId, "تم إلغاء التعديل.");
        }
        
        const text = msg.text.trim();
        if (!/^\d+$/.test(text) || parseInt(text) < 5) {
            return bot.sendMessage(chatId, "❌ ارسل رقماً صحيحاً (أكبر من 5 ثواني)");
        }
        
        fakeMessageIntervalSeconds = parseInt(text);
        updateFakeMessagesInterval();
        adminState[userId] = null;
        
        return bot.sendMessage(chatId, `✅ تم تعديل وقت الرسائل الوهمية إلى ${fakeMessageIntervalSeconds} ثانية بنجاح.`);
    }

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

        if (msg.text) {
            const htmlMsg = convertBotMessageToHtml(msg.text, msg.entities);
            for (const id of userIds) {
                try {
                    await bot.sendMessage(id, htmlMsg, { parse_mode: 'HTML' });
                    successCount++;
                } catch (err) {
                    failCount++;
                }
            }
        } else {
            for (const id of userIds) {
                try {
                    await bot.copyMessage(id, chatId, msg.message_id);
                    successCount++;
                } catch (err) {
                    failCount++;
                }
            }
        }

        bot.sendMessage(chatId, "✅ <b>اكتملت الإذاعة!</b>\n\nنجح الإرسال لـ: " + successCount + "\nفشل الإرسال لـ: " + failCount + " (حظروا البوت)", { parse_mode: "HTML" });
    }
});

bot.on('chat_member', async (update) => {
    try {
        if (!update || !update.chat || !update.from || !update.new_chat_member) return;
        if (update.chat.type === 'private') return;

        const chatId = update.chat.id;
        const adderId = update.from.id;
        const adderName = update.from.first_name || 'مستخدم';

        const oldStatus = update.old_chat_member && update.old_chat_member.status ? update.old_chat_member.status : null;
        const newStatus = update.new_chat_member.status;

        if (oldStatus === 'left' && newStatus === 'member') {
            if (!claimJoinEvent(chatId, adderId)) return;

            const user = db.getUser(adderId, adderName);
            const remaining = Math.max(0, config.targetMembers - user.addedCount);

            const isGroup1 = String(update.chat.username || update.chat.id) === String(config.group1).replace('@', '');
            const buttonUrl = isGroup1 ? getGroupLink(config.group2) : getGroupProfileLink(config.group2);

            await sendGroupProgressMessage(chatId, adderName, 0, user.addedCount, remaining, buttonUrl);
        }
    } catch (err) {
        console.log("خطأ chat_member:", err.message);
    }
});

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' && msg.new_chat_members) {
        const adderId = msg.from.id;
        const adderName = msg.from.first_name;

        const isGroup1 = String(msg.chat.username || msg.chat.id) === String(config.group1).replace('@', '');
        const buttonUrl = isGroup1 ? getGroupLink(config.group2) : getGroupProfileLink(config.group2);

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

        if (selfJoin) {
            if (!claimJoinEvent(msg.chat.id, adderId)) {
                // ...
            } else {
                const user = db.getUser(adderId, adderName);
                const remaining = Math.max(0, config.targetMembers - user.addedCount);

                await sendGroupProgressMessage(msg.chat.id, adderName, 0, user.addedCount, remaining, buttonUrl);
            }
        }

        if (addedRealMembersCount > 0) {
            const updatedUser = db.addPoints(adderId, adderName, addedRealMembersCount);
            const remaining = Math.max(0, config.targetMembers - updatedUser.addedCount);

            await sendGroupProgressMessage(
                msg.chat.id,
                adderName,
                addedRealMembersCount,
                updatedUser.addedCount,
                remaining,
                buttonUrl
            );

            if (updatedUser.addedCount >= config.targetMembers && !updatedUser.reachedTarget) {
                const rewardMsg = "🎉 <b>ألف مبروك!</b> لقد أكملت إضافة " + config.targetMembers + " عضو.\n\nاضغط على الزر بالأسفل للدخول إلى الجروب السري:\n\nيُرجى عدم مشاركة الرابط مع أحد.";
                
                const rewardKeyboard = {
                    inline_keyboard: [
                        [{ text: "🔓 الدخول للجروب السري", url: config.secretGroupLink }]
                    ]
                };

                bot.sendMessage(adderId, rewardMsg, { 
                    parse_mode: "HTML",
                    reply_markup: rewardKeyboard
                })
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
