const fs = require("fs");
const path = require("path");
const printLogo = require("./src/logo");
const headers = require("./src/header");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { loadData } = require("./utils");

class DropeeAPIClient {
  constructor(queryId, accountIndex, proxy) {
    this.baseUrl = "https://dropee.clicker-game-api.tropee.com/api/game";
    this.headers = headers;
    this.today = new Date();
    this.tokenFile = path.join(__dirname, "token.json");
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
}

(async function main() {
  printLogo();
  const queryIds = loadData("data.txt");
  const proxies = loadData("proxy.txt");

  if (queryIds.length > proxies.length) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }

  queryIds.map((val, i) => new DropeeAPIClient(val, i, proxies[i]).createUserAgent());
  console.log(`Created user agent ${queryIds.length} accounts successfully!, Run again to start bot...`.magenta);
  process.exit(0);
})();
