// index.js
process.env.SHARP_IGNORE_PREBUILT_BINARY = '1';
process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
process.env.SHARP_IGNORE_INSTALL = '1';

const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

let clientInstance = null;
let latestQrBase64 = null;
let isClientReady = false;
let numberArray = [];

/* ================= CONFIG ================= */
const DAILY_LIMIT = 600;
const MIN_DELAY = 30000; // 30 sec
const MAX_DELAY = 45000; // 45 sec
const SEND_START_HOUR = 20; // 8 PM
const SEND_END_HOUR = 23;   // 11 PM

/* ================= UTILS ================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = () =>
  Math.floor(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));

const waitForAllowedTime = async () => {
  while (true) {
    const hour = new Date().getHours();
    if (hour >= SEND_START_HOUR && hour < SEND_END_HOUR) return;
    console.log('⏳ Waiting for sending window...');
    await sleep(60000);
  }
};

/* ================= SAFE SEND TEXT ================= */
const sendTextSafely = async (client, to, message, retries = 3) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (!client || !isClientReady) throw new Error('Client not ready');
      await client.sendText(to, message);
      return true;
    } catch (err) {
      console.error(`❌ Send attempt ${attempt + 1}/${retries + 1} failed:`, err.message);
      if (err.message.includes('detached Frame') || err.message.includes('Target closed')) {
        // Browser frame issue - might need to reconnect
        if (attempt < retries) {
          console.log('⏳ Waiting before retry...');
          await sleep(5000 * (attempt + 1));
        } else {
          throw new Error('Browser connection lost. Please restart the service.');
        }
      } else if (attempt < retries) {
        await sleep(3000 * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
};

/* ================= SAFE SEND IMAGE ================= */
const sendImageSafely = async (client, to, imagePath, caption = '', retries = 3) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (!client || !isClientReady) throw new Error('Client not ready');
      await client.sendImage(to, imagePath, path.basename(imagePath), caption);
      return true;
    } catch (err) {
      if (attempt < retries) await sleep(5000 * (attempt + 1));
      else throw err;
    }
  }
};

/* ================= INIT WHATSAPP ================= */
wppconnect.create({
  session: 'kranthi-session',
  catchQR: (base64Qrimg) => {
    latestQrBase64 = base64Qrimg;
    console.log('QR updated');
  },
  headless: true,
  puppeteer,
  puppeteerOptions: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
}).then(async (client) => {
  clientInstance = client;
  await sleep(2000);
  isClientReady = true;
  console.log('✅ WhatsApp client ready');
}).catch(console.error);

/* ================= QR VIEW ================= */
app.get('/qr', (req, res) => {
  res.render('qr', { qr: latestQrBase64 });
});

/* ================= SINGLE SEND ================= */
app.post('/send', async (req, res) => {
  try {
    const { number, message } = req.body;
    
    if (!number || !message) {
      return res.status(400).send({ error: 'Number and message are required' });
    }
    
    if (!clientInstance || !isClientReady) {
      console.log('❌ Client not ready. isClientReady:', isClientReady, 'clientInstance:', !!clientInstance);
      return res.status(500).send({ error: 'WhatsApp client not ready' });
    }
    
    const jid = number.includes('@c.us') ? number : `${number}@c.us`;
    console.log('📤 Sending message to:', jid);
    
    await sendTextSafely(clientInstance, jid, message);
    
    console.log('✅ Message sent successfully to:', jid);
    res.send({ success: true });
  } catch (error) {
    console.error('❌ Error in /send endpoint:', error.message);
    res.status(500).send({ error: error.message || 'Failed to send message' });
  }
});

/* ================= BULK SEND (OLD) ================= */
app.post('/send-bulk', async (req, res) => {
  const { message, fileName, imageName } = req.body;

  numberArray = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'phoneNumber', `${fileName}.json`))
  );

  bulkWhatsMessage(message, imageName);

  res.send({ success: true, status: 'Broadcast started (no scheduler)' });
});

/* ================= BULK HANDLER (OLD) ================= */
async function bulkWhatsMessage(message, imageName) {
  const imagePath = imageName
    ? path.join(__dirname, 'images', imageName)
    : null;

  for (let number of numberArray) {
    let raw = String(number).replace('@c.us', '').trim();
    if (!raw.startsWith('91')) raw = '91' + raw;
    if (!/^\d{12,15}$/.test(raw)) continue;

    const jid = `${raw}@c.us`;

    try {
      if (imagePath) {
        await sendImageSafely(clientInstance, jid, imagePath, message);
      } else {
        await sendTextSafely(clientInstance, jid, message);
      }
      await sleep(30000);
    } catch {
      await sleep(5000);
    }
  }
}

/* ================= NEW: SCHEDULER ================= */
async function startBulkScheduler(numbers, message, imageName) {
  let sentToday = 0;
  let index = 0;

  const imagePath = imageName
    ? path.join(__dirname, 'images', imageName)
    : null;

  while (index < numbers.length) {
    await waitForAllowedTime();

    if (sentToday >= DAILY_LIMIT) {
      console.log('🌙 Daily limit reached. Sleeping...');
      sentToday = 0;
      await sleep(6 * 60 * 60 * 1000);
      continue;
    }

    let raw = String(numbers[index]).replace('@c.us', '').trim();
    if (!raw.startsWith('91')) raw = '91' + raw;
    if (!/^\d{12,15}$/.test(raw)) {
      index++;
      continue;
    }

    const jid = `${raw}@c.us`;

    try {
      if (imagePath) {
        await sendImageSafely(clientInstance, jid, imagePath, message);
      } else {
        await sendTextSafely(clientInstance, jid, message);
      }

      sentToday++;
      index++;
      console.log(`✅ Sent ${index}/${numbers.length} | Today: ${sentToday}`);
      await sleep(randomDelay());

    } catch (err) {
      console.error('❌ Failed:', jid);
      index++;
      await sleep(5000);
    }
  }

  console.log('🎉 Scheduler completed');
}

/* ================= NEW API: SCHEDULED ================= */
app.post('/send-bulk-scheduled', async (req, res) => {
  const { message, fileName, imageName } = req.body;

  const numbers = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'phoneNumber', `${fileName}.json`))
  );

  startBulkScheduler(numbers, message, imageName);

  res.send({ success: true, status: 'Scheduler started safely' });
});

/* ================= SERVER ================= */
app.listen(3000, '0.0.0.0', () => {
  console.log('🚀 Server running at http://0.0.0.0:3000');
});

