const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const readline = require("readline");
const printLogo = require("./src/logo");
const headers = require("./src/header");
const log = require("./src/logger");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { loadData, sleep, getRandomElement } = require("./utils");

class DropeeAPIClient {
  constructor() {
    this.baseUrl = "https://dropee.clicker-game-api.tropee.com/api/game";
    this.headers = headers;
    this.log = log;
    this.tokenFile = path.join(__dirname, "token.json");
    this.loadTokens();
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.skipTasks = settings.SKIP_TASKS;
    this.today = new Date();
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
    if (loginResult.success && loginResult?.token) {
      this.saveToken(userId, loginResult.token);
      return loginResult.token;
    }

    throw new Error(`No valid token found: ${loginResult.error}`);
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`===== Waiting ${i} seconds to continue the loop =====`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.log("", "info");
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
      const response = await axios.post(url, payload, { headers: this.headers });
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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = {
      referralCode: referralCode,
    };

    try {
      const response = await axios.post(url, payload, { headers });
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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await axios.post(url, {}, { headers });
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
      ...this.headers,
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

        const response = await axios.post(url, payload, { headers });
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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await axios.post(url, {}, { headers });
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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = {
      timezoneOffset: -420,
    };

    try {
      const response = await axios.post(url, payload, { headers });
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await axios.get(url, { headers });
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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = { version: 2 };

    try {
      const response = await axios.post(url, payload, { headers });
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

        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        this.log(`Spin failed: ${spinResult.error}`, "error");
      }
    }
  }

  async getConfig(token) {
    const url = `${this.baseUrl}/config`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await axios.get(url, { headers });
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
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = { taskId };

    try {
      const response = await axios.post(url, payload, { headers });
      return { success: response.status === 200 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async claimTaskReward(token, taskId) {
    const url = `${this.baseUrl}/actions/tasks/done`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = { taskId };

    try {
      const response = await axios.post(url, payload, { headers });
      return { success: response.status === 200, data: response.data };
    } catch (error) {
      return { success: false, error: error.message };
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
      const response = await axios.post(url, payload, { headers });
      return { success: response.data.success, data: response.data };
    } catch (error) {
      return { success: false, error: error.message || "Unknow error" };
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
          this.log(`Unable to complete action for task ${task.id}: ${completeResult.error}`, "error");
          continue;
        }

        if (task.claimDelay > 0) {
          this.log(`Waiting ${task.claimDelay} seconds to claim reward...`, "warning");
          await new Promise((resolve) => setTimeout(resolve, task.claimDelay * 1000));
        }

        const claimResult = await this.claimTaskReward(token, task.id);
        if (claimResult.success) {
          this.log(`Task ${task.title} completed successfully | reward: ${task.reward}`, "success");
        } else {
          this.log(`Unable to claim reward for task ${task.id}: ${claimResult.error}`, "error");
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
        if (claimResult?.success) {
          this.log(`Task daily ${task} completed successfully!`, "success");
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.log(`Error processing handleDailyTasks: ${error.message}`, "error");
    }
  }

  checkCountDown(cooldownUntil) {
    if (cooldownUntil > 0) {
      const now = Math.floor(Date.now() / 1000);
      const secondsLeft = cooldownUntil - now;
      if (secondsLeft > 0) {
        return true;
      }
    }
    return false;
  }

  async purchaseUpgrade(token, upgrade) {
    const { id, cooldown, cooldownUntil } = upgrade;
    const upgradeId = id;

    if (cooldown > 0 && this.checkCountDown(cooldownUntil)) {
      return;
    }

    const url = `${this.baseUrl}/actions/upgrade`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = { upgradeId };

    try {
      const response = await axios.post(url, payload, { headers });
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
        .filter(
          (upgrade) =>
            upgrade.price <= settings.MAX_UPGRADE_PRICE &&
            !this.checkCountDown(upgrade?.cooldownUntil) &&
            upgrade.price <= availableCoins &&
            (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
        )

        .map((upgrade) => ({
          ...upgrade,
          roi: upgrade.profitDelta / upgrade.price,
        }))
        .sort((a, b) => b.roi - a.roi);

      if (upgrades.length === 0) {
        this.log("No available upgrades!", "warning");
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
      if (settings.AUTO_UPGRADE_MAX) {
        await this.handleUpgrades(token, availableCoins);
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
        .filter(
          (upgrade) =>
            upgrade.price <= settings.MAX_UPGRADE_PRICE &&
            !this.checkCountDown(upgrade?.cooldownUntil) &&
            upgrade.price <= availableCoins &&
            (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
        )
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
          // upgrade
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
      const response = await axios.post(url, {}, { headers });
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

  async listFriend(token) {
    const url = `${this.baseUrl}/friends-v2`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    try {
      const response = await axios.get(url, { headers });
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
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    let error = "Unkown Error";
    try {
      const listFriends = await this.listFriend(token);
      if (listFriends.success && listFriends.data.friends?.length > 0) {
        const friend = listFriends.data.friends.find((item) => !listFriends.data.pokes.includes(item.id));
        if (friend) {
          const url = `${this.baseUrl}/actions/friends/${friend.id}/poke-v2`;
          const response = await axios.post(url, {}, { headers });
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
      const response = await axios.get(url, { headers });
      if (response.status === 200) {
        await sleep(2);
        const responseAnswer = await axios.post(
          url_answer,
          {
            answer: settings.ANSWER_DAILY,
          },
          { headers }
        );
        if (responseAnswer?.data?.success) {
          this.log(`Quest Daily: ${response.data.question} | Success Answer: ${settings.ANSWER_DAILY}`, "success");
        } else {
          this.log(`Quest Daily: ${response.data.question} | Wrong Answer: ${settings.ANSWER_DAILY}`, "warning");
        }

        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listFriends(token) {
    const url = `${this.baseUrl}/friends`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
    const payload = {
      referrerCode: settings.REF_ID,
    };

    try {
      await axios.post(url, payload, { headers });
    } catch (error) {}
  }

  async main() {
    const dataFile = path.join(__dirname, "data.txt");
    const data = fs.readFileSync(dataFile, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
    printLogo();
    while (true) {
      for (let i = 0; i < data.length; i++) {
        const initData = data[i];
        const userData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
        const userId = userData.id;
        const firstName = userData.first_name;
        this.session_name = userId;

        console.log(`========== Account ${i + 1} | ${firstName.green} ==========`);
        await this.#set_headers();
        try {
          const token = await this.getValidToken(userId, initData);
          this.log(`Using token for account ${userId}`, "success");
          await this.listFriends(token);
          const referralResult = await this.checkReferral(token, settings.REF_ID);
          if (referralResult.success) {
            this.log(`Referral check successful!`, "success");
          } else {
            this.log(`Referral check failed: ${referralResult.error}`, "error");
          }

          const syncResult = await this.syncGame(token);
          if (!syncResult.success) {
            this.log(`Sync check failed: ${syncResult.error} | Skipping account...`, "warning");
            continue;
          }

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
              await this.handleDailyQuest(token, syncResult.data);
            }

            if (settings.AUTO_DAILY_COMBO) {
              this.log("Checking daily combo...", "info");
              await this.handleDailyCombo(token, syncResult.data);
            }

            if (settings.AUTO_UPGRADE) {
              this.log("Checking available upgrades...", "info");
              await this.handleUpgrades(token, syncResult.data.coins);
            }

            if (settings.AUTO_TASK) {
              this.log("Checking tasks...", "info");
              await this.handleTasks(token);
            }
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

        this.log(`Waiting 5 seconds before processing next account...`, "info");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      this.log("=== Finished processing all accounts ===", "success");
      await this.countdown(10 * 60);
    }
  }
}

const client = new DropeeAPIClient();
client.main().catch((err) => {
  client.log(err.message, "error");
  process.exit(1);
});
