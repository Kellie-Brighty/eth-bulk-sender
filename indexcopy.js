import dotenv from "dotenv";
dotenv.config();

import { Telegraf, Markup } from "telegraf";
import { ethers } from "ethers";
import Abi from "./bulkSenderAbi.js";
import approveAbi from "./approveAbi.js";

// Initialize the Telegram bot and provider
const bot = new Telegraf(process.env.TELEGRAM_API_TOKEN);
const provider = new ethers.JsonRpcProvider(process.env.INFURA_URL);
let userWallet;

// Help Menu Content
const helpMessage = `
📖 **Actions You Can Perform:**

1️⃣ **Import Wallet**
   - Provide your Ethereum private key (e.g., \`0x123abc...\`).
   - Example: \`0xYOUR_PRIVATE_KEY_HERE\`

2️⃣ **Send ETH to Multiple Recipients**
   - Format: \`recipient1,recipient2,recipient3-amount1,amount2,amount3\`
   - Example: 
     \`\`\`
     0xAbc123...,0xDef456...,0xGhi789...-0.1,0.2,0.3
     \`\`\`

3️⃣ **Send ERC20 Tokens to Multiple Recipients**
   - Format: \`ERC20 tokenAddress recipient1,recipient2-amount1,amount2\`
   - Example: 
     \`\`\`
     0xTokenAddress123 0xAbc123...,0xDef456...-10,20
     \`\`\`

4️⃣ **See Help**
   - Type \`/help\` to see this guide again!

🛠️ After selecting an action from the menu, simply provide the required details to proceed with your transactions!
`;

// Command: Start
bot.start(async (ctx) => {
  const userName = ctx.from.first_name;

  await ctx.reply(
    `Hello ${userName}! 👋\nWelcome to the Ethereum Bulk Sender Bot! 💸`,
    Markup.inlineKeyboard([
      [Markup.button.callback("📜 Help", "show_help")],
      [Markup.button.callback("🛠️ Import Private Key", "import_key")],
      [
        Markup.button.callback(
          "💵 Send ETH to Multiple Recipients",
          "send_eth"
        ),
      ],
      [Markup.button.callback("🔗 Send ERC20 Tokens", "send_tokens")],
    ])
  );
});

// Command: Help
bot.command("help", async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: "Markdown" });
});

// Action: Show Help
bot.action("show_help", async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: "Markdown" });
  await ctx.answerCbQuery();
});

// Action: Import Private Key
bot.action("import_key", async (ctx) => {
  await ctx.reply("Please send your private key:");
  await ctx.answerCbQuery();
});

