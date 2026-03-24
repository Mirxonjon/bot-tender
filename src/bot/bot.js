const TelegramBot = require('node-telegram-bot-api');
const messageHandler = require('./message');
const queryHandler = require('./query');

let bot;

const initBot = () => {
    const token = process.env.BOT_TOKEN;
    if (!token) {
        console.error('BOT_TOKEN is missing in .env');
        return;
    }

    bot = new TelegramBot(token, { polling: true });

    bot.on('message', (msg) => messageHandler(bot, msg));
    bot.on('callback_query', (query) => queryHandler(bot, query));

    // Handle being added to a group (my_chat_member or regular message depending on privacy)
    bot.on('my_chat_member', (msg) => {
        if (msg.new_chat_member.status === 'member' || msg.new_chat_member.status === 'administrator') {
            const chatId = msg.chat.id;
            console.log(`Bot was added to chat/group: ${chatId}`);
            bot.sendMessage(msg.chat.id, `Guruh ID: \`${chatId}\`\nIltimos bu ID ni .env dagi GROUP_ID ga kiriting.`, { parse_mode: 'Markdown' });
        }
    });

    console.log('Telegram Bot initialized and polling');
};

const getBot = () => bot;

module.exports = { initBot, getBot };
