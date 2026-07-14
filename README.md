<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-smarthq"><img alt="homebridge-smarthq" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-smarthq/latest/branding/Homebridge_x_SmartHQ.svg?sanitize=true" width="500px"></a>
</p>
<span align="center">

## homebridge-smarthq

Homebridge plugin to integrate SmartHQ appliances into HomeKit

[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-smarthq/latest?label=latest)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-smarthq)
[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-smarthq/beta?label=beta)](https://github.com/homebridge/homebridge/wiki/How-to-Install-Alternate-Plugin-Versions)<br>
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)<br>
[![npm](https://img.shields.io/npm/dt/@homebridge-plugins/homebridge-smarthq)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-smarthq)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.gg/bHjKNkN)

</span>

### Plugin Information

- This plugin allows you to view and control your [SmartHQ](https://www.geappliances.com/connect) appliances within HomeKit. The plugin:
  - requires your SmartHQ account credentials to work
  - connects to the SmartHQ cloud to discover and control your appliances

### Setup

- Installation
  - Search for "SmartHQ" on the plugin screen of the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x) and click **Install**.
- Configuration
  1. Enter your SmartHQ username and password in the plugin settings.
  2. Click **Save**.
  3. Restart Homebridge.

### Features

- **HomeKit Controller notifications** are supported for the Opal Ice Maker. To set up, install the HomeKit Controller app and configure notifications for each respective event. Put your HomeKit Controller client secret in the plugin advanced options, and the path associated with each available notification in the Opal device options. Supported events:
  - Ice Bucket Full
  - Production Progress Complete
  - Filter Maintenance Change Alert
  - Descale Needed Alert
  - Add Water Alert

### Help/About

- [Support Request](https://github.com/homebridge-plugins/homebridge-smarthq/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-smarthq/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- To [@donavanbecker](https://github.com/donavanbecker): the original creator and maintainer of this plugin.
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with SmartHQ or GE Appliances and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
