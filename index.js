// index.js
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

let clientInstance = null;
let latestQrBase64 = null;

// ✅ Initialize WhatsApp session
wppconnect
  .create({
    session: 'kranthi-session',
    catchQR: (base64Qrimg, asciiQR, attempt, urlCode) => {
      latestQrBase64 = base64Qrimg;
      console.log('QR Code updated!');
    },
    statusFind: (statusSession, session) => {
      console.log('Session Status: ', statusSession);
    },
    headless: true,
    puppeteer: puppeteer,
    puppeteerOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },

  })
  .then((client) => {
    clientInstance = client;
    console.log('WPPConnect client ready.');
  });

// ✅ Route: Render QR code in browser
app.get('/qr', (req, res) => {
  res.render('qr', { qr: latestQrBase64 });
});

// ✅ Route: Send WhatsApp message
app.post('/send', async (req, res) => {
  const { number, message } = req.body;

  if (!clientInstance) {
    return res.status(500).send({ error: 'WhatsApp not initialized' });
  }

  if (!number || !message) {
    return res.status(400).send({ error: 'number and message required' });
  }

  try {
    const formatted = number.includes('@c.us') ? number : number + '@c.us';
    await clientInstance.sendText(formatted, message);
    res.send({ success: true, number, message });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).send({ error: 'Failed to send message' });
  }
});

// ✅ Start server
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
