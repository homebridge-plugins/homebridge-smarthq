<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-smarthq"><img alt="homebridge-smarthq" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-smarthq/latest/branding/Homebridge_x_SmartHQ.png" width="600px"></a>
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

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v22`, `v24` or `v26` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v2` - refer to link for more information and installation instructions.

### Setup

- [Installation](https://github.com/homebridge-plugins/homebridge-smarthq/wiki/Installation)
- [Configuration](https://github.com/homebridge-plugins/homebridge-smarthq/wiki/Configuration)
- [Beta Version](https://github.com/homebridge-plugins/homebridge-smarthq/wiki/Beta-Version)
- [Node Version](https://github.com/homebridge-plugins/homebridge-smarthq/wiki/Node-Version)

### Features

- **HomeKit Controller notifications** are supported for the Opal Ice Maker. To set up, install the HomeKit Controller app and configure notifications for each respective event. Put your HomeKit Controller client secret in the plugin advanced options, and the path associated with each available notification in the Opal device options. Supported events:
  - Ice Bucket Full
  - Production Progress Complete
  - Filter Maintenance Change Alert
  - Descale Needed Alert
  - Add Water Alert

### Help/About

- [Common Errors](https://github.com/homebridge-plugins/homebridge-smarthq/wiki/Common-Errors)
- [Support Request](https://github.com/homebridge-plugins/homebridge-smarthq/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-smarthq/blob/latest/CHANGELOG.md)

### Credits

- To [@donavanbecker](https://github.com/donavanbecker): the original creator and maintainer of this plugin.
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with SmartHQ or GE Appliances and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
