const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const readline = require("readline");
const { HttpsProxyAgent } = require("https-proxy-agent");
const printLogo = require("./src/logo");
const headers = require("./src/header");
const log = require("./src/logger");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { loadData, sleep, updateEnv, getRandomNumber, getRandomElement } = require("./utils");

class DropeeAPIClient {
  constructor(queryId, accountIndex, proxy) {
    this.baseUrl = "https://dropee.clicker-game-api.tropee.com/api/game";
    this.headers = headers;
    this.today = new Date();
    this.tokenFile = path.join(__dirname, "token.json");
    this.loadTokens();
    this.queryId = queryId;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIp = "Unknown IP";
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.skipTasks = settings.SKIP_TASKS;
  }

  #load_session_data() {
    try {
      const filePath = path.join(__dirname, "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    this.log(`Tạo user agent...`);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(__dirname, "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  async #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `"Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127"`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      const telegramauth = this.queryId;
      const userData = JSON.parse(decodeURIComponent(telegramauth.split("user=")[1].split("&")[0]));
      this.session_name = userData.id;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Kiểm tra lại query_id, hoặc thay query)id mới: ${error.message}`);
    }
  }

  loadTokens() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        this.tokens = JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      } else {
        this.tokens = {};
        fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
      }
    } catch (error) {
      this.log(`Error loading tokens: ${error.message}`, "error");
      this.tokens = {};
    }
  }

  saveToken(userId, token) {
    try {
      this.tokens[userId] = token;
      fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
      this.log(`Token saved for user ${userId}`, "success");
    } catch (error) {
      this.log(`Error saving token: ${error.message}`, "error");
    }
  }

  isTokenExpired(token) {
    if (!token) return true;

    try {
      const [, payload] = token.split(".");
      if (!payload) return true;

      const decodedPayload = JSON.parse(Buffer.from(payload, "base64").toString());
      const now = Math.floor(Date.now() / 1000);

      if (!decodedPayload.exp) {
        this.log("Eternal token", "warning");
        return false;
      }

      const expirationDate = new Date(decodedPayload.exp * 1000);
      const isExpired = now > decodedPayload.exp;

      this.log(`Token expires after: ${expirationDate.toLocaleString()}`, "custom");
      this.log(`Token status: ${isExpired ? "Expired" : "Valid"}`, isExpired ? "warning" : "success");

      return isExpired;
    } catch (error) {
      this.log(`Error checking token: ${error.message}`, "error");
      return true;
    }
  }

  async getValidToken(userId, initData) {
    const existingToken = this.tokens[userId];

    if (existingToken && !this.isTokenExpired(existingToken)) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    this.log("Token not found or expired, logging in...", "warning");
    const loginResult = await this.login(initData);

    if (loginResult.success) {
      this.saveToken(userId, loginResult.token);
      return loginResult.token;
    }

    throw new Error(`No valid token found: ${loginResult.error}`);
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`===== Waiting ${i} seconds for next loop =====`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.log("", "info");
  }

  async axiosRequest(method, url, data = null, customHeaders = {}) {
    const headers = {
      ...this.headers,
      ...customHeaders,
    };

    try {
      const response = await axios({
        httpsAgent: new HttpsProxyAgent(this.proxy),
        method,
        url,
        data,
        headers,
      });
      return response;
    } catch (error) {
      throw error;
    }
  }

  async login(initData) {
    const url = `${this.baseUrl}/telegram/me`;
    const payload = {
      initData: initData,
      referrerCode: settings.REF_ID,
      utmSource: null,
      impersonationToken: null,
    };

    try {
      const response = await this.axiosRequest("post", url, payload);
      if (response.status === 200) {
        return {
          success: true,
          token: response.data.token,
          referralCode: response.data.referralCode,
          firstName: response.data.firstName,
        };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async checkReferral(token, referralCode) {
    const url = `${this.baseUrl}/player-by-referral-code`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = {
      referralCode: referralCode,
    };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async completeOnboarding(token) {
    const url = `${this.baseUrl}/actions/onboarding/done`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.axiosRequest("post", url, {}, headers);
      if (response.status === 200) {
        return { success: true };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  generateEnergyDistribution(totalEnergy, parts) {
    if (totalEnergy < parts) {
      return null;
    }

    let remaining = totalEnergy;
    let distribution = [];

    for (let i = 0; i < parts - 1; i++) {
      const maxForThisPart = Math.min(200, remaining - (parts - i - 1));
      const minRequired = remaining - 200 * (parts - i - 1);
      const minValue = Math.max(1, minRequired);
      const maxValue = Math.min(maxForThisPart, remaining - (parts - i - 1));

      const value = Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;

      distribution.push(value);
      remaining -= value;
    }

    distribution.push(remaining);

    return distribution;
  }

  async tap(token, count) {
    const url = `${this.baseUrl}/actions/tap`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    try {
      let totalCoins = 0;

      const energyParts = this.generateEnergyDistribution(count, 10);
      if (!energyParts) {
        this.log("Not enough energy to perform 10 taps (need at least 10)", "error");
        return { success: false, error: "Insufficient energy" };
      }

      for (let i = 0; i < energyParts.length; i++) {
        const duration = Math.floor(Math.random() * (40 - 35 + 1)) + 35;
        const payload = {
          count: energyParts[i],
          startTimestamp: Math.floor(Date.now() / 1000),
          duration: duration,
          availableEnergy: count - energyParts.slice(0, i + 1).reduce((a, b) => a + b, 0),
        };

        const response = await this.axiosRequest("post", url, payload, headers);
        if (response.status === 200) {
          totalCoins = response.data.coins;
          this.log(`Tap ${i + 1}/10: ${energyParts[i]} energy | Duration: ${duration}ms`, "custom");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          return { success: false, error: response.data.message };
        }
      }

      return { success: true, data: { coins: totalCoins } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async syncGame(token) {
    const url = `${this.baseUrl}/sync`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.axiosRequest("post", url, {}, headers);
      if (response.status === 200) {
        const stats = response.data.playerStats;
        return {
          success: true,
          data: {
            ...stats,
            coins: stats.coins,
            profit: stats.profit,
            energy: {
              available: stats.energy.available,
              max: stats.energy.max,
            },
            onboarding: stats.onboarding.done,
            tasks: stats.tasks,
          },
        };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async performDailyCheckin(token) {
    const url = `${this.baseUrl}/actions/tasks/daily-checkin`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = {
      timezoneOffset: -420,
    };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  log = (msg, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    const logFormat = `${timestamp} | [Tài khoản ${this.accountIndex + 1}][${this.proxyIp}] | ${type.toUpperCase()} | ${msg}`;

    switch (type) {
      case "success":
        console.log(logFormat.green);
        break;
      case "custom":
        console.log(logFormat.magenta);
        break;
      case "error":
        console.log(logFormat.red);
        break;
      case "warning":
        console.log(logFormat.yellow);
        break;
      default:
        console.log(logFormat.blue);
    }
  };

  shouldPerformCheckin(lastCheckin) {
    if (!lastCheckin) return true;

    const today = new Date().toISOString().split("T")[0];
    const lastCheckinDate = new Date(lastCheckin);
    const lastCheckinString = lastCheckinDate.toISOString().split("T")[0];

    return today !== lastCheckinString;
  }

  async getFortuneWheelState(token) {
    const url = `${this.baseUrl}/fortune-wheel`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.axiosRequest("get", url, null, headers);
      if (response.status === 200) {
        return { success: true, data: response.data.state };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async spinFortuneWheel(token) {
    const url = `${this.baseUrl}/actions/fortune-wheel/spin`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = { version: 2 };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async performFortuneWheelSpins(token) {
    const stateResult = await this.getFortuneWheelState(token);
    if (!stateResult.success) {
      this.log(`Unable to check wheel state: ${stateResult.error}`, "error");
      return;
    }

    const availableSpins = stateResult.data.spins.available;
    if (availableSpins <= 0) {
      this.log("No available spins!", "warning");
      return;
    }

    this.log(`${availableSpins} spins available!`, "info");

    for (let i = 0; i < availableSpins; i++) {
      this.log(`Performing spin ${i + 1}/${availableSpins}...`, "info");
      const spinResult = await this.spinFortuneWheel(token);

      if (spinResult.success) {
        const prize = spinResult.data.prize;
        let prizeMsg = "";

        if (prize.type === "usdt") {
          prizeMsg = `${prize.amount} USDT`;
        } else {
          prizeMsg = `${prize.id}`;
        }

        this.log(`Spin successful! Received: ${prizeMsg}`, "success");

        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        this.log(`Spin failed: ${spinResult.error}`, "error");
      }
    }
  }

  async getConfig(token) {
    const url = `${this.baseUrl}/config`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.axiosRequest("get", url, null, headers);
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async completeTask(token, taskId) {
    const url = `${this.baseUrl}/actions/tasks/action-completed`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = { taskId };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      return { success: response.status === 200 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async claimTaskReward(token, taskId) {
    const url = `${this.baseUrl}/actions/tasks/done`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = { taskId };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      return { success: response.status === 200, data: response.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleTasks(token) {
    try {
      const configResult = await this.getConfig(token);
      if (!configResult.success) {
        this.log(`Unable to get configuration: ${configResult.error}`, "error");
        return;
      }

      const incompleteTasks = configResult.data.config.tasks.filter((task) => !task.isDone && !settings.SKIP_TASKS.includes(task.id));
      if (incompleteTasks.length === 0) {
        this.log("All tasks completed!", "success");
        return;
      }

      for (const task of incompleteTasks) {
        this.log(`Processing task: ${task.title}...`, "info");
        const completeResult = await this.completeTask(token, task.id);
        if (!completeResult.success) {
          this.log(`Unable to complete task action ${task.id}: ${completeResult.error}`, "error");
          continue;
        }
        if (task.claimDelay > 0) {
          this.log(`Waiting ${task.claimDelay} seconds to claim reward...`, "warning");
          await new Promise((resolve) => setTimeout(resolve, task.claimDelay * 1000));
        }

        const claimResult = await this.claimTaskReward(token, task.id);
        if (claimResult.success) {
          this.log(`Task ${task.title} completed successfully | reward ${task.reward}`, "success");
        } else {
          this.log(`Unable to claim task reward ${task.id}: ${claimResult.error}`, "error");
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.log(`Error processing tasks: ${error.message}`, "error");
    }
  }

  async handleDailyTasks(token, tasks) {
    try {
      //task daily
      const today = this.today;
      today.setHours(0, 0, 0, 0);
      const dateconfig = new Date(tasks.dailyTasks?.date);
      let tasksDaily = tasks.dailyTasks?.claimed ? Object.keys(tasks.dailyTasks?.claimed) : [];
      let taskEnableDone = settings.DAILY_TASKS;
      if (today <= dateconfig) {
        taskEnableDone = settings.DAILY_TASKS.filter((item) => !tasksDaily.includes(item));
      }
      for (const task of taskEnableDone) {
        // const claimResult = await this.claimTaskDailyReward(token, task);
        let claimResult = {
          success: false,
          error: "Unknown",
        };
        if (task == "poke") {
          const pokeResult = await this.handlePoke(token);
          if (pokeResult.success) {
            claimResult = await this.claimTaskDailyReward(token, task);
          } else {
            this.log(`Can't claim task poke daily: ${pokeResult.error}`, "warning");
          }
        } else if (task == "allDone") {
          const syncResult = await this.syncGame(token);
          if (syncResult.success) {
            tasksDaily = syncResult.data?.tasks?.dailyTasks?.claimed ? Object.keys(syncResult.data.tasks.dailyTasks?.claimed) : [];
            if (tasksDaily.length >= 4) claimResult = await this.claimTaskDailyReward(token, task);
            else this.log(`Can't claim task alldone because you don't complete all 6 tasks daily`, "warning");
          }
        } else {
          claimResult = await this.claimTaskDailyReward(token, task);
        }

        if (claimResult.success) {
          this.log(`Task daily ${task} completed successfully!`, "success");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.log(`Error processing handleDailyTasks: ${error.message}`, "error");
    }
  }

  async claimTaskDailyReward(token, taskId) {
    const url = `${this.baseUrl}/actions/tasks/daily/done`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = { taskId };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      return { success: response.status === 200, data: response.data };
    } catch (error) {
      return { success: false, error: error.message || "Unknow error" };
    }
  }

  async purchaseUpgrade(token, upgrade) {
    const { id, cooldown, cooldownUntil } = upgrade;
    const upgradeId = id;

    if (cooldown > 0 && cooldownUntil > 0) {
      const now = Math.floor(Date.now() / 1000);
      const secondsLeft = cooldownUntil - now;
      if (secondsLeft > 0) {
        const hours = Math.floor(secondsLeft / 3600);
        const minutes = Math.floor((secondsLeft % 3600) / 60);
        const seconds = secondsLeft % 60;
        return { success: false, error: `This card need wait ${hours} hours ${minutes} minutes ${seconds} seconds to continue upgrade...` };
      }
    }

    const url = `${this.baseUrl}/actions/upgrade`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = { upgradeId };

    try {
      const response = await this.axiosRequest("post", url, payload, headers);
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleUpgrades(token, availableCoins) {
    try {
      const configResult = await this.getConfig(token);
      if (!configResult.success) {
        this.log(`Unable to get configuration: ${configResult.error}`, "error");
        return;
      }

      let upgrades = configResult.data.config.upgrades
        .filter((upgrade) => upgrade.price <= settings.MAX_UPGRADE_PRICE && upgrade.price <= availableCoins && (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000)))
        .map((upgrade) => ({
          ...upgrade,
          roi: upgrade.profitDelta / upgrade.price,
        }))
        .sort((a, b) => b.roi - a.roi);

      if (upgrades.length === 0) {
        this.log("No upgrades available!", "warning");
        return;
      }

      for (const upgrade of upgrades) {
        if (upgrade.price > availableCoins) {
          //   this.log(`Not enough coins to upgrade ${upgrade.name} (${upgrade.price} coins)`, "warning");
          continue;
        }

        this.log(`Upgrading ${upgrade.name} (${upgrade.price} coins, +${upgrade.profitDelta} profit)...`, "info");
        const purchaseResult = await this.purchaseUpgrade(token, upgrade);

        if (purchaseResult.success) {
          this.log(`Upgrade ${upgrade.name} successful!`, "success");
          availableCoins -= upgrade.price;

          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          this.log(`Upgrade ${upgrade.name} failed: ${purchaseResult.error}`, "warning");
        }
      }
    } catch (error) {
      this.log(`Error processing upgrades: ${error.message}`, "error");
    }
  }

  async handleDailyCombo(token, data) {
    const today = this.today;
    today.setHours(0, 0, 0, 0);
    const dateConfig = new Date(data.challenges?.dailyCombo?.currentDate);
    let availableCoins = data.coins;
    let cardsComboCompleted = data.challenges?.dailyCombo?.foundCombo || [];
    if (dateConfig < today) {
      cardsComboCompleted = [];
    }

    if (cardsComboCompleted.length == 3) return this.log(`Combo daily completed!`, "warning");

    const cardsCombo = settings.DAILY_COMBO.map((item) => item.replace(" ", "_").toLowerCase());
    if (cardsCombo.length !== 3) {
      return this.log(`Please input 3 name cards to complete the combo in .env file, EX: ["card1", "card2", "card3"]`, "warning");
    }

    try {
      let configResult = await this.getConfig(token);
      if (!configResult.success) {
        this.log(`Unable to get configuration: ${configResult.error}`, "error");
        return;
      }

      let upgrades = configResult.data.config.upgrades
        .filter((upgrade) => upgrade.price <= settings.MAX_UPGRADE_PRICE && upgrade.price <= availableCoins && (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000)))
        .map((upgrade) => ({
          ...upgrade,
          roi: upgrade.profitDelta / upgrade.price,
        }))
        .sort((a, b) => b.roi - a.roi);

      if (upgrades.length === 0) {
        this.log("No available upgrades!", "warning");
        return;
      }

      for (const name of cardsCombo) {
        const upgrade = upgrades.find((item) => item.id === name && !cardsComboCompleted.includes(item.id));
        if (!upgrade) continue;
        else {
          let cardToUnlock = upgrades.find((item) => item.id === upgrade.requirements?.upgrade?.id);
          if (
            upgrade &&
            (!cardToUnlock || (cardToUnlock && cardToUnlock.level >= upgrade?.requirements?.upgrade?.level && upgrade?.requirements)) &&
            upgrade.price <= settings.MAX_UPGRADE_PRICE &&
            upgrade.price <= availableCoins &&
            (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
          ) {
            let currentLevel = parseInt(upgrade.level);
            this.log(`Upgrading ${upgrade.name} to level ${currentLevel + 1} (${upgrade.price} coins, +${upgrade.profitDelta} profit)...`, "info");
            const purchaseResult = await this.purchaseUpgrade(token, upgrade);
            if (purchaseResult.success) {
              this.log(`Upgrade ${upgrade.name} to level ${currentLevel + 1} successful!`, "success");
              availableCoins -= upgrade.price;
              currentLevel++;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } else {
              this.log(`Upgrade ${upgrade.name} failed: ${purchaseResult.error}`, "warning");
              return false;
            }
            return true;
          } else if (
            upgrade &&
            cardToUnlock &&
            cardToUnlock.level < upgrade?.requirements?.upgrade?.level &&
            upgrade?.requirements &&
            upgrade.price <= settings.MAX_UPGRADE_PRICE &&
            upgrade.price <= availableCoins &&
            (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
          ) {
            this.log(`Upgrade ${upgrade.name} need unlock ${upgrade.requirements?.upgrade.id} up to level ${upgrade.requirements?.upgrade.level}`, "warning");
            await this.handleUnlock(token, upgrade.requirements?.upgrade, upgrades, availableCoins);
          } else {
            this.log(`Combo daily failed because: Upgrade ${upgrade.name} failed`, "warning");
            return false;
          }
        }
      }
    } catch (error) {
      this.log(`Error processing DailyCombo: ${error.message}`, "error");
    }
  }

  async handleUnlock(token, cardRequired, cards, coins) {
    let availableCoins = coins;
    const { level, id } = cardRequired;
    let upgrade = cards.find((item) => item.id === id);
    let cardToUnlock = cards.find((item) => item.id === upgrade.requirements?.upgrade?.id);

    await sleep(1);
    if (
      upgrade &&
      (!cardToUnlock || (cardToUnlock && cardToUnlock.level >= upgrade?.requirements?.upgrade?.level && upgrade?.requirements)) &&
      upgrade.price <= settings.MAX_UPGRADE_PRICE &&
      upgrade.price <= availableCoins &&
      (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
    ) {
      this.log(`Starting unlock ${id}...`, "info");
      let currentLevel = parseInt(upgrade.level);
      do {
        this.log(`Upgrading ${upgrade.name} to level ${currentLevel + 1} (${upgrade.price} coins, +${upgrade.profitDelta} profit)...`, "info");
        const purchaseResult = await this.purchaseUpgrade(token, upgrade);
        if (purchaseResult.success) {
          this.log(`Upgrade ${upgrade.name} to level ${currentLevel + 1} successful!`, "success");

          availableCoins -= upgrade.price;
          currentLevel++;
          upgrade = purchaseResult.data?.config?.upgrades?.find((item) => item.id === upgrade.id) || upgrade;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          this.log(`Upgrade ${upgrade.name} failed: ${purchaseResult.error}`, "warning");
          return false;
        }
      } while (currentLevel < +level);
      return true;
    } else if (
      upgrade &&
      cardToUnlock &&
      cardToUnlock.level < upgrade?.requirements?.upgrade?.level &&
      upgrade?.requirements &&
      upgrade.price <= settings.MAX_UPGRADE_PRICE &&
      upgrade.price <= availableCoins &&
      (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
    ) {
      this.log(`Upgrade ${upgrade.name} need unlock ${upgrade.requirements?.upgrade.id} up to level ${upgrade.requirements?.upgrade.level}`, "warning");
      await this.handleUnlock(token, upgrade.requirements?.upgrade, cards, availableCoins);
    } else {
      this.log(`Combo daily failed because: Upgrade ${upgrade.name} failed`, "warning");
      return false;
    }
    return true;
  }

  async handleDailyQuest(token, data) {
    const today = this.today;
    today.setHours(0, 0, 0, 0);
    const dateconfig = new Date(data.challenges?.dailyQuestion?.lastDone);
    if (dateconfig < today || !data.challenges?.dailyQuestion?.lastDone) {
      this.log("Daily answer...", "info");
      await this.questDaily(token);
    }
    return;
  }

  async listFriend(token) {
    const url = `${this.baseUrl}/friends-v2`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    try {
      const response = await this.axiosRequest("get", url, null, headers);
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error?.message || "Unkown Error" };
    }
  }

  async handlePoke(token) {
    let error = "Unkown Error";
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    try {
      const listFriends = await this.listFriend(token);
      if (listFriends.success && listFriends.data.friends?.length > 0) {
        const friend = listFriends.data.friends.find((item) => !listFriends.data.pokes.includes(item.id));
        if (friend) {
          const url = `${this.baseUrl}/actions/friends/${friend.id}/poke-v2`;
          const response = await this.axiosRequest("post", url, {}, headers);
          if (response.status === 200) {
            return { success: true, data: response.data };
          } else {
            return { success: false, error: response.data.message };
          }
        } else {
          error = `You can poke them again after they poke you back or after 24 hours.`;
        }
      } else {
        error = listFriends.error || `You don't have any friend to poke`;
      }
      return { success: false, error: error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async questDaily(token) {
    const url = `${this.baseUrl}/daily-question`;
    const url_answer = `${this.baseUrl}/actions/tasks/daily-question/answer`;

    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.axiosRequest("get", url, null, headers);
      if (response.status === 200) {
        await sleep(2);
        const responseAnswer = await this.axiosRequest(
          "post",
          url_answer,
          {
            answer: settings.ANSWER_DAILY,
          },
          headers
        );
        if (responseAnswer?.data?.success) {
          this.log(`Quest Daily: ${response.data.question} | Success Answer: ${settings.ANSWER_DAILY}`, "success");
        } else {
          this.log(`Quest Daily: ${response.data.question} | Wrong Answer: ${settings.ANSWER_DAILY}`, "warning");
        }
        ss;

        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async checkProxyIP(proxy) {
    try {
      const proxyAgent = new HttpsProxyAgent(proxy);
      const response = await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: proxyAgent,
      });
      if (response.status === 200) {
        return response.data.ip;
      } else {
        throw new Error(`Unable to check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async addFriend(token, referrerCode) {
    const url = `${this.baseUrl}/friends`;
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    const payload = {
      referrerCode: referrerCode,
    };

    try {
      await this.axiosRequest("post", url, payload, headers);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }

  async handleAds(token, data) {
    let configResult = await this.getConfig(token);
    if (!configResult.success || !data?.activities) {
      this.log(`Unable to get configuration: ${configResult.error}`, "error");
      return;
    }
    let ads = configResult.data.config.game.ads;
    const { doubleOfflineProfit, others } = ads;
    let { watchAdForSpin, watchAdForDoublePrize, watchAdInterstitial, watchAdForDoubleOfflineProfit } = data.activities;
    let timesWatchedAds = watchAdForSpin + watchAdForDoublePrize + watchAdInterstitial;

    while (timesWatchedAds < others.maxPerDay && watchAdForSpin < 10) {
      this.log(`Waiting 15 seconds for claim spin to be available ads ${timesWatchedAds}`);
      await sleep(15);
      await this.claimAds(token, "extra-spin-by-ad");
      timesWatchedAds++;
      watchAdForSpin++;
    }

    if (watchAdForDoubleOfflineProfit < doubleOfflineProfit.maxPerDay) {
      this.log(`Waiting 15 seconds for claim double profit offline to be available.`);
      await sleep(15);
      await this.claimAds(token, "multiply-offline-profit-for-ad");
    }

    return;
  }

  async claimAds(token, endpoint = "extra-spin-by-ad") {
    const url = `${this.baseUrl}/actions/${endpoint}`;

    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.axiosRequest("post", url, {}, headers);
      if (response.status === 200) {
        this.log(`Claimed ${endpoint === "extra-spin-by-ad" ? "spin ads" : "double profit offline"} successfully`, "success");
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async runAccount() {
    const i = this.accountIndex;
    const initData = this.queryId;
    const userData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
    const userId = userData.id;
    const firstName = userData.first_name;
    this.session_name = userId;
    const proxy = this.proxy;

    try {
      let proxyIP = "No Proxy";
      if (proxy) {
        try {
          proxyIP = await this.checkProxyIP(this.proxy);
          this.proxyIp = proxyIP;
        } catch (proxyError) {
          this.log(`Proxy error: ${proxyError.message}`, "error");
          this.log("Moving to next account...", "warning");
          return;
        }
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      console.log(`=========Tài khoản ${this.accountIndex + 1} | ${firstName}|[${proxyIP}] | Nghỉ ${timesleep} trước khi bắt đầu=============`.green);

      this.#set_headers();
      await sleep(timesleep);
      const token = await this.getValidToken(userId, initData);
      this.log(`Using token for account ${userId}`, "success");
      await this.addFriend(token, settings.REF_ID);
      const referralResult = await this.checkReferral(token, settings.REF_ID);
      if (referralResult.success) {
        this.log(`Referral check successful!`, "success");
      } else {
        this.log(`Referral check failed: ${referralResult.error}`, "error");
      }

      const syncResult = await this.syncGame(token);
      if (syncResult.success) {
        this.log("Data sync successful!", "success");
        this.log(`Coins: ${syncResult.data.coins}`, "custom");
        this.log(`Profit: ${syncResult.data.profit}`, "custom");
        this.log(`Energy: ${syncResult.data.energy.available}/${syncResult.data.energy.max}`, "custom");

        if (!syncResult.data.onboarding) {
          this.log("Onboarding not completed, processing...", "warning");
          const onboardingResult = await this.completeOnboarding(token);
          if (onboardingResult.success) {
            this.log("Onboarding completed successfully!", "success");
          } else {
            this.log(`Onboarding completion failed: ${onboardingResult.error}`, "error");
          }
        }

        if (settings.AUTO_TAP) {
          if (syncResult.data.energy.available >= 10) {
            this.log(`Detected ${syncResult.data.energy.available} energy, performing tap...`, "warning");
            const tapResult = await this.tap(token, syncResult.data.energy.available);
            if (tapResult.success) {
              this.log(`Tap successful | Balance: ${tapResult.data.coins}`, "success");
            } else {
              this.log(`Tap failed: ${tapResult.error}`, "error");
            }
          } else {
            this.log("Not enough energy to perform tap (need at least 10)", "warning");
          }
        }

        const lastCheckin = syncResult.data.tasks?.dailyCheckin?.lastCheckin || "";
        if (this.shouldPerformCheckin(lastCheckin)) {
          this.log("Performing daily check-in...", "warning");
          const checkinResult = await this.performDailyCheckin(token);
          if (checkinResult.success) {
            this.log("Check-in successful!", "success");
          } else {
            this.log(`Check-in failed: ${checkinResult.error}`, "error");
          }
        } else {
          this.log("Already checked in today!", "warning");
        }

        if (settings.AUTO_ADS) {
          await this.handleAds(token, syncResult.data);
        }

        if (settings.AUTO_SPIN) {
          this.log("Checking fortune wheel...", "info");
          await this.performFortuneWheelSpins(token);
        }
        if (settings.AUTO_ANSER_DAILY) {
          this.log("Checking daily quest...", "info");
          await sleep(2);
          await this.handleDailyQuest(token, syncResult.data);
        }

        if (settings.AUTO_DAILY_COMBO) {
          this.log("Checking daily combo...", "info");
          await sleep(2);
          await this.handleDailyCombo(token, syncResult.data);
        }

        if (settings.AUTO_UPGRADE) {
          await sleep(3);
          this.log("Checking available upgrades...", "info");
          await this.handleUpgrades(token, syncResult.data.coins);
        }

        if (settings.AUTO_TASK) {
          await sleep(3);
          this.log("Checking tasks...", "info");
          await this.handleTasks(token);
        }
        await sleep(3);
        await this.handleDailyTasks(token, syncResult.data.tasks);
        const finalSync = await this.syncGame(token);
        if (finalSync.success) {
          this.log("=== Final Statistics ===", "custom");
          this.log(`Coins: ${finalSync.data.coins}`, "custom");
          this.log(`Profit: ${finalSync.data.profit}`, "custom");
          this.log(`Energy: ${finalSync.data.energy.available}/${finalSync.data.energy.max}`, "custom");
        }
      } else {
        this.log(`Data sync failed: ${syncResult.error}`, "error");
      }
    } catch (error) {
      this.log(`Error processing account ${userId}: ${error.message}`, "error");

      if (error.message.toLowerCase().includes("token")) {
        delete this.tokens[userId];
        fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
        this.log(`Deleted invalid token for account ${userId}`, "warning");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function runWorker(workerData) {
  const { queryId, accountIndex, proxy } = workerData;
  const to = new DropeeAPIClient(queryId, accountIndex, proxy);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  }
}

async function main() {
  printLogo();
  const queryIds = loadData("data.txt");
  const proxies = loadData("proxy.txt");

  if (queryIds.length > proxies.length) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  let maxThreads = settings.MAX_THEADS;

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < queryIds.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, queryIds.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            queryId: queryIds[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message.error) {
                errors.push(`Tài khoản ${message.accountIndex}: ${message.error}`);
                console.log(`Tài khoản ${message.accountIndex}: ${message.error}`.yellow);
              }
              resolve();
            });
            worker.on("error", (error) => {
              errors.push(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`.yellow);
              resolve();
            });
            worker.on("exit", (code) => {
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < queryIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    const to = new DropeeAPIClient(null, 0, proxies[0]);
    await sleep(3);
    console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)".yellow);
    console.log(`=============Hoàn thành tất cả tài khoản=============`.magenta);
    await to.countdown(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
