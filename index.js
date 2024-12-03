import dotenv from "dotenv";
dotenv.config();

console.log("Telegram Bot Token:", process.env.TELEGRAM_API_TOKEN); // Debug log to check token
console.log("Infura URL:", process.env.INFURA_URL);
import { Telegraf } from "telegraf";
import { ethers } from "ethers";
import Abi from "./bulkSenderAbi.js";
import approveAbi from "./approveAbi.js";

// Initialize the Telegram bot with the bot API token
const bot = new Telegraf(process.env.TELEGRAM_API_TOKEN);

// Set up Ethers provider (Infura or any other RPC provider)
const provider = new ethers.JsonRpcProvider(process.env.INFURA_URL);
let userWallet;

// Main Start Command to show the menu
bot.command("start", async (ctx) => {
  const keyboard = [
    [{ text: "Import Wallet" }, { text: "Bulk Send ETH" }],
    [{ text: "Bulk Send ERC20" }, { text: "Help" }],
  ];
  const userName = ctx.from.first_name;

  const options = {
    reply_markup: {
      keyboard: keyboard,
      one_time_keyboard: false, // Keeps the keyboard available until the user selects an option
      resize_keyboard: true, // Adjusts the size of the keyboard
    },
  };

  await ctx.reply(
    `Hello ${userName}! 👋

    Welcome to the Ethereum Bulk Sender Bot! 💸

    Here's what you can do:

    1️⃣ **Import Wallet**: Set up your Ethereum Wallet for transactions.
    2️⃣ **Bulk Send ETH**: Send ETH to multiple recipients.
    3️⃣ **Bulk Send ERC20**: Send ERC20 tokens to multiple recipients.
    4️⃣ **Help**: View the available commands and instructions.

    Please choose an action from the options below.`,
    options
  );
});

bot.command("menu", async (ctx) => {
  const keyboard = [
    [{ text: "Import Wallet" }, { text: "Bulk Send ETH" }],
    [{ text: "Bulk Send ERC20" }, { text: "Help" }],
  ];

  const options = {
    reply_markup: {
      keyboard: keyboard,
      one_time_keyboard: false, // Keeps the keyboard available until the user selects an option
      resize_keyboard: true, // Adjusts the size of the keyboard
    },
  };

  await ctx.reply(`Please choose an action from the options below.`, options);
});

