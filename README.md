<a name="top"></a>
# NovaX
> NovaX is a modular discord bot framework with built in engines and loaders as well as tools and helpers. NovaX can manage i18n, config (json5), multiple database like mongo, redis, postgres, typeorm (sqlite based), has a logger built in, commands and events are auto loaded, you get a very powerful this.heart object with almost every tool available!

<a name="contents"></a>
## Contents
[Documentation (TypeDoc)](#documentation)
[Installation](#installation)
- [Pterodactyl Custom Egg](#ptero-custom)
- [Pterodactyl Normal Node.js Egg](#ptero-generic)
- [Docker](#docker)
- [VPS](#vps)
[Features](#features)
[Donation](#donation)
[Credits](#credits)

<a name="documentation"></a>
## Documentatio (TypeDoc)
<a name="pre-generated-docs"></a>
### Pre Generated TypeDoc Documentation
    Open [docs/index.html](docs/index.html) in your web browser to see our pre generated documentation
<a name="generate-docs"></a>
### Generate Documentation via TypeDoc
    Open Terminal and type
    ```bash
    npm run typedoc
    ```
    Then follow the steps shown [here](#pre-generated-docs)


<a name="installation"></a>
## Installation
### Basics
  Rename [.env.example](.env.example) to [.env](.env) if you are using ENVMode
  Ensure either [.env](.env) or [common.json](common.json) exists in your dir and is perfectly configured
  Now if you are using ENVMode, you may delete [common.json](common.json) or atleast set ENVMode to true in [common.json](common.json)
  Then Run ```bash
  npm install``` in your terminal if you have to use ```bash
  npm run build``` or ```bash
  npm run start``` or ```bash
  npm start```
<details>
  <a name="ptero-custom"></a>
  <summary>Pterodactyl Custom Egg</summary>
  Use the modified [node.js generic egg](pterodactyl-eggs\node-js-generic.json)
  Upload the files
  Run
</details>
<details>
  <a name="ptero-generic"></a>
  <summary>Pterodactyl Normal Node.js Egg</summary>
  Compile the project in javascript by running ```bash
  npm build``` in your terminal
  Zip
  Upload all Files
  Unzip
  Run
</details>
<details>
  <a name="docker"></a>
  <summary>Docker</summary>
  Build the Image by running ```bash
  docker compose build``` in your terminal
  Edit [docker-compose.yml](docker-compose.yml) as per your liking
  Run the Image by ```bash
  docker compose up -d``` in your terminal
</details>
<details>
  <a name="vps"></a>
  <summary>VPS</summary>
  Install Dependencies by running ```bash
  npm install``` in your terminal
  Run the Bot by ```bash
  npm run start``` in your terminal
</details>

<a name="features"></a>
## Features
  Multi-Database support [TypeORM, Postgres native, Redis, mongodb]
  Inbuilt Cooldown system with decorator [Redis based fallback to local tool]
  Powerful this.heart object injected to every plugin which has access to all necessary tools and engines
  Auto Application Emoji Uploader
  Events System with discord events injected for integrity
  Hot Reload of Plugins
  Hot Install of Dependency
  Global Error Handler
  Modular
  i18n Engine
  Config Engine

<a name="donation"></a>
## Donation
Please consider donating to us as even a small amount can help us bring updates to this project
[Donate Here](https://nowpayments.io/donation/novacore)
If you donate more than $1 Please open a ticket in our [Discord Server](https://nova-core.me/discord) to claim your donator perks

<a name="credits"></a>
## Credits
  Made with <3 by 
  [NovaCore Development](https://nova-core.me/discord)
  [Cool Guy](https://discord.com/users/1414373639826178120)