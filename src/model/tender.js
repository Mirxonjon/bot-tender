const mongoose = require('mongoose');

const tenderSchema = new mongoose.Schema({
    tenderId: {
        type: String,
        required: true,
        unique: true
    },
    title: {
        type: String
    },
    processedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Tender', tenderSchema);
