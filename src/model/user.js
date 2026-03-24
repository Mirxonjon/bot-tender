const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true,
        unique: true
    },
    username: String,
    firstName: String,
    lastName: String,
    action: {
        type: String,
        default: 'none'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);
