const mongoose = require('mongoose');

const tenderSchema = new mongoose.Schema({
    tenderId: {
        type: String,
        required: true,
        unique: true
    },
    source: {
        type: String,
        required: true
    },
    title: {
        type: String
    },
    isMatched: {
        type: Boolean,
        default: false
    },
    category: {
        type: String,
        default: null
    },
    processedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Tender', tenderSchema);
