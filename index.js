require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const { ApifyClient } = require("apify-client");
const schedule = require("node-schedule");
const fs = require("fs");

// === CONFIGURATION ===
const APIFY_TOKEN = process.env.APIFY_TOKEN;
let TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

// === DATA STRUCTURES ===
// 1. QUEUE: Array for First-In-First-Out (Upcoming memes)
let memeQueue = [
  {
    url: "https://images.apifyusercontent.com/jtfK0fIpo-rOTjljGgrEuecDxSV31owSEg_eIQ0le-4/cb:1/aHR0cHM6Ly9zY29udGVudC1sYXgzLTEuY2RuaW5zdGFncmFtLmNvbS92L3Q1MS4yODg1LTE1LzIxMzcxOTIyXzQ3MDQ0ODY1NjY3NTg5Nl80ODIzMzkxMjA1NjI0NjQzNTg0X24uanBnP3N0cD1kc3QtanBnX2UzNV90dDYmX25jX2h0PXNjb250ZW50LWxheDMtMS5jZG5pbnN0YWdyYW0uY29tJl9uY19jYXQ9MTA0Jl9uY19vYz1RNmNaMlFFTFZJSzQwOUJHWVVOZEJBUlJObHByY211YjluY3JGUlpwNGJCRVN2Yi1FTFpaSkFwQXRfZzBJdWh1WjBLM3B2cyZfbmNfb2hjPW15VDNiSDhuX2FvUTdrTnZ3RXNrMUpJJl9uY19naWQ9WVJGV3BzQ0d4SU9ISmJYSzlwSDRrUSZlZG09QVBzMTdDVUJBQUFBJmNjYj03LTUmb2g9MDBfQWZweWQzNFQ2U3l2OUpCTDJmRWFNUTk3Z0kxdzJRYlNjRUlaYVlidUFKQnVDdyZvZT02OTc5REVCRCZfbmNfc2lkPTEwZDEzYg.jpg",
    caption: "😂😂 ",
  },
];

// 2. HISTORY: Array to remember what we sent (For "pls send")
let sentHistory = [];

// Reliable Instagram Sources
const aggregatorHandles = [
  "goatent_",
  "boomtv_hd",
  "igtweettv",
  "tweetsavages",
  "naijatwitter",
];

