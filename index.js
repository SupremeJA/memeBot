require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const { ApifyClient } = require("apify-client");
const schedule = require("node-schedule");

// === CONFIGURATION ===
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

// The "Supplier" bucket
let memeQueue = [];

// Reliable Instagram Sources (Bangers only)
const aggregatorHandles = [
  "goatent_",
  "boomtv_hd",
  "igtweettv",
  "tweetsavages",
  "naijatwitter",
];

// Initialize Apify
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// Initialize WhatsApp Client with Session Saving
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// === HELPER FUNCTION: THE SUPPLIER ===
async function fetchMemesFromApify(manualDebug = false) {
  const handle =
    aggregatorHandles[Math.floor(Math.random() * aggregatorHandles.length)];
  const targetUrl = `https://www.instagram.com/${handle}/`;

  console.log(
    `[Supplier] Connecting to Apify (Actor: shu8hvrXbJbY3Eb9W) to loot @${handle}...`,
  );

  try {
    // EXACT SCHEMA from your snippet
    const input = {
      directUrls: [targetUrl],
      resultsType: "posts",
      resultsLimit: 3,
      searchType: "user",
      addParentData: false,
    };

    // Run the Official Actor
    const run = await apifyClient.actor("shu8hvrXbJbY3Eb9W").call(input);

    // Fetch results
    const { items } = await apifyClient
      .dataset(run.defaultDatasetId)
      .listItems();

    let newCount = 0;

    items.forEach((post) => {
      // The Official Actor usually puts the image in 'displayUrl' or 'url'
      const imgUrl = post.displayUrl || post.url;
      const caption = post.caption || "";

      const isAd =
        caption.toLowerCase().includes("bet9ja") ||
        caption.toLowerCase().includes("promoted") ||
        caption.toLowerCase().includes("live") ||
        caption.toLowerCase().includes("download");

      if (imgUrl && !isAd) {
        const exists = memeQueue.some((m) => m.url === imgUrl);

        if (!exists) {
          memeQueue.push({
            url: imgUrl,
            caption: `📢 *Via @${handle}*\n\n${caption.substring(0, 200)}...`,
          });
          newCount++;
        }
      }
    });

    console.log(
      `[Supplier] Success! Added ${newCount} new bangers. Queue size: ${memeQueue.length}`,
    );

    if (manualDebug)
      return `✅ **Test Success!**\nFetched ${newCount} memes from @${handle}.\nCurrent Queue: ${memeQueue.length}`;
    return true;
  } catch (error) {
    console.error("[Supplier Error]", error.message);
    if (manualDebug) return `❌ **Test Failed**\nError: ${error.message}`;
    return false;
  }
}

// === SCHEDULER 1: RE-STOCK (Runs 5 times a day) ===
// 8am, 12pm, 4pm, 8pm, 11pm
// schedule.scheduleJob("0 8,12,16,20,23 * * *", () => fetchMemesFromApify());

// // === SCHEDULER 2: DEALER (Runs every 30 mins) ===
// schedule.scheduleJob("*/30 * * * *", async () => {
//   // 1. Sleep Mode (1AM to 6AM - Don't send)
//   const hour = new Date().getHours();
//   if (hour >= 1 && hour < 6) return;

//   // 2. Check Queue
//   if (memeQueue.length === 0) {
//     console.log("[Dealer] Queue empty. Triggering emergency restock...");
//     await fetchMemesFromApify(); // Emergency fetch
//   }

//   if (memeQueue.length > 0) {
//     const banger = memeQueue.shift();
//     try {
//       // OLD: const media = await MessageMedia.fromUrl(banger.url);
//       // NEW:
//       const media = await downloadMedia(banger.url);

//       if (media) {
//         await client.sendMessage(TARGET_GROUP_ID, media, {
//           caption: banger.caption,
//         });
//         console.log("[Dealer] Banger sent successfully.");
//       }
//     } catch (e) {
//       console.error("[Dealer] Failed to send media:", e.message);
//     }
//   }
// });

async function downloadMedia(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer", // vital for images
      timeout: 30000, // 30 seconds
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const mimetype = response.headers["content-type"] || "image/jpeg";
    const data = Buffer.from(response.data).toString("base64");

    return new MessageMedia(mimetype, data, "banger.jpg");
  } catch (error) {
    console.log(error);
    console.error(`[Download Failed] ${error.message}`);
    return null;
  }
}

// === WHATSAPP EVENTS ===

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Scan the QR code to log in!");
});

client.on("ready", () => {
  console.log("🤖 Bot is Online!");
  console.log("Scheduler is active. Waiting for trigger times...");
  message.reply("Bot is Online!");
});

client.on("message_create", async (message) => {
  const body = message.body.toLowerCase();

  // === COMMAND: MANUAL BANGER ===
  if (body === "!banger") {
    if (memeQueue.length > 0) {
      const banger = memeQueue.shift();
      const media = await downloadMedia(banger.url);
      const chatDestination = message.fromMe ? message.to : message.from;
      if (media) {
        await client.sendMessage(chatDestination, media, {
          caption: banger.caption,
          isViewOnce: true,
        });
      } else {
        message.reply(
          "Omo, I found the meme but network refused to download it.",
        );
      }
    } else {
      return message.reply(
        "Queue is empty. You can refill it by running !testapify",
      );
      // await fetchMemesFromApify();
      // if (memeQueue.length > 0) {
      //   const banger = memeQueue.shift();
      //   const media = await MessageMedia.fromUrl(banger.displayUrl);
      //   return client.sendMessage(message.from, media, {
      //     caption: banger.caption,
      //   });
      // } else {
      //   return message.reply("Apify is busy or credits low. Try again later.");
      // }
    }
  }

  // === COMMAND: SYSTEM TEST ===
  if (body === "!testapify") {
    if (!message.fromMe) return; // Only allow YOU to run this
    message.reply("🔄 Testing Apify connection... Hold on.");
    const result = await fetchMemesFromApify(true);
    return message.reply(result);
  }

  // === COMMAND: CHECK QUEUE ===
  if (body === "!queue") {
    // 1. Log the full details to your VS Code terminal (Safe)
    console.log("CURRENT QUEUE:", JSON.stringify(memeQueue, null, 2));

    // 2. Only send the summary to WhatsApp (Won't crash)
    return client.sendMessage(
      chatDestination,
      `📦 **Stock Level:** ${memeQueue.length} memes currently in the chamber.`,
    );
  }

  // === COMMAND: HELP ===
  if (body === "!help") {
    const text = [
      "🤖 *BOT COMMANDS*",
      "",
      "*!banger* - Force send a meme now",
      "*!queue* - Check meme stock",
      "*!testapify* - Debug Apify connection (Owner only)",
      "",
      "_Auto-posting every 30 mins_",
    ];
    return message.reply(text.join("\n"));
  }
});

client.initialize();