bot.on("text", async (ctx) => {
  const userMessage = ctx.message.text;

  // Handle commands (starting with "/")
  if (userMessage.startsWith("/")) {
    const [command, ...args] = userMessage.split(" "); // Split command and arguments

    switch (command) {
      case "/importwallet":
        if (args.length === 0) {
          await ctx.reply(
            "Please provide a valid private key after the /importwallet command.\n\nExample: /importwallet YourPrivateKey"
          );
          return;
        }

        const privateKey = args[0];
        try {
          let wallet;

          if (ethers.isAddress(privateKey)) {
            // Treat as a wallet address
            wallet = new ethers.Wallet(privateKey, provider);
            await ctx.reply(`Wallet set to ${privateKey}`);
          } else if (
            privateKey.length === 64 ||
            (privateKey.length === 66 && privateKey.startsWith("0x"))
          ) {
            // Treat as a private key
            wallet = new ethers.Wallet(
              privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
              provider
            );
            await ctx.reply(
              `Wallet set with private key. Address: ${wallet.address}. \n\n /menu`
            );
          } else {
            throw new Error(
              "Invalid input! Not an Ethereum address or private key."
            );
          }

          // Save the wallet (consider secure storage for production use)
          userWallet = wallet;
        } catch (error) {
          await ctx.reply(
            "Invalid input! Please provide a valid Ethereum private key."
          );
        }
        break;

      case "/bulksendeth":
        if (args.length === 0 || !userMessage.includes("-")) {
          await ctx.reply(
            "Invalid command format. Use: /bulksendeth recipient1,recipient2-amount1,amount2"
          );
          return;
        }

        try {
          const [recipientsPart, amountsPart] = args.join(" ").split("-");
          const recipients = recipientsPart
            .split(",")
            .map((address) => address.trim());
          const amounts = amountsPart
            .split(",")
            .map((amount) => ethers.parseEther(amount.trim()));

          if (recipients.length !== amounts.length) {
            await ctx.reply("Recipient and Amount lists do not match!");
            return;
          }

          const notifyMessage = await ctx.reply(
            "Processing your transaction... Please wait!"
          );

          const txHash = await bulkSendEther(recipients, amounts);

          await ctx.reply(
            `Transaction is ongoing! Track it here: https://etherscan.io/tx/${txHash}`
          );

          await ctx.telegram.editMessageText(
            notifyMessage.chat.id,
            notifyMessage.message_id,
            null,
            `Transaction successfully initiated! Tracking link: https://etherscan.io/tx/${txHash}`
          );
        } catch (error) {
          await ctx.reply(
            `Error while processing your transaction: ${error.message} ${
              error.message.includes(
                "contract runner does not support sending transactions"
              ) && `\n\n Please import your wallet.`
            }`
          );
        }
        break;

      case "/bulkSendERC20":
        if (args.length < 3) {
          await ctx.reply(
            "Invalid command format. Use: /bulkSendERC20 <tokenAddress> recipient1,recipient2-amount1,amount2"
          );
          return;
        }

        try {
          const tokenAddress = args[0];
          const [recipientsPart, amountsPart] = args
            .slice(1)
            .join(" ")
            .split("-");
          const recipients = recipientsPart
            .split(",")
            .map((address) => address.trim());
          const amounts = amountsPart
            .split(",")
            .map((amount) => ethers.utils.parseUnits(amount.trim(), 18)); // Adjust for token decimals

          if (recipients.length !== amounts.length) {
            await ctx.reply("Recipient and Amount lists do not match!");
            return;
          }

          const notifyMessage = await ctx.reply(
            "Approving the bulk sender contract for token spending... Please wait."
          );

          const approvalTxHash = await approveToken(
            userWallet,
            tokenAddress,
            "0x2bbe6252e559ea9c4d08b7cdba116ae837d0a7ac", // Bulk sender contract address
            amounts.reduce((acc, val) => acc.add(val), ethers.BigNumber.from(0))
          );

          await ctx.reply(
            `Approval successful! Tx: https://etherscan.io/tx/${approvalTxHash}`
          );

          const txHash = await bulkSendTokens(
            userWallet,
            tokenAddress,
            recipients,
            amounts
          );

          await ctx.reply(
            `Bulk token transfer initiated! Tx: https://etherscan.io/tx/${txHash}`
          );

          await ctx.telegram.editMessageText(
            notifyMessage.chat.id,
            notifyMessage.message_id,
            null,
            `Transaction successfully initiated! Tracking link: https://etherscan.io/tx/${txHash}`
          );
        } catch (error) {
          await ctx.reply(`Error during bulk token transfer: ${error.message}`);
        }
        break;

      default:
        await ctx.reply(
          "Unknown command. Please use /importwallet, /bulksendeth, or /bulkSendERC20."
        );
    }
    return;
  }

  // Handle menu options
  switch (userMessage) {
    case "Import Wallet":
      await ctx.reply(
        "Please send your Ethereum wallet private key to set your wallet.\n\nFormat: /importwallet YourPrivateKey"
      );
      break;

    case "Bulk Send ETH":
      await ctx.reply(
        "Send the command with recipient addresses and amounts: /bulksendeth recipient1,recipient2-amount1,amount2"
      );
      break;

    case "Bulk Send ERC20":
      await ctx.reply(
        "Send the command with token address, recipient addresses, and amounts: /bulkSendERC20 <tokenAddress> recipient1,recipient2-amount1,amount2"
      );
      break;

    case "Help":
      await ctx.reply(
        "This bot allows you to send Ethereum or ERC20 tokens to multiple recipients. Use the following commands:\n\n" +
          "/importwallet [private-key] - Import your ETH wallet\n" +
          "/bulksendeth [recipients]-[amounts] - Send ETH to multiple recipients\n" +
          "/bulkSendERC20 [tokenAddress] [recipients]-[amounts] - Send ERC20 tokens to multiple recipients"
      );
      break;

    default:
      await ctx.reply(
        "Please choose a valid option from the menu or use a command."
      );
  }
});

// ERC20 Approval Function
async function approveToken(wallet, tokenAddress, spenderAddress, amount) {
  const contract = new ethers.Contract(tokenAddress, approveAbi, wallet);

  const decimals = await contract.decimals(); // Retrieve token decimals
  const amountInUnits = ethers.utils.parseUnits(amount.toString(), decimals);

  const tx = await contract.approve(spenderAddress, amountInUnits);
  await tx.wait();

  return tx.hash;
}

// BulkSendTokens function (already provided)
async function bulkSendTokens(wallet, tokenAddress, recipients, amounts) {
  const contractAddress = "0x2bbe6252e559ea9c4d08b7cdba116ae837d0a7ac";
  const bulkSenderContract = new ethers.Contract(contractAddress, Abi, wallet);

  const tx = await bulkSenderContract.bulkSendTokens(
    tokenAddress,
    recipients,
    amounts
  );
  await tx.wait();

  return tx.hash;
}

// Function to send bulk ETH

async function bulkSendEther(recipients, amounts) {
  const contractAddress = "0x2bbe6252e559ea9c4d08b7cdba116ae837d0a7ac"; // Replace with your contract address
  const contract = new ethers.Contract(contractAddress, Abi, userWallet);

  const totalAmount = amounts.reduce((acc, curr) => acc + curr, BigInt(0));

  const tx = await contract.bulkSendEther(recipients, amounts, {
    value: totalAmount, // ETH amount in wei
  });

  await tx.wait();
  return tx.hash;
}

// Start the bot
bot
  .launch()
  .then(() => {
    console.log("Bot has been launched and is running...");
  })
  .catch((error) => {
    console.error("Failed to launch the bot:", error);
  });