// Initialize Apify
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// === HELPER: DOWNLOAD MEDIA ===
async function downloadMedia(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const mimetype = response.headers["content-type"] || "image/jpeg";
    const data = Buffer.from(response.data).toString("base64");
    return new MessageMedia(mimetype, data, "banger.jpg");
  } catch (error) {
    console.error(`[Download Failed] ${error.message}`);
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
      resultsLimit: 3,
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

      if (imgUrl && !isAd) {
        // Duplicate Check
        const exists = memeQueue.some((m) => m.url === imgUrl);
        if (!exists) {
          // Push to QUEUE (Not History yet)
          memeQueue.push({
            url: imgUrl,
            caption: caption.substring(0, 200), // Truncate long captions
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

// === SCHEDULER 1: RE-STOCK (Keep the Fridge Full) ===
// Runs every 4 hours to fetch new memes from Instagram
schedule.scheduleJob("0 */4 * * *", async () => {
  console.log("[Scheduler] Triggering routine restock...");
  await fetchMemesFromApify();
});

// === SCHEDULER 2: THE BATCH DEALER (Auto-Poster) ===
// Runs at 8:00 AM, 12:00 PM, 5:00 PM, 9:00 PM
schedule.scheduleJob("0 8,12,17,21 * * *", async () => {
  console.log("⏰ [Dealer] It's posting time!");

  if (!TARGET_GROUP_ID) {
    console.log("⚠️ [Dealer] No Target Group ID set. Use !setgroup first.");
    return;
  }

  // Emergency Restock if we don't have enough for a batch
  if (memeQueue.length < 5) {
    console.log("[Dealer] Not enough memes! Fetching more first...");
    await fetchMemesFromApify();
  }

  // Send a batch of 5 (or however many we have)
  const batchSize = 5;

  for (let i = 0; i < batchSize; i++) {
    if (memeQueue.length === 0) {
      console.log("[Dealer] Queue ran out mid-batch.");
      break;
    }

    const banger = memeQueue.shift();
    console.log(`[Dealer] Sending meme ${i + 1}/${batchSize}...`);

    const media = await downloadMedia(banger.url);

    if (media) {
      try {
        const sentMsg = await client.sendMessage(TARGET_GROUP_ID, media, {
          caption: banger.caption,
          isViewOnce: true, // Send as View Once (remove this line if you want them permanent)
        });

        // Add to History (so 'pls send' works)
        sentHistory.push({ id: sentMsg.id._serialized, url: banger.url });
        if (sentHistory.length > 50) sentHistory.shift();
      } catch (err) {
        console.error(`[Dealer] Failed to send meme: ${err.message}`);
      }
    }

    // 🛑 IMPORTANT: Wait 10-20 seconds between memes to avoid spam bans
    const delay = Math.floor(Math.random() * 10000) + 10000; // 10s to 20s
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  console.log("✅ [Dealer] Batch complete.");
});

// === WHATSAPP EVENTS ===

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Scan the QR code to log in!");
});

client.on("ready", () => {
  console.log("🤖 Bot is Online!");
});

client.on("message_create", async (message) => {
  const chat = await message.getChat();
  const body = message.body.toLowerCase();

  // Logic to determine where to send replies
  const chatDestination = message.fromMe ? message.to : message.from;

  function noPermission(text) {
    message.reply(text || "You don't get to say that, broski 😑");
    return;
  }
  // === COMMAND: SET TARGET GROUP ===
  if (body === "!setgroup") {
    if (!message.fromMe) {
      noPermission();
    }

    const newGroupId = chat.id._serialized;
    TARGET_GROUP_ID = newGroupId;

    try {
      const envPath = "./.env";
      let envContent = "";

      // Handle if file doesn't exist
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf8");
      }

      const regex = /^TARGET_GROUP_ID=.*$/m;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `TARGET_GROUP_ID=${newGroupId}`);
      } else {
        envContent += `\nTARGET_GROUP_ID=${newGroupId}`;
      }

      fs.writeFileSync(envPath, envContent);
      return message.reply(`✅ Target group updated: ${chat.name}`);
    } catch (error) {
      console.error(error);
      return message.reply("❌ Error saving configuration.");
    }
  }

  // === COMMAND: MANUAL BANGER ===
  if (body === "!banger") {
    if (memeQueue.length > 0) {
      // 1. Get from QUEUE
      const banger = memeQueue.shift();

      const media = await downloadMedia(banger.url);
      if (media) {
        // 2. Send Message
        const sentMsg = await client.sendMessage(chatDestination, media, {
          caption: banger.caption,
          isViewOnce: true,
        });

        // 3. Add to HISTORY (for pls send)
        sentHistory.push({
          id: sentMsg.id._serialized,
          url: banger.url,
        });

        // Keep history clean (max 50 items)
        if (sentHistory.length > 50) sentHistory.shift();
      } else {
        message.reply("Omo, network refused to download it.");
      }
    } else {
      return message.reply("Queue is empty. Run !testapify");
    }
  }

  // === COMMAND: SYSTEM TEST ===
  if (body === "!testapify") {
    if (!message.fromMe) noPermission();
    message.reply("🔄 Testing Apify...");
    const result = await fetchMemesFromApify(true);
    return message.reply(result);
  }

  // === COMMAND: CHECK QUEUE ===
  if (body === "!queue") {
    console.log("CURRENT QUEUE:", JSON.stringify(memeQueue, null, 2));
    return client.sendMessage(
      chatDestination,
      `📦 **Storage Level:** ${memeQueue.length} memes.`,
    );
  }

  // === COMMAND: SEND PLS ===
  // Triggers on "send pls", "send please", "pls send", "save", "steal"
  if (
    message.hasQuotedMsg &&
    (body.includes("send") || body === "save" || body === "steal")
  ) {
    const quotedMsg = await message.getQuotedMessage();
    const quotedMsgID = quotedMsg.id._serialized;

    // 1. Check HISTORY
    const historyItem = sentHistory.find((item) => item.id === quotedMsgID);

    if (historyItem) {
      console.log(`[Pls Send] Found in history! URL: ${historyItem.url}`);
      await message.react("⚡"); // React Lightning (Cache Hit)

      try {
        const media = await downloadMedia(historyItem.url);
        if (media) {
          // Send as normal image (not view once)
          await client.sendMessage(chatDestination, media, {
            caption: "Here you go 😌",
          });
          await message.react("✅");
        } else {
          await message.reply("Something went wrong 😟");
        }
      } catch (error) {
        console.error(error);
        await message.react("❌");
      }
    } else {
      // 2. Fallback: Try to download directly (If not view once)
      console.log("[Pls Send] Not in history, trying direct download...");
      try {
        if (quotedMsg.hasMedia) {
          const media = await quotedMsg.downloadMedia();
          await message.reply(media);
        } else {
          message.reply("I don't have that one in memory anymore 🫠");
        }
      } catch (e) {
        message.reply("Cannot download. It might be expired 🥲");
      }
    }
  }
});

client.initialize();
