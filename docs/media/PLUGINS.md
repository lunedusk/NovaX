# Plugins — Developer Guide

## License

NovaX is licensed under the **PolyForm Noncommercial License 1.0.0**.

- Free to use and modify for personal and non-commercial purposes.
- You may not sell it, claim it as your own, or use it commercially without written permission.

## Plugin ownership

Any independent plugins, commands, or extensions you create using NovaX remain **your** intellectual property. You retain full ownership of your original plugin code.

## Plugin rules

Violating any of the following means your plugin will not be verified or signed, and may be removed:

1. **No malware** — no malicious or harmful content of any kind.
2. **No hidden data exfiltration** — do not call out to your own external API, send confidential user/guild information, or emit telemetry unless it is genuinely necessary to the plugin’s stated function **and** disclosed to the user.
3. **No unnecessary access to secrets** — do not read `common.json`, environment variables, or framework secrets beyond what your plugin actually needs.
4. **Open source if not monetized** — if your plugin is not monetized, it must be open source.
5. **No stolen code** — do not copy, steal, or republish anyone else’s code as your own.

## Verification & signing

- To verify your plugin, get it added to the official `plugins.txt`, or receive a Lunedusk-signed manifest (`manifest.nvx`).
- Email your plugin’s **source code** to **vedant.storm@gmail.com** for safety verification.
- Submit **readable source only** — do not send pre-obfuscated builds. If you want obfuscation, Lunedusk will obfuscate **and** sign after verifying the source.
- A Lunedusk-signed manifest lets the plugin load **without** the boot warning: `BYPASS ACTIVE — loading plugin without cryptographic guarantees`.
- Being listed in the official repo’s `plugins.txt` means any NovaX user can install your plugin through the built-in auto-updater.

## Help & issues

Report bugs or ask questions via GitHub Issues and Discussions:  
https://github.com/lunedusk/NovaX

## Related

- [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) — authoring contract  
- [LOADER.md](LOADER.md) — config/lang defaults merge  
- [UPDATER.md](UPDATER.md) — installing plugins via the updater  
