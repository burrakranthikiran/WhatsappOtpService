// index.js
process.env.SHARP_IGNORE_PREBUILT_BINARY = '1';
process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
process.env.SHARP_IGNORE_INSTALL = '1';
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Load numbers from number.json
const numberArray = JSON.parse(fs.readFileSync(path.join(__dirname, 'number.json'), 'utf8'));

const app = express();
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

let clientInstance = null;
let latestQrBase64 = null;
let isClientReady = false;

// Helper function to send text with retry and error handling (workaround for stack overflow)
const sendTextSafely = async (client, to, message, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Try using sendText with a timeout to prevent hanging
      const sendPromise = client.sendText(to, message);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Send timeout')), 30000)
      );
      
      await Promise.race([sendPromise, timeoutPromise]);
      return true;
    } catch (err) {
      const isStackOverflow = err.message && err.message.includes('Maximum call stack size exceeded');
      
      if (isStackOverflow && attempt < retries) {
        console.warn(`Stack overflow on attempt ${attempt + 1}, retrying after delay...`);
        // Wait longer before retry
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }
      
      // If it's the last attempt or not a stack overflow, throw
      throw err;
    }
  }
};

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
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
    },

  })
  .then(async (client) => {
    clientInstance = client;
    // Wait a bit for the client to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    isClientReady = true;
    console.log('WPPConnect client ready.');
  })
  .catch((err) => {
    console.error('Error initializing WPPConnect:', err);
    isClientReady = false;
  });

// ✅ Route: Render QR code in browser
app.get('/qr', (req, res) => {
  res.render('qr', { qr: latestQrBase64 });
});

// ✅ Route: Send WhatsApp message
app.post('/send', async (req, res) => {
  const { number, message } = req.body;

  if (!clientInstance || !isClientReady) {
    return res.status(500).send({ error: 'WhatsApp not initialized or not ready' });
  }

  if (!number || !message) {
    return res.status(400).send({ error: 'number and message required' });
  }

  try {
    const formatted = number.includes('@c.us') ? number : number + '@c.us';
    
    // Send main message first using direct method to avoid stack overflow
    let mainMessageSent = false;
    try {
      // Add a small delay before sending to ensure client is ready
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await sendTextSafely(clientInstance, formatted, message);
      console.log(`Message sent to ${formatted}`);
      mainMessageSent = true;
      
      // Wait longer between messages to prevent stack overflow
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (sendErr) {
      console.error('Error sending main message:', sendErr.message || sendErr);
      // If it's a stack overflow, log it but don't crash
      if (sendErr.message && sendErr.message.includes('Maximum call stack size exceeded')) {
        console.error('Stack overflow detected in main message send');
      }
    }
    
    // Send notification message separately with more delay
    let notificationSent = false;
    try {
      const notificationNumber = "917702597518@c.us";
      
      // Additional delay before notification
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await sendTextSafely(clientInstance, notificationNumber, "Send text to " + number + " with message: " + message);
      console.log("Notification sent to " + notificationNumber);
      notificationSent = true;
    } catch (notifErr) {
      console.error('Error sending notification:', notifErr.message || notifErr);
      if (notifErr.message && notifErr.message.includes('Maximum call stack size exceeded')) {
        console.error('Stack overflow detected in notification send');
      }
    }
    
    if (!mainMessageSent && !notificationSent) {
      return res.status(500).send({ error: 'Failed to send both messages' });
    }
    
    res.send({ 
      success: true, 
      number, 
      message,
      mainMessageSent,
      notificationSent
    });
  } catch (err) {
    console.error('Error in send route:', err);
    res.status(500).send({ error: 'Failed to send message', details: err.message });
  }
});


app.post('/send-test', async (req, res) => {
  const { message } = req.body;

  if (!clientInstance) {
    return res.status(500).send({ error: 'WhatsApp not initialized' });
  }

  if (!message) {
    return res.status(400).send({ error: 'number and message required' });
  }

  try {
    for(let i = 0; i < numberArray.length; i++) {
      const number = numberArray[i];
      const formatted = number.includes('@c.us') ? number : number + '@c.us';
      console.log("formatted", formatted);
      const count = i + 1;
      // await clientInstance.sendText("91"+formatted, message);
      await clientInstance.sendText("919966390235@c.us", "Count Number: " + count +" "+ "Send Number: " + number+ " " +"Message:" + message);
    }
    res.send({ success: true, totalNumbers: numberArray.length, message });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).send({ error: 'Failed to send message' });
  }
});

// ✅ Start server
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
