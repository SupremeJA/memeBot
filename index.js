require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const axios = require("axios");
const { ApifyClient } = require("apify-client");
const schedule = require("node-schedule");
const fs = require("fs");
const express = require("express"); // For Render Keep-Alive
const qrcode = require("qrcode-terminal");

// === CONFIGURATION ===
const APIFY_TOKEN = process.env.APIFY_TOKEN;
let TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

// === DATA STRUCTURES ===
let memeQueue = [
  {
    url: "https://images.apifyusercontent.com/Is5RkEFbJzG950GjgrEgHuq0ZhkboCykhzBjCP9lUXM/cb:1/aHR0cHM6Ly9zY29udGVudC1hdGwzLTIuY2RuaW5zdGFncmFtLmNvbS92L3Q1MS4yODg1LTE1LzIxNDgwMzcyXzM0ODk3OTI0ODg3Njg2Nl84NDQzNzIyNzk0MTYzNzY1MjQ4X24uanBnP3N0cD1kc3QtanBnX2UzNV90dDYmX25jX2h0PXNjb250ZW50LWF0bDMtMi5jZG5pbnN0YWdyYW0uY29tJl9uY19jYXQ9MTAyJl9uY19vYz1RNmNaMlFHNmRDbG9RTVk3YVFmMTVZUkZMcDY3NmxvaDM3aU04MzhPNkl2ejEybXRfSG56TzgyRmNJRDBnT3MyRVU1OV9WVSZfbmNfb2hjPTlLN3lwdGNnSHpJUTdrTnZ3RXRWQldlJl9uY19naWQ9WDY4SEpoTzBadFlmX0ktbG5mZENLdyZlZG09QVBzMTdDVUJBQUFBJmNjYj03LTUmb2g9MDBfQWZyNGhXVWVZUDI1NkJHTnJ1NkUxNFlLZkltRU44ZXU4R1Bnc1JFRG5yb2QtQSZvZT02OTdDNzY2QSZfbmNfc2lkPTEwZDEzYg.jpg",
    caption: "hehe",
  },
];
let sentHistory = []; // { id: "messageID", url: "url" }

// Reliable Instagram Sources
const aggregatorHandles = [
  "goatent_",
  "boomtv_hd",
  "igtweettv",
  "tweetsavages",
  "naijatwitter",
  "tiaentmedia",
  "moonscholar__",
  // "chuks_tv_media",
  "memes_by_tola",
];

// Initialize Apify
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// === RENDER KEEP-ALIVE SERVER ===
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) =>
  res.send("MemeBot (Baileys Edition) is Running! 🚀"),
);
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// === HELPER: DOWNLOAD MEDIA (Returns Buffer) ===
async function downloadImageBuffer(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: "https://www.instagram.com/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
    });

    if (response.status !== 200) {
      throw new Error(`Status Code ${response.status}`);
    }

    return Buffer.from(response.data);
  } catch (error) {
    console.error(`[Download Failed] URL: ${url}`);
    if (error.response) {
      console.error(
        `[Reason] Server responded with status ${error.response.status}`,
      );
    } else {
      console.error(`[Reason] ${error.message}`);
    }
    return null;
  }
}

// === HELPER: THE SUPPLIER ===
async function fetchMemesFromApify(manualDebug = false) {
  const handle =
    aggregatorHandles[Math.floor(Math.random() * aggregatorHandles.length)];
  const targetUrl = `https://www.instagram.com/${handle}/`;
  console.log(`[Supplier] Looting @${handle}...`);

  try {
    const input = {
      directUrls: [targetUrl],
      resultsType: "posts",
      resultsLimit: 1,
      searchType: "user",
      addParentData: false,
    };

    const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call(input);
    const { items } = await apifyClient
      .dataset(run.defaultDatasetId)
      .listItems();

    let newCount = 0;
    items.forEach((post) => {
      const imgUrl = post.displayUrl || post.url;
      const caption = post.caption || "";
      const isAd =
        caption.toLowerCase().includes("bet9ja") ||
        caption.toLowerCase().includes("promoted") ||
        caption.toLowerCase().includes("live") ||
        caption.toLowerCase().includes("download");

      const isVideo = post.isVideo || post.type === "Video" || post.isReel;

      if (imgUrl && !isAd && !isVideo) {
        const exists = memeQueue.some((m) => m.url === imgUrl);
        if (!exists) {
          memeQueue.push({
            url: imgUrl,
            caption: caption.substring(0, 200),
          });
          newCount++;
        }
      }
    });

    console.log(
      `[Supplier] Success! Added ${newCount}. Queue: ${memeQueue.length}`,
    );
    if (manualDebug)
      return `✅ Added ${newCount} memes. Queue: ${memeQueue.length}`;
    return true;
  } catch (error) {
    console.error("[Supplier Error]", error.message);
    if (manualDebug) return `❌ Error: ${error.message}`;
    return false;
  }
}

