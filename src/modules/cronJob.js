const cron = require('node-cron');
const { analyzeTenders } = require('./tenderAnalyzer');

const startCronJobs = () => {
    // Run every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
        console.log('[CRON] Starting tender analysis job...');
        await analyzeTenders();
        console.log('[CRON] Tender analysis job completed.');
    });

    console.log('Cron jobs started (running every 10 minutes).');

    // Optionally trigger immediately on startup
    // analyzeTenders();
};

module.exports = { startCronJobs };
