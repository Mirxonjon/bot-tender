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
    jsonMatched: {
        type: Boolean,
        default: false
    },
    isMatched: {
        type: Boolean,
        default: false
    },
    jsonAnalysis: {
        type: Object
    },
    deepAnalysis: {
        type: Object
    },
    deepAnalysisRaw: {
        type: String
    },
    statusTz: {
        type: String
    },
    score: {
        type: Number
    },
    filesInfo: {
        type: Array,
        default: []
    },
    processedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Tender', tenderSchema);
