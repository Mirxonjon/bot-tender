const User = require('../model/user');
const startHelper = require('./helper/start');

module.exports = async (bot, msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // We mainly care about private messages for user states
    if (msg.chat.type !== 'private') {
        // Handle group messages if needed, e.g., fetching group id via message
        if (text === '/getgroupid') {
            bot.sendMessage(chatId, `This Group ID is: \`${chatId}\``, { parse_mode: 'Markdown' });
        }
        return;
    }

    try {
        let user = await User.findOne({ chatId: chatId.toString() });

        if (!user) {
            user = new User({
                chatId: chatId.toString(),
                username: msg.from.username,
                firstName: msg.from.first_name,
                lastName: msg.from.last_name,
                action: 'start'
            });
            await user.save();
        }

        // Global commands
        if (text === '/start') {
            user.action = 'start';
            await user.save();
            return startHelper(bot, msg, user);
        }

        // Dispatcher loging based on action state
        switch (user.action) {
            case 'start':
                startHelper(bot, msg, user);
                break;
            default:
                bot.sendMessage(chatId, "I did not understand that command. Use /start");
                break;
        }

    } catch (err) {
        console.error('Error in messageHandler:', err);
    }
};
