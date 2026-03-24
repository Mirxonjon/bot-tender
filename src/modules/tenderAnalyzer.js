const axios = require('axios');
const OpenAI = require('openai');
const Tender = require('../model/tender');
const { getBot } = require('../bot/bot');

// Setup OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const TENDER_API_URL = 'https://tender.asia/api/tenders/?limit=50&offset=0&status=open&page_refreshed=True'; // Reduced limit for cron efficiency, or page logic can be added later

const SYSTEM_PROMPT = `You are an expert procurement classifier.

Your task is to determine whether the given lot matches WEB DEVELOPMENT SERVICES.

WEB DEVELOPMENT SERVICES includes:
- website development
- web application development
- portal development
- CRM / ERP / dashboard / admin panel development
- frontend development
- backend development
- full-stack development
- API development or integration
- database-driven systems
- support, modernization, maintenance, or improvement of existing web systems
- UI/UX design for web platforms
- e-government or corporate information systems if they involve web/software development

NOT MATCHING includes:
- security services
- cleaning services
- construction and repair
- office supplies
- furniture
- electronics supply only
- internet or hosting only
- CCTV
- vehicle services
- legal/accounting services
- printing services
- physical equipment delivery
- mobile app only, unless the lot clearly includes web platform development too

Decision rules:
1. Return MATCH if the lot is clearly about creating, developing, updating, maintaining, or integrating a web-based software system.
2. Return NOT_MATCH if it is about physical goods, non-IT services, or unrelated services.
3. If the lot is about general software or IT services but web development is not clearly mentioned, return NOT_MATCH.
4. If the lot mentions both software and hardware, choose MATCH only if web/software development is the main scope.
5. Be strict. Do not guess positively without evidence.

Return JSON only in this format:
{
  "result": "MATCH" or "NOT_MATCH",
  "confidence": 0-100,
  "reason": "short explanation in Uzbek"
}`;

const analyzeTenders = async () => {
    try {
        console.log('Fetching tenders from API...');
        const response = await axios.get(TENDER_API_URL);
        const tenders = response.data.results || response.data.data || response.data || []; // Depending on API response structure
        // The example shows a direct array inside or similar. the URL has `?limit=9999` so it might return an array of objects.

        const dataArray = Array.isArray(tenders) ? tenders : [];

        for (const item of dataArray) {
            if (!item || !item.id) continue;

            const existing = await Tender.findOne({ tenderId: item.id.toString() });
            if (existing) {
                // Already processed
                continue;
            }

            // Prepare prompt content
            const promptContent = `Lot:\nName: ${item.name}\nDescription: ${item.description || ''}`;

            console.log(`Analyzing tender: ${item.id} - ${item.name}`);

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Using a fast, modern model
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: promptContent }
                ],
                response_format: { type: "json_object" }
            });

            const replyText = completion.choices[0].message.content;
            let analysis;
            try {
                analysis = JSON.parse(replyText);
            } catch (e) {
                console.error('Failed to parse OpenAI response:', replyText);
                continue;
            }

            if (analysis.result === "MATCH") {
                await notifyGroup(item, analysis);
            }

            // Save to DB so we don't process it again
            await Tender.create({ tenderId: item.id.toString(), title: item.name });

            // wait a little bit between OpenAI calls to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

    } catch (err) {
        console.error('Error analyzing tenders:', err.message);
    }
};

const notifyGroup = async (item, analysis) => {
    const groupId = process.env.GROUP_ID;
    const bot = getBot();

    if (!groupId || !bot) {
        console.warn('Cannot send notification: GROUP_ID or bot instance missing.');
        return;
    }

    const price = item.price ? new Intl.NumberFormat('uz-UZ').format(item.price) : 'Noma\'lum';
    const currency = item.currency || 'UZS';

    let lotDetails = '';
    if (item.lots && item.lots.length > 0) {
        lotDetails = '\\n📦 *Lotlar hajmi va narxi:*\\n';
        item.lots.forEach(lot => {
            lotDetails += `- ${lot.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}: ${new Intl.NumberFormat('uz-UZ').format(lot.price)} ${lot.currency || 'UZS'}\\n`;
        });
    }

    const message = `🚀 *Yangi Dasturlash (IT) Tenderi!*

📌 *Nomi:* ${item.name ? item.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : "Noma'lum"}
🏢 *Tashkilot:* ${item.company ? item.company.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : "Noma'lum"}
📍 *Hudud:* ${item.region ? item.region.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : "Noma'lum"}

💰 *Umumiy narx:* ${price} ${currency}
${lotDetails}
🔍 *AI Xulosasi:* ${analysis.reason.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}
🎯 *Ishonchlilik:* ${analysis.confidence}%

🔗 [Tender havolasi](${item.url ? item.url : 'https://tender.mc.uz/'})`;

    try {
        await bot.sendMessage(groupId, message, { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
        console.log(`Notification sent for tender ${item.id}`);
    } catch (err) {
        console.error(`Error sending message to group for tender ${item.id}:`, err.message);
        // Fallback to normal text in case of markdown errors
        try {
            await bot.sendMessage(groupId, message.replace(/\*/g, '').replace(/_/g, '').replace(/\[/g, '').replace(/\]/g, '').replace(/\(/g, '').replace(/\)/g, ''));
        } catch (e) {
            console.error('Failed fallback send:', e.message);
        }
    }
};

module.exports = { analyzeTenders };
