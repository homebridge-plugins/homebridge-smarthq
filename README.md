<span align="center">

<a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-smarthq/latest/branding/Homebridge_x_SmartHQ.svg?sanitize=true" width="350px"></a>

# Homebridge SmartHQ

<a href="https://www.npmjs.com/package/@homebridge-plugins/homebridge-smarthq"><img title="npm version" src="https://badgen.net/npm/v/@homebridge-plugins/homebridge-smarthq?icon=npm&label" ></a>
<a href="https://www.npmjs.com/package/@homebridge-plugins/homebridge-smarthq"><img title="npm downloads" src="https://badgen.net/npm/dt/@homebridge-plugins/homebridge-smarthq?label=downloads" ></a>
<a href="https://discord.gg/8fpZA4S"><img title="discord-smarthq" src="https://badgen.net/discord/online-members/8fpZA4S?icon=discord&label=discord" ></a>
<a href="https://paypal.me/donavanbecker"><img title="donate" src="https://badgen.net/badge/donate/paypal/yellow" ></a>

<p>The Homebridge <a href="https://www.geappliances.com/connect">SmartHQ</a>
plugin allows which allows to interact with SmartHQ API.
</p>

</span>

## Installation

1. Search for "SmartHQ" on the plugin screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).
2. Click **Install**.

## Configuration

1. Input Username & Password
2. Click Save
3. Restart Homebridge

## Supported SmartHQ Features

This plugin is in development

## Homekit Controller Notifications

Currently Homekit Controller Notifications are supported for the Opal Ice Maker, to setup, install Homekit Controller App and configure notifications for each respective event. Put your Homekit Controller client secret in the Plugin Advanced Options, and the path associated with each available notifcation in the Opal device options.
These are the events that are currently supported:

- Ice Bucket Full
- Production Progress Complete
- Filter Maintenance Change Alert
- Descale Needed Alert
- Add Water Alert

## Contributing

This project uses a beta-first workflow for all contributions:

- 🎯 **All PRs must target beta branches first**, never the main `latest` branch
- 🏷️ **Required labels**: Set `patch`, `minor`, or `major` labels before assigning issues to Copilot
- 🌿 **Current beta branch**: `beta-0.5.0` (active development)

For detailed contribution guidelines, see [.github/copilot-instructions.md](.github/copilot-instructions.md).

Use the branch helper tool to determine the correct target branch:
```bash
.github/scripts/branch-helper.sh
```
