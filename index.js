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
    [{ text: "Help" }],
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
    3️⃣ **Help**: View the available commands and instructions.

    Please choose an action from the options below.`,
    options
  );
});

bot.command("menu", async (ctx) => {
  const keyboard = [
    [{ text: "Import Wallet" }, { text: "Bulk Send ETH" }],
    [{ text: "Help" }],
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
        // Handle bulk ETH sending
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

          // Notify the user the transaction is being processed
          const notifyMessage = await ctx.reply(
            "Processing your transaction... Please wait!"
          );

          // Send transaction
          const txHash = await bulkSendEther(recipients, amounts);

          // Notify the user with the transaction hash
          await ctx.reply(
            `Transaction is ongoing! Track it here: https://etherscan.io/tx/${txHash}`
          );

          // Optionally, edit the initial message
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

      default:
        await ctx.reply(
          "Unknown command. Please use /importwallet or /bulksendeth."
        );
    }
    return; // End command handling
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

    case "Help":
      await ctx.reply(
        "This bot allows you to send Ethereum to multiple recipients. Use the following commands:\n\n" +
          "/importwallet [private-key] - Import your ETH wallet\n" +
          "/bulksendeth [recipients]-[amounts] - Send ETH to multiple recipients"
      );
      break;

    default:
      await ctx.reply(
        "Please choose a valid option from the menu or use a command."
      );
  }
});

// bot.command("importwallet", async (ctx) => {
//   // Get the input after the /importwallet command
//   const input = ctx.message.text.split(" ")[1]; // Get the input (wallet address or private key)
//   console.log("input:::", input);

//   try {
//     // If no input is provided, reply with a helpful message
//     if (!input) {
//       return ctx.reply(
//         "Please provide a valid private key after the /importwallet command.\n\nExample: /importwallet YourPrivateKey"
//       );
//     }

//     let wallet;

//     // Check if input is a valid Ethereum address
//     if (ethers.isAddress(input)) {
//       // Treat the input as a wallet address
//       wallet = new ethers.Wallet(input, provider);
//       ctx.reply(`Wallet set to ${input}`);
//     } else if (input.length === 64 || input.length === 66) {
//       // Check if input is a valid private key (64 characters or 66 if prefixed with "0x")
//       wallet = new ethers.Wallet(
//         input.startsWith("0x") ? input : `0x${input}`,
//         provider
//       );
//       ctx.reply(`Wallet set with private key. Address: ${wallet.address}`);
//     } else {
//       throw new Error("Invalid input! Not an Ethereum address or private key.");
//     }

//     // Save the wallet globally (this is not secure; consider storing it in a database or encrypted storage)
//     userWallet = wallet;
//   } catch (error) {
//     ctx.reply("Invalid input! Please provide a valid Ethereum private key.");
//   }
// });

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

// Command to send bulk ETH
// bot.command("bulksendeth", async (ctx) => {
//   try {
//     // Ensure the command has arguments
//     const messageText = ctx.message.text;

//     if (!messageText || !messageText.includes("-")) {
//       ctx.reply(
//         "Invalid command format. Use: /bulksendeth recipient1,recipient2-amount1,amount2"
//       );
//       return;
//     }

//     const args = messageText.split(" ")[1]; // Extract part after the space
//     if (!args || !args.includes(",")) {
//       ctx.reply(
//         "Invalid command format. Use: /bulksendeth recipient1,recipient2-amount1,amount2"
//       );
//       return;
//     }

//     const [recipientsPart, amountsPart] = args.split("-"); // Split into recipients and amounts

//     if (!recipientsPart || !amountsPart) {
//       ctx.reply(
//         "Invalid command format. Use: /bulksendeth recipient1,recipient2-amount1,amount2"
//       );
//       return;
//     }

//     // Parse recipients and amounts
//     const recipients = recipientsPart
//       .split(",")
//       .map((address) => address.trim());
//     const amounts = amountsPart
//       .split(",")
//       .map((amount) => ethers.parseEther(amount.trim()));

//     if (recipients.length !== amounts.length) {
//       ctx.reply("Recipient and Amount lists do not match!");
//       return;
//     }

//     // Notify the user the transaction is being processed
//     const notifyMessage = await ctx.reply(
//       "Processing your transaction... Please wait!"
//     );

//     // Send transaction
//     const txHash = await bulkSendEther(recipients, amounts);

//     // Notify the user with the transaction hash
//     await ctx.reply(
//       `Transaction is ongoing! Track it here: https://etherscan.io/tx/${txHash}`
//     );

//     // Optionally, edit the initial message
//     await ctx.telegram.editMessageText(
//       notifyMessage.chat.id,
//       notifyMessage.message_id,
//       null,
//       `Transaction successfully initiated! Tracking link: https://etherscan.io/tx/${txHash}`
//     );
//   } catch (error) {
//     ctx.reply(`Error while processing your transaction: ${error.message}`);
//   }
// });

// Start the bot
bot
  .launch()
  .then(() => {
    console.log("Bot has been launched and is running...");
  })
  .catch((error) => {
    console.error("Failed to launch the bot:", error);
  });
