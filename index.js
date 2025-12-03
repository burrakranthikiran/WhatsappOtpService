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

let numberArray = [];
const app = express();
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

let clientInstance = null;
let latestQrBase64 = null;
let isClientReady = false;

// Helper function to send text with retry and error handling (workaround for stack overflow and detached frames)
const sendTextSafely = async (client, to, message, retries = 3) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Check if client is ready before attempting to send
      if (!client || !isClientReady) {
        throw new Error('Client not ready');
      }
      
      // Try using sendText with a timeout to prevent hanging
      const sendPromise = client.sendText(to, message);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Send timeout')), 30000)
      );
      
      await Promise.race([sendPromise, timeoutPromise]);
      return true;
    } catch (err) {
      const errorMessage = err.message || String(err);
      const isStackOverflow = errorMessage.includes('Maximum call stack size exceeded');
      const isDetachedFrame = errorMessage.includes('detached Frame') || errorMessage.includes('detached frame');
      const isTimeout = errorMessage.includes('Send timeout');
      
      // Retry for stack overflow, detached frame, or timeout errors
      if ((isStackOverflow || isDetachedFrame || isTimeout) && attempt < retries) {
        const delay = isDetachedFrame ? 5000 * (attempt + 1) : 3000 * (attempt + 1);
        console.warn(`${isDetachedFrame ? 'Detached frame' : isStackOverflow ? 'Stack overflow' : 'Timeout'} on attempt ${attempt + 1}, retrying after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If it's the last attempt or not a retryable error, throw
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
      if(statusSession === "inChat"){
     
      }
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
      
      // await sendTextSafely(clientInstance, notificationNumber, "Send text to " + number + " with message: " + message);
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


app.post('/send-bulk', async (req, res) => {
  const { message, fileName } = req.body;
  if (!clientInstance) {
    return res.status(500).send({ error: 'WhatsApp not initialized' });
  }

  if (!message) {
    return res.status(400).send({ error: 'number and message required' });
  }
   numberArray = JSON.parse(fs.readFileSync(path.join(__dirname, 'phoneNumber/'+fileName+".json"), 'utf8'));
   bulkWhatsMessage(message);
  res.send({ 
    success: true, 
    data: "BroadCast Started"
  });
});



async function bulkWhatsMessage(message) {
  // TODO: implement bulk messaging flow
  console.log("Working", "Status");

  try {
    let successCount = 0;
    let failCount = 0;
    
    for(let i = 0; i < numberArray.length; i++) {
      // Check if client is ready before each iteration
      if (!clientInstance || !isClientReady) {
        console.error('WhatsApp client not initialized or not ready. Stopping bulk send.');
        break;
      }
    
      if (!message) {
        console.error('Message is required');
        break;
      }
      
      const number = numberArray[i];
      // Normalize number and build a valid WhatsApp JID
      let rawNumber = String(number).trim();

      // Remove any existing WhatsApp suffix
      if (rawNumber.endsWith('@c.us')) {
        rawNumber = rawNumber.replace('@c.us', '');
      }

      // Ensure country code (default to India 91 – adjust if needed)
      if (!rawNumber.startsWith('91')) {
        rawNumber = '91' + rawNumber;
      }

      // Basic sanity check – skip clearly invalid numbers
      if (!/^\d{12,15}$/.test(rawNumber)) {
        console.warn('Skipping invalid number:', number);
        failCount++;
        continue;
      }

      const jid = `${rawNumber}@c.us`;
      console.log("formatted", jid);
      const count = i + 1;
      console.log("status:", "Progress... 🚀");
      
      try {
        // Use sendTextSafely with retry logic for detached frame errors
        await sendTextSafely(clientInstance, jid, message, 3);
        console.log(`Message sent to ${jid} (${count}/${numberArray.length}). Waiting 30 seconds before next message...`);
        successCount++;
        await new Promise(r => setTimeout(r, 30000)); // 30 seconds delay
      } catch (err) {
        const errorMsg = err.message || String(err);
        console.error(`Error sending message to ${jid}:`, errorMsg);
        failCount++;
        // Continue with next number even if this one fails
        // Add a shorter delay before retrying next number
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      if(count === numberArray.length){
        console.log("status", "Completed");
        try {
          await sendTextSafely(
            clientInstance,
            "919966390235@c.us",
            `Number of Messages Delivered: ${successCount} | Failed: ${failCount} | Total: ${numberArray.length} | Message: ${message}`,
            3
          );
        } catch (notifErr) {
          console.error('Error sending completion notification:', notifErr.message || notifErr);
        }
      }
    }
    return "SEND"
    // res.send({ success: true, totalNumbers: numberArray.length, message });
  } catch (err) {
    console.error('Error in bulk messaging:', err);
    
  }
}

// ✅ Start server
app.listen(3000, async() => {
  console.log('Server running at http://localhost:3000');
  
});


