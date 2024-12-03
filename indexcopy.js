import dotenv from "dotenv";
dotenv.config();

import { Telegraf } from "telegraf";
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

🛠️ After importing your wallet, simply provide the required details to proceed with your transactions!
`;

bot.start(async (ctx) => {
  const userName = ctx.from.first_name;

  await ctx.reply(`Hello ${userName}! 👋
Welcome to the Ethereum Bulk Sender Bot! 💸

You can:
- Import your wallet
- Send ETH to multiple recipients
- Send ERC20 tokens to multiple recipients

Type /help to see detailed examples and formats for each action.`);
});

// Display Help Menu
bot.command("help", async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: "Markdown" });
});

// Handle user inputs dynamically
bot.on("text", async (ctx) => {
  const userMessage = ctx.message.text.trim();

  // Check for private key or wallet address
  if (isPrivateKey(userMessage)) {
    try {
      userWallet = new ethers.Wallet(userMessage, provider);
      await ctx.reply(
        `Wallet successfully imported! 🎉\nAddress: ${userWallet.address}\n\nYou can now proceed to send ETH or ERC20 tokens. Type /help for examples.`
      );
    } catch (error) {
      await ctx.reply(
        "Failed to import wallet. Please provide a valid private key."
      );
    }
    return;
  }

  // Check if the input includes a space
  if (userMessage.includes(" ")) {
    // This is likely a token transfer
    const parts = userMessage.split(" ");
    if (parts.length !== 2) {
      await ctx.reply(
        "Invalid token transfer format. Use:\n" +
          "`0xTokenAddress Recipient1,Recipient2-Amount1,Amount2`\n" +
          "Example:\n" +
          "`0xYourTokenAddress 0xRecipient1,0xRecipient2-1.5,2.0`"
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
      // Validate and process token transfer
      //   if (!ethers.isAddress(tokenAddress)) {
      //     await ctx.reply(
      //       "Invalid token address. Please provide a valid ERC20 token address."
      //     );
      //     return;
      //   }
      if (!userWallet) {
        await ctx.reply(
          "Please import your wallet using the menu option before sending transactions."
        );
        return;
      }
      if (recipients.length !== amounts.length) {
        await ctx.reply(
          "Mismatch between the number of recipients and amounts. Please try again."
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
  } else if (userMessage.includes("-")) {
    // This is likely an ETH transfer
    const [recipientsPart, amountsPart] = userMessage.split("-");
    const recipients = recipientsPart
      .split(",")
      .map((address) => address.trim());
    const amounts = amountsPart
      .split(",")
      .map((amount) => ethers.parseEther(amount.trim()));

    try {
      // Validate and process ETH transfer
      if (!userWallet) {
        await ctx.reply(
          "Please import your wallet using the menu option before sending transactions."
        );
        return;
      }
      if (recipients.length !== amounts.length) {
        await ctx.reply(
          "Mismatch between the number of recipients and amounts. Please try again."
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
  } else {
    // Invalid format
    await ctx.reply(
      "Invalid input. Please follow the correct format:\n\n" +
        "**For ETH Transfers:**\n" +
        "`Recipient1,Recipient2-Amount1,Amount2`\n\n" +
        "**For Token Transfers:**\n" +
        "`0xTokenAddress Recipient1,Recipient2-Amount1,Amount2`\n\n" +
        "Use the menu options for more guidance."
    );
  }
});

// Utility: Detect if the input is a private key
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

  console.log("amounts:::", amounts);

  const decimalsResult = await tokenContract.decimals();

  // Convert amounts to full token units
  const amountArray = amounts.map((amt) =>
    ethers.parseUnits(amt, decimalsResult)
  );

  // Calculate the total amount
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

// Function to send bulk ERC20 tokens
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
  console.log("Bot has been launched and is running...");
});