// === MAIN BOT FUNCTION ===
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }), // Hide excessive logs
    browser: ["MemeBot", "Chrome", "1.0.0"],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    retryRequestDelayMs: 5000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Scan the QR code below to log in:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(
        "Connection closed due to ",
        lastDisconnect.error,
        ", reconnecting ",
        shouldReconnect,
      );
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === "open") {
      console.log("🤖 Baileys Bot is Online!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    // Helper to get text body
    const msgType = Object.keys(msg.message)[0];
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      "";
    const text = body.toLowerCase();

    const remoteJid = msg.key.remoteJid;
    const isMe = msg.key.fromMe;

    // Determine reply destination
    // In Baileys, we always send to 'remoteJid' unless we want to DM the sender of a group msg
    const replyTo = remoteJid;

    // === COMMAND: SET TARGET GROUP ===
    if (text === "!setgroup" && isMe) {
      TARGET_GROUP_ID = remoteJid;

      // Save to .env logic (Simplified for brevity)
      try {
        let envContent = fs.existsSync(".env")
          ? fs.readFileSync(".env", "utf8")
          : "";
        const regex = /^TARGET_GROUP_ID=.*$/m;
        if (regex.test(envContent)) {
          envContent = envContent.replace(
            regex,
            `TARGET_GROUP_ID=${TARGET_GROUP_ID}`,
          );
        } else {
          envContent += `\nTARGET_GROUP_ID=${TARGET_GROUP_ID}`;
        }
        fs.writeFileSync(".env", envContent);
        await sock.sendMessage(replyTo, {
          text: `✅ Target Group Set: ${TARGET_GROUP_ID}`,
        });
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // === COMMAND: MANUAL BANGER ===
    if (text === "!banger") {
      if (memeQueue.length > 0) {
        const banger = memeQueue.shift();
        const buffer = await downloadImageBuffer(banger.url);

        if (buffer) {
          const sent = await sock.sendMessage(replyTo, {
            image: buffer,
            caption: banger.caption,
            viewOnce: true, // Baileys support for View Once
          });

          // Add to History
          if (sent) {
            sentHistory.push({ id: sent.key.id, url: banger.url });
            if (sentHistory.length > 50) sentHistory.shift();
          }
        }
      } else {
        await sock.sendMessage(replyTo, { text: "Queue is empty." });
      }
      return;
    }

    // === COMMAND: TEST APIFY ===
    if (text === "!testapify" && isMe) {
      await sock.sendMessage(replyTo, { text: "🔄 Testing Apify..." });
      const result = await fetchMemesFromApify(true);
      await sock.sendMessage(replyTo, { text: result });
      return;
    }

    // === COMMAND: CHECK QUEUE ===
    if (text === "!queue") {
      console.log(JSON.stringify(memeQueue, null, 2));
      await sock.sendMessage(replyTo, {
        text: `📦 Stock: ${memeQueue.length} memes.`,
      });
      return;
    }

    // === COMMAND: PLS SEND / SAVE / STEAL ===
    const isReply = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    if (
      (text.includes("pls send") || text === "save" || text === "steal") &&
      isReply
    ) {
      const quotedId = msg.message.extendedTextMessage.contextInfo.stanzaId;

      // 1. Try History Cache First
      const cached = sentHistory.find((i) => i.id === quotedId);
      if (cached) {
        console.log("[Pls Send] Cache hit!");
        await sock.sendMessage(replyTo, {
          react: { text: "⚡", key: msg.key },
        });

        const buffer = await downloadImageBuffer(cached.url);
        if (buffer) {
          await sock.sendMessage(
            replyTo,
            { image: buffer, caption: "Here you go 📦" },
            { quoted: msg },
          );
          return;
        }
      }

      // 2. Try Downloading Quoted Media
      try {
        // We need to construct a fake message object for the download helper
        // This part is tricky in Baileys, simplified here:
        const quotedMessage =
          msg.message.extendedTextMessage.contextInfo.quotedMessage;
        // Basic check if it has an image
        if (
          quotedMessage.imageMessage ||
          quotedMessage.viewOnceMessageV2?.message?.imageMessage
        ) {
          await sock.sendMessage(replyTo, {
            react: { text: "👀", key: msg.key },
          });

          // Baileys 'downloadMediaMessage' needs the full message object structure
          // It's often easier to rely on the cache method for view once
          // But for normal images:
          const buffer = await downloadMediaMessage(
            {
              key: { remoteJid: remoteJid, id: quotedId },
              message: quotedMessage,
            },
            "buffer",
            {},
            { logger: pino({ level: "silent" }) },
          );

          await sock.sendMessage(
            replyTo,
            { image: buffer, caption: "Stolen! 📦" },
            { quoted: msg },
          );
          await sock.sendMessage(replyTo, {
            react: { text: "✅", key: msg.key },
          });
        } else {
          await sock.sendMessage(replyTo, {
            text: "I can't see any image there.",
          });
        }
      } catch (e) {
        console.error("Pls Send Error:", e.message);
        await sock.sendMessage(replyTo, {
          text: "Could not download. It might be expired or I don't have the history.",
        });
      }
    }
  });

  // === SCHEDULER ===
  // Runs every 4 hours to fetch
  schedule.scheduleJob("0 */4 * * *", () => fetchMemesFromApify());

  // Runs batches at 8am, 12pm, 5pm, 9pm
  schedule.scheduleJob("0 8,12,17,21 * * *", async () => {
    if (!TARGET_GROUP_ID) return console.log("No Target Group Set");
    if (memeQueue.length < 5) await fetchMemesFromApify();

    for (let i = 0; i < 5; i++) {
      if (memeQueue.length === 0) break;
      const banger = memeQueue.shift();
      const buffer = await downloadImageBuffer(banger.url);

      if (buffer) {
        const sent = await sock.sendMessage(TARGET_GROUP_ID, {
          image: buffer,
          caption: banger.caption,
          viewOnce: true,
        });
        if (sent) {
          sentHistory.push({ id: sent.key.id, url: banger.url });
          if (sentHistory.length > 50) sentHistory.shift();
        }
      }
      // Delay 10-20s
      await new Promise((r) => setTimeout(r, 10000 + Math.random() * 10000));
    }
  });
}

// Start the bot
connectToWhatsApp();
