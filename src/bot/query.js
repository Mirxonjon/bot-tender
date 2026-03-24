const User = require('../model/user');

module.exports = async (bot, query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        let user = await User.findOne({ chatId: chatId.toString() });

        if (!user) return;

        // Callback query dispatcher logic
        // switch (data) { ... }

        bot.answerCallbackQuery(query.id);
    } catch (err) {
        console.error('Error in queryHandler:', err);
    }
};
