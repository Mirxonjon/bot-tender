module.exports = async (bot, msg, user) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Assalomu alaykum ${user.firstName || 'foydalanuvchi'}! Ushbu bot tenderlarni qidiruvchi tizimdir.`, {
        parse_mode: 'Markdown'
    });
};
