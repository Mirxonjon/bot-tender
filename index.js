require('dotenv').config({ quiet: true });
const express = require('express');
const mongoose = require('mongoose');
const { initBot } = require('./src/bot/bot');
const { startCronJobs } = require('./src/modules/cronJob');

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Tender Bot is running');
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('FATAL ERROR: MONGO_URI is missing in .env file! Please configure your .env file on the server.');
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('Connected to MongoDB');
        
        // Initialize Bot
        initBot();
        
        // Start Cron Jobs
        startCronJobs();

        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB:', error);
    });