// Action: Send ETH
bot.action("send_eth", async (ctx) => {
  try {
    // Acknowledge the callback query immediately
    await ctx.answerCbQuery();

    // Then respond to the user
    await ctx.reply(
      "Please provide the details in the following format:\n\n`Recipient1,Recipient2-Amount1,Amount2`\n\nExample:\n`0xAbc123...,0xDef456...-0.1,0.2`",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error handling send_eth action:", error);
  }
});

// Action: Send ERC20 Tokens
bot.action("send_tokens", async (ctx) => {
  await ctx.reply(
    "Please provide the details in the following format:\n\n`TokenAddress Recipient1,Recipient2-Amount1,Amount2`\n\nExample:\n`0xTokenAddress123 0xAbc123...,0xDef456...-10,20`",
    { parse_mode: "Markdown" }
  );
  await ctx.answerCbQuery();
});

// Handle user text input
bot.on("text", async (ctx) => {
  const userMessage = ctx.message.text.trim();

  // Check for private key
  if (isPrivateKey(userMessage)) {
    try {
      userWallet = new ethers.Wallet(userMessage, provider);
      await ctx.reply(
        `Wallet successfully imported! 🎉\nAddress: ${userWallet.address}\n\nYou can now proceed to send ETH or ERC20 tokens.`
      );
    } catch (error) {
      await ctx.reply(
        "Failed to import wallet. Please provide a valid private key."
      );
    }
    return;
  }

  // Check for ETH transfer
  if (userMessage.includes("-") && !userMessage.includes(" ")) {
    const [recipientsPart, amountsPart] = userMessage.split("-");
    const recipients = recipientsPart
      .split(",")
      .map((address) => address.trim());
    const amounts = amountsPart
      .split(",")
      .map((amount) => ethers.parseEther(amount.trim()));

    try {
      if (!userWallet) {
        await ctx.reply("Please import your wallet first.");
        return;
      }
      if (recipients.length !== amounts.length) {
        await ctx.reply(
          "Mismatch between recipients and amounts. Please check your input."
        );
        return;
      }

      const notifyMessage = await ctx.reply(
        "Processing your ETH transfer... Please wait."
      );
      const txHash = await bulkSendEther(recipients, amounts);

      await ctx.telegram.editMessageText(
        notifyMessage.chat.id,
        notifyMessage.message_id,
        null,
        `ETH transaction successfully initiated! Track it here: https://etherscan.io/tx/${txHash}`
      );
    } catch (error) {
      await ctx.reply(`Error during ETH transfer: ${error.message}`);
    }
    return;
  }

  // Check for token transfer
  if (userMessage.includes(" ")) {
    const parts = userMessage.split(" ");
    if (parts.length !== 2) {
      await ctx.reply(
        "Invalid format for token transfer. Use:\n`TokenAddress Recipient1,Recipient2-Amount1,Amount2`"
      );
      return;
    }

    const tokenAddress = parts[0].trim();
    const [recipientsPart, amountsPart] = parts[1].split("-");
    const recipients = recipientsPart
      .split(",")
      .map((address) => address.trim());
    const amounts = amountsPart
      .split(",")
      .map((amount) => ethers.parseUnits(amount.trim(), 18));

    try {
      if (!userWallet) {
        await ctx.reply("Please import your wallet first.");
        return;
      }
      if (recipients.length !== amounts.length) {
        await ctx.reply(
          "Mismatch between recipients and amounts. Please check your input."
        );
        return;
      }

      await ctx.reply("Approving token transfer... Please wait.");
      await approveTokenTransfer(userWallet, tokenAddress, amounts);

      const notifyMessage = await ctx.reply(
        "Processing your token transfer... Please wait."
      );
      const txHash = await bulkSendTokens(
        userWallet,
        tokenAddress,
        recipients,
        amounts
      );

      await ctx.telegram.editMessageText(
        notifyMessage.chat.id,
        notifyMessage.message_id,
        null,
        `Token transaction successfully initiated! Track it here: https://etherscan.io/tx/${txHash}`
      );
    } catch (error) {
      await ctx.reply(`Error during token transfer: ${error.message}`);
    }
    return;
  }

  // Invalid input
  await ctx.reply("Invalid input. Type /help to see valid formats.");
});

// Utility: Detect if input is a private key
function isPrivateKey(input) {
  return (
    (input.length === 64 || (input.length === 66 && input.startsWith("0x"))) &&
    !input.includes("-")
  );
}

// Function to approve token transfer
async function approveTokenTransfer(wallet, tokenAddress, amounts) {
  const tokenContract = new ethers.Contract(tokenAddress, approveAbi, wallet);
  const bulkSenderAddress = "0x2bbe6252e559ea9c4d08b7cdba116ae837d0a7ac"; // Replace with your bulk sender contract address

  const decimalsResult = await tokenContract.decimals();
  const amountArray = amounts.map((amt) =>
    ethers.parseUnits(amt, decimalsResult)
  );
  const totalAmount = amountArray.reduce(
    (acc, curr) => acc.add(curr),
    ethers.BigNumber.from(0)
  );

  const tx = await tokenContract.approve(bulkSenderAddress, totalAmount);
  await tx.wait();
  return tx.hash;
}

// Function to send bulk ETH
async function bulkSendEther(recipients, amounts) {
  const contractAddress = "0x2bbe6252e559ea9c4d08b7cdba116ae837d0a7ac"; // Replace with your contract address
  const contract = new ethers.Contract(contractAddress, Abi, userWallet);

  const totalAmount = amounts.reduce((acc, curr) => acc + curr, BigInt(0));
  const tx = await contract.bulkSendEther(recipients, amounts, {
    value: totalAmount,
  });
  await tx.wait();
  return tx.hash;
}

// Function to send bulk tokens
async function bulkSendTokens(wallet, tokenAddress, recipients, amounts) {
  const contractAddress = "0x2bbe6252e559ea9c4d08b7cdba116ae837d0a7ac"; // Replace with your contract address
  const bulkSenderContract = new ethers.Contract(contractAddress, Abi, wallet);

  const tx = await bulkSenderContract.bulkSendTokens(
    tokenAddress,
    recipients,
    amounts
  );
  await tx.wait();
  return tx.hash;
}

// Start the bot
bot.launch().then(() => {
  console.log("Bot has been launched and is running.");
});
