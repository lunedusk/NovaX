# NovaX

> NovaX is a modular discord bot framework with built in engines and loaders as well as tools and helpers. NovaX can manage i18n, config (json5), multiple database like mongo, redis, postgres, typeorm (sqlite based), has a logger built in, commands and events are auto loaded, you get a very powerful this.heart object with almost every tool available!

## Contents
* [Documentation (TypeDoc)](#documentation)
* [Installation](#installation)
    * [Pterodactyl Custom Egg](#ptero-custom)
    * [Pterodactyl Normal Node.js Egg](#ptero-generic)
    * [Docker](#docker)
    * [VPS](#vps)
* [Features](#features)
* [Donation](#donation)
* [Credits](#credits)

<a id="documentation"></a>
## Documentation (TypeDoc)

### Pre Generated TypeDoc Documentation
Open `docs/index.html` in your web browser to see our pre generated documentation

### Generate Documentation via TypeDoc
Open Terminal and type:
```bash
npm run typedoc
```
Then follow the steps shown [here](#documentation)

---

<a id="installation"></a>
## Installation

### Basics
1. Rename `.env.example` to `.env` if you are using ENVMode.
2. Ensure either `.env` or `common.json` exists in your dir and is perfectly configured.
3. Now if you are using ENVMode, you may delete `common.json` or atleast set ENVMode to true in `common.json`.
4. Then Run `npm install` in your terminal.
5. Use `npm run build` or `npm run start` or `npm start`.

<br>

<details>
  <summary><b>Pterodactyl Custom Egg</b></summary>
  <a id="ptero-custom"></a>
  
  * Use the modified [node.js generic egg](pterodactyl-eggs\node-js-generic.json)
  * Upload the files
  * Run
</details>

<details>
  <summary><b>Pterodactyl Normal Node.js Egg</b></summary>
  <a id="ptero-generic"></a>
  
  * Compile the project in javascript by running `npm run build` in your terminal
  * Zip
  * Upload all Files
  * Unzip
  * Run
</details>

<details>
  <summary><b>Docker</b></summary>
  <a id="docker"></a>
  
  * Build the Image by running `docker compose build` in your terminal
  * Edit [docker-compose.yml](docker-compose.yml) as per your liking
  * Run the Image by `docker compose up -d` in your terminal
</details>

<details>
  <summary><b>VPS</b></summary>
  <a id="vps"></a>
  
  * Install Dependencies by running `npm install` in your terminal
  * Run the Bot by `npm run start` in your terminal
</details>

---

<a id="features"></a>
## Features
* Multi-Database support [TypeORM, Postgres native, Redis, mongodb]
* Inbuilt Cooldown system with decorator [Redis based fallback to local tool]
* Powerful this.heart object injected to every plugin which has access to all necessary tools and engines
* Auto Application Emoji Uploader
* Events System with discord events injected for integrity
* Hot Reload of Plugins
* Hot Install of Dependency
* Global Error Handler
* Modular
* i18n Engine
* Config Engine

<a id="donation"></a>
## Donation
Please consider donating to us as even a small amount can help us bring updates to this project.
**[Donate Here](https://nowpayments.io/donation/novacore)**

If you donate more than $1 Please open a ticket in our [Discord Server](https://nova-core.me/discord) to claim your donator perks.

<a id="credits"></a>
## Credits
Made with <3 by:
* [NovaCore Development](https://nova-core.me/discord)
* [Cool Guy](https://discord.com/users/1414373639826178120)