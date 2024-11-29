require("dotenv").config();
const { _isArray } = require("../utils.js");

const settings = {
  TIME_SLEEP: process.env.TIME_SLEEP ? parseInt(process.env.TIME_SLEEP) : 8,
  MAX_THEADS: process.env.MAX_THEADS ? parseInt(process.env.MAX_THEADS) : 10,
  AMOUNT_ATTACK: process.env.AMOUNT_ATTACK ? parseInt(process.env.AMOUNT_ATTACK) : 10,
  MAX_UPGRADE_PRICE: process.env.MAX_UPGRADE_PRICE ? parseInt(process.env.MAX_UPGRADE_PRICE) : 10,
  SKIP_TASKS: process.env.SKIP_TASKS ? JSON.parse(process.env.SKIP_TASKS.replace(/'/g, '"')) : [],
  DAILY_COMBO: process.env.DAILY_COMBO ? JSON.parse(process.env.DAILY_COMBO.replace(/'/g, '"')) : [],
  LEADERS: process.env.LEADERS ? JSON.parse(process.env.LEADERS.replace(/'/g, '"')) : ["floki", "ant", "cz", "pepe", "elon", "wif"],
  DAILY_TASKS: process.env.DAILY_TASKS ? JSON.parse(process.env.DAILY_TASKS.replace(/'/g, '"')) : ["tap", "spinTheWheel", "upgrade"],
  AUTO_TASK: process.env.AUTO_TASK ? process.env.AUTO_TASK.toLowerCase() === "true" : false,
  AUTO_TAP: process.env.AUTO_TAP ? process.env.AUTO_TAP.toLowerCase() === "true" : false,
  AUTO_SPIN: process.env.AUTO_SPIN ? process.env.AUTO_SPIN.toLowerCase() === "true" : false,
  GUILD_BONUS: "21dffe24-6e74-4642-8189-87e9be6b8366",
  AUTO_DAILY_COMBO: process.env.AUTO_DAILY_COMBO ? process.env.AUTO_DAILY_COMBO.toLowerCase() === "true" : false,
  CONNECT_WALLET: process.env.CONNECT_WALLET ? process.env.CONNECT_WALLET.toLowerCase() === "true" : false,
  AUTO_ANSER_DAILY: process.env.AUTO_ANSER_DAILY ? process.env.AUTO_ANSER_DAILY.toLowerCase() === "true" : false,
  AUTO_UPGRADE: process.env.AUTO_UPGRADE ? process.env.AUTO_UPGRADE.toLowerCase() === "true" : false,
  BONUS: process.env.BONUS ? parseInt(process.env.BONUS) : 50,
  ANSWER_DAILY: process.env.ANSWER_DAILY ? process.env.ANSWER_DAILY : null,
  REF_ID: process.env.REF_ID ? process.env.REF_ID.trim() : "372y28fcFL5",
  DELAY_BETWEEN_REQUESTS: process.env.DELAY_BETWEEN_REQUESTS && _isArray(process.env.DELAY_BETWEEN_REQUESTS) ? JSON.parse(process.env.DELAY_BETWEEN_REQUESTS) : [1, 5],
  DELAY_BETWEEN_GAME: process.env.DELAY_BETWEEN_GAME && _isArray(process.env.DELAY_BETWEEN_GAME) ? JSON.parse(process.env.DELAY_BETWEEN_GAME) : [5, 10],
  DELAY_START_BOT: process.env.DELAY_START_BOT && _isArray(process.env.DELAY_START_BOT) ? JSON.parse(process.env.DELAY_START_BOT) : [1, 15],
  DELAY_MINI_GAME_EGG: process.env.DELAY_MINI_GAME_EGG && _isArray(process.env.DELAY_MINI_GAME_EGG) ? JSON.parse(process.env.DELAY_MINI_GAME_EGG) : [3, 5],
};

module.exports = settings;
